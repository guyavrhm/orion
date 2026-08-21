import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import {
  findMainFile,
  isFileCompleted,
  cleanTorrentDir,
  testCandidateStream,
  processDownloadJob,
  createDownloadWorker
} from '../../../src/main/workers/downloadWorker.js';
import { torrentProviderClient } from '../../../src/main/clients/torrentProvider.js';
import { eviction } from '../../../src/main/utils/eviction.js';
import * as hashUtil from '../../../src/main/utils/hash.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import * as queues from '../../../src/main/queues/index.js';
import { DOWNLOAD_STATUS } from '../../../src/main/types/index.js';
import { QUEUE_NAMES, TORRENT_QUEUE } from '../../../src/main/config/queue.js';
import type { Torrent, TorrentFile } from 'webtorrent';
import type { Job } from 'bullmq';

// Mock Redis connection with full subscribe/publish support
vi.mock('../../../src/main/config/redis.js', () => {
  const EventEmitter = require('node:events');
  class MockRedisClient extends EventEmitter {
    status = 'ready';
    publish = vi.fn().mockResolvedValue(1);
    subscribe = vi.fn().mockImplementation((_channel, cb) => {
      if (typeof cb === 'function') cb(null, 1);
      return Promise.resolve();
    });
    set = vi.fn().mockResolvedValue('OK');
    get = vi.fn().mockResolvedValue(null);
    del = vi.fn().mockResolvedValue(1);
    keys = vi.fn().mockResolvedValue([]);
    mget = vi.fn().mockResolvedValue([]);
    quit = vi.fn().mockResolvedValue('OK');
    disconnect = vi.fn();
    unref = vi.fn();
  }

  const publisher = new MockRedisClient();
  return {
    createRedisConnection: vi.fn(() => new MockRedisClient()),
    redisPublisher: publisher
  };
});

// Mock WebTorrent
let activeMockTorrent: unknown = null;

vi.mock('webtorrent', () => {
  const EventEmitter = require('node:events');

  class MockTorrentFile {
    name = 'Movie.1080p.mkv';
    path = 'Movie.1080p.mkv';
    length = 2048000;
    downloaded = 2048000;
    select = vi.fn();
    deselect = vi.fn();
  }

  class MockTorrent extends EventEmitter {
    name = 'Movie.1080p';
    path = '/tmp/downloads';
    ready = true;
    downloadSpeed = 250 * 1024; // 250 KB/s (healthy)
    downloaded = 2048000;
    progress = 1;
    numPeers = 30;
    files = [new MockTorrentFile()];
    destroy = vi.fn().mockImplementation((cb) => { if (cb) cb(); });
  }

  class MockWebTorrent extends EventEmitter {
    torrents: MockTorrent[] = [];
    add() {
      const t = (activeMockTorrent as MockTorrent) || new MockTorrent();
      this.torrents.push(t);
      return t;
    }
    destroy(cb?: () => void) {
      if (cb) cb();
    }
  }

  return {
    default: MockWebTorrent
  };
});

vi.mock('bullmq', () => {
  class MockWorker {
    queueName: string;
    processor: (job: unknown) => Promise<unknown>;
    opts: Record<string, unknown>;
    listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    constructor(queueName: string, processor: (job: unknown) => Promise<unknown>, opts: Record<string, unknown>) {
      this.queueName = queueName;
      this.processor = processor;
      this.opts = opts;
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(cb);
      return this;
    }

    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockQueue {
    name: string;
    opts: Record<string, unknown>;
    listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    constructor(name: string, opts: Record<string, unknown>) {
      this.name = name;
      this.opts = opts;
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(cb);
      return this;
    }

    add = vi.fn().mockResolvedValue({ id: 'mock-job-id' });
    getJobs = vi.fn().mockResolvedValue([]);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockFlowProducer {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
    }
    add = vi.fn().mockResolvedValue({
      job: { id: 'mock-flow-job-id' },
      children: []
    });
    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    Worker: MockWorker,
    Queue: MockQueue,
    FlowProducer: MockFlowProducer
  };
});

describe('downloadWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeMockTorrent = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findMainFile', () => {
    it('returns null if torrent.files is empty or undefined', () => {
      expect(findMainFile({ files: [] } as unknown as Torrent)).toBeNull();
      expect(findMainFile({ files: undefined } as unknown as Torrent)).toBeNull();
    });

    it('returns the file at specific fileIdx when valid and within bounds', () => {
      const file0 = { name: 'sample.mp4', length: 1000 } as TorrentFile;
      const file1 = { name: 'movie.mp4', length: 5000000 } as TorrentFile;
      const file2 = { name: 'extra.mp4', length: 2000 } as TorrentFile;

      const mockTorrent = { files: [file0, file1, file2] } as unknown as Torrent;

      expect(findMainFile(mockTorrent, 1)).toBe(file1);
      expect(findMainFile(mockTorrent, 0)).toBe(file0);
      expect(findMainFile(mockTorrent, 2)).toBe(file2);
    });

    it('selects the largest file when fileIdx is null, undefined, negative, or out of bounds', () => {
      const fileSmall = { name: 'trailer.mp4', length: 5000 } as TorrentFile;
      const fileMain = { name: 'full_movie.mkv', length: 4500000000 } as TorrentFile;
      const fileSample = { name: 'sample.mkv', length: 10000000 } as TorrentFile;

      const mockTorrent = { files: [fileSmall, fileMain, fileSample] } as unknown as Torrent;

      expect(findMainFile(mockTorrent)).toBe(fileMain);
      expect(findMainFile(mockTorrent, null)).toBe(fileMain);
      expect(findMainFile(mockTorrent, undefined)).toBe(fileMain);
      expect(findMainFile(mockTorrent, -1)).toBe(fileMain);
      expect(findMainFile(mockTorrent, 99)).toBe(fileMain);
    });
  });

  describe('isFileCompleted', () => {
    it('returns true when downloaded bytes match total file length', () => {
      const completedFile = { downloaded: 1024, length: 1024 } as TorrentFile;
      expect(isFileCompleted(completedFile)).toBe(true);
    });

    it('returns false when downloaded bytes are less than file length', () => {
      const partialFile = { downloaded: 512, length: 1024 } as TorrentFile;
      expect(isFileCompleted(partialFile)).toBe(false);
    });

    it('returns false for null, undefined, or empty files (length <= 0)', () => {
      expect(isFileCompleted(null)).toBe(false);
      expect(isFileCompleted(undefined)).toBe(false);
      expect(isFileCompleted({ downloaded: 0, length: 0 } as TorrentFile)).toBe(false);
      expect(isFileCompleted({ downloaded: 0, length: -10 } as TorrentFile)).toBe(false);
    });
  });

  describe('cleanTorrentDir', () => {
    it('handles null or undefined torrent safely without throwing', () => {
      expect(() => cleanTorrentDir(null)).not.toThrow();
      expect(() => cleanTorrentDir(undefined)).not.toThrow();
    });

    it('destroys torrent and deletes temporary folder when deleteFiles is true and folder exists', () => {
      const mockRemoveListeners = vi.fn();
      const mockDestroy = vi.fn();
      const mockTorrent = {
        name: 'TorrentFolder',
        path: '/tmp/orion_downloads',
        removeAllListeners: mockRemoveListeners,
        destroy: mockDestroy
      } as unknown as Torrent;

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

      cleanTorrentDir(mockTorrent, true);

      expect(mockRemoveListeners).toHaveBeenCalled();
      expect(mockDestroy).toHaveBeenCalled();
      expect(rmSpy).toHaveBeenCalledWith(path.join('/tmp/orion_downloads', 'TorrentFolder'), {
        recursive: true,
        force: true
      });
    });

    it('does not remove folder from disk when deleteFiles is false', () => {
      const mockDestroy = vi.fn();
      const mockTorrent = {
        name: 'TorrentFolder',
        path: '/tmp/orion_downloads',
        removeAllListeners: vi.fn(),
        destroy: mockDestroy
      } as unknown as Torrent;

      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

      cleanTorrentDir(mockTorrent, false);

      expect(mockDestroy).toHaveBeenCalled();
      expect(rmSpy).not.toHaveBeenCalled();
    });

    it('catches and logs errors without crashing', () => {
      const mockTorrent = {
        name: 'BadTorrent',
        path: '/tmp',
        removeAllListeners: vi.fn(),
        destroy: vi.fn().mockImplementation(() => {
          throw new Error('WebTorrent destroy failed');
        })
      } as unknown as Torrent;

      expect(() => cleanTorrentDir(mockTorrent, true)).not.toThrow();
    });
  });

  describe('Candidate Ranking and Sorting Logic', () => {
    it('prioritizes healthy H.264 streams over HEVC when peers are comparable', () => {
      const streams = [
        { hash: 'hevc_hash', quality: '1080p', codec: 'hevc' as const, peers: 20, sizeGB: 2.5, title: 'Movie 1080p HEVC', size: '2.5 GB' },
        { hash: 'h264_hash', quality: '1080p', codec: 'h264' as const, peers: 15, sizeGB: 3.0, title: 'Movie 1080p x264', size: '3.0 GB' }
      ];

      const ranked = torrentProviderClient.filterAndRankTorrents(streams, 'movie', 2);
      expect(ranked[0].hash).toBe('h264_hash');
      expect(ranked[1].hash).toBe('hevc_hash');
    });

    it('yields H.264 preference to HEVC only if HEVC has overwhelming seeds (>= 50 peers and >= 5x)', () => {
      const streams = [
        { hash: 'h264_hash', quality: '1080p', codec: 'h264' as const, peers: 6, sizeGB: 3.0, title: 'Movie x264', size: '3.0 GB' },
        { hash: 'hevc_swarmed', quality: '1080p', codec: 'hevc' as const, peers: 100, sizeGB: 2.0, title: 'Movie HEVC', size: '2.0 GB' }
      ];

      const ranked = torrentProviderClient.filterAndRankTorrents(streams, 'movie', 2);
      expect(ranked[0].hash).toBe('hevc_swarmed');
      expect(ranked[1].hash).toBe('h264_hash');
    });

    it('deprioritizes AV1 codec when competitors have healthy peers', () => {
      const streams = [
        { hash: 'av1_hash', quality: '1080p', codec: 'av1' as const, peers: 25, sizeGB: 1.5, title: 'Movie AV1', size: '1.5 GB' },
        { hash: 'hevc_hash', quality: '1080p', codec: 'hevc' as const, peers: 10, sizeGB: 2.0, title: 'Movie HEVC', size: '2.0 GB' }
      ];

      const ranked = torrentProviderClient.filterAndRankTorrents(streams, 'movie', 2);
      expect(ranked[0].hash).toBe('hevc_hash');
      expect(ranked[1].hash).toBe('av1_hash');
    });

    it('falls back to 720p when 1080p has low seeds and 720p has healthy swarm', () => {
      const streams = [
        { hash: 'low_seed_1080', quality: '1080p', codec: 'h264' as const, peers: 2, sizeGB: 3.0, title: 'Low Seed 1080p', size: '3.0 GB' },
        { hash: 'high_seed_720', quality: '720p', codec: 'h264' as const, peers: 30, sizeGB: 1.5, title: 'High Seed 720p', size: '1.5 GB' }
      ];

      const ranked = torrentProviderClient.filterAndRankTorrents(streams, 'movie', 2);
      expect(ranked[0].hash).toBe('high_seed_720');
      expect(ranked[1].hash).toBe('low_seed_1080');
    });

    it('falls back to SD / 480p when no 1080p or 720p streams exist', () => {
      const streams = [
        { hash: 'sd_hash_1', quality: '480p', codec: 'other' as const, peers: 10, sizeGB: 0.7, title: 'Vintage SD', size: '700 MB' },
        { hash: 'sd_hash_2', quality: '480p', codec: 'other' as const, peers: 3, sizeGB: 0.8, title: 'Vintage SD 2', size: '800 MB' }
      ];

      const ranked = torrentProviderClient.filterAndRankTorrents(streams, 'movie', 2);
      expect(ranked.length).toBe(2);
      expect(ranked[0].hash).toBe('sd_hash_1');
    });

    it('deduplicates candidate streams with identical infoHashes', () => {
      const streams = [
        { hash: 'same_hash', quality: '1080p', codec: 'h264' as const, peers: 10, sizeGB: 2.0, title: 'Release A', size: '2.0 GB' },
        { hash: 'same_hash', quality: '1080p', codec: 'h264' as const, peers: 10, sizeGB: 2.0, title: 'Release B', size: '2.0 GB' }
      ];

      const ranked = torrentProviderClient.filterAndRankTorrents(streams, 'movie', 5);
      expect(ranked.length).toBe(1);
    });
  });

  describe('testCandidateStream', () => {
    it('immediately locks in candidate if download speed exceeds STALL_SPEED_KB (100 KB/s)', async () => {
      vi.useFakeTimers();

      const candidate = {
        hash: 'test_hash_123',
        magnetUrl: 'magnet:?xt=urn:btih:test_hash_123',
        quality: '1080p',
        sizeBytes: 1000000,
        title: 'Fast Movie'
      };

      const testPromise = testCandidateStream(candidate, '/tmp/target');

      // Advance timer by 1.1s so poll ticks with default healthy downloadSpeed (250 KB/s)
      await vi.advanceTimersByTimeAsync(1100);
      const result = await testPromise;

      expect(result.candidate.hash).toBe('test_hash_123');
      expect(result.isHealthy).toBe(true);
      expect(result.peakSpeedKB).toBeGreaterThanOrEqual(100);
      vi.useRealTimers();
    });

    it('records peak speed and finishes with isHealthy: false after 15s active if speed < 100 KB/s', async () => {
      vi.useFakeTimers();

      class SlowTorrent extends EventEmitter {
        name = 'SlowMovie.mp4';
        path = '/tmp/target';
        ready = true;
        downloadSpeed = 50 * 1024; // 50 KB/s (under 100 KB/s threshold)
        downloaded = 1000;
        files = [{ name: 'SlowMovie.mp4', length: 1000, select: vi.fn(), deselect: vi.fn() }];
        destroy = vi.fn();
      }

      activeMockTorrent = new SlowTorrent();

      const candidate = {
        hash: 'slow_hash_456',
        magnetUrl: 'magnet:?xt=urn:btih:slow_hash_456',
        quality: '720p',
        sizeBytes: 1000000,
        title: 'Slow Movie'
      };

      const testPromise = testCandidateStream(candidate, '/tmp/target');

      // Advance 16 seconds of polling
      await vi.advanceTimersByTimeAsync(16000);
      const result = await testPromise;

      expect(result.isHealthy).toBe(false);
      expect(result.peakSpeedKB).toBe(50);
      vi.useRealTimers();
    });
  });

  describe('processDownloadJob', () => {
    it('skips download and returns already_downloaded when master playlist already exists', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/downloads/movies/tt1111111',
        subtitlesDir: '/downloads/movies/tt1111111/subtitles',
        hlsDir: '/downloads/movies/tt1111111/hls'
      });

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (String(p).includes('index.m3u8')) return true;
        return false;
      });

      const publishSpy = vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      const job = {
        id: 'job-download-1',
        data: {
          fileId: 'tt1111111',
          type: 'movie',
          quality: '1080p',
          hash: 'hash_abc',
          magnetUrl: 'magnet:?xt=urn:btih:hash_abc'
        }
      } as unknown as Job;

      const result = await processDownloadJob(job as never);
      expect(result).toEqual({ fileId: 'tt1111111', status: 'already_downloaded' });
      expect(publishSpy).toHaveBeenCalledWith('tt1111111', DOWNLOAD_STATUS.COMPLETED);
    });

    it('runs eviction free space check before downloading and fails if all candidates fail', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/downloads/movies/tt2222222',
        subtitlesDir: '/downloads/movies/tt2222222/subtitles',
        hlsDir: '/downloads/movies/tt2222222/hls'
      });

      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const ensureFreeSpaceSpy = vi.spyOn(eviction, 'ensureFreeSpace').mockImplementation(() => {});
      vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      // 1 valid candidate that triggers eviction check, then fails on download loop
      class ErroredTorrent extends EventEmitter {
        name = 'ErrorTorrent';
        path = '/tmp/downloads';
        ready = false;
        destroy = vi.fn();
      }
      const errTorrent = new ErroredTorrent();
      activeMockTorrent = errTorrent;

      const job = {
        id: 'job-download-2',
        data: {
          fileId: 'tt2222222',
          type: 'movie',
          quality: '1080p',
          lockedCandidateHash: 'hash_available',
          candidates: [
            { hash: 'hash_available', magnetUrl: 'magnet:?xt=urn:btih:hash_available', fileIdx: 0, quality: '1080p', sizeBytes: 5000, title: 'avail' }
          ],
          failedCandidates: []
        }
      } as unknown as Job;

      const promise = processDownloadJob(job as never);

      // Emit error on torrent to trigger failover / failure
      setTimeout(() => {
        errTorrent.emit('error', new Error('Torrent tracker unreachable'));
      }, 10);

      await expect(promise).rejects.toThrow('Torrent tracker unreachable');
      expect(ensureFreeSpaceSpy).toHaveBeenCalled();
    });

    it('completes download, computes OSHash, and enqueues media processing flow', async () => {
      vi.useFakeTimers();

      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/downloads/movies/tt3333333',
        subtitlesDir: '/downloads/movies/tt3333333/subtitles',
        hlsDir: '/downloads/movies/tt3333333/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as string);

      vi.spyOn(hashUtil, 'calculateOSHash').mockResolvedValue({
        hash: 'os_hash_12345678',
        size: 2048000
      });

      const enqueueFlowSpy = vi.spyOn(queues, 'enqueueMediaProcessingFlow').mockResolvedValue({} as never);
      vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      class FastCompletedTorrent extends EventEmitter {
        name = 'Movie.1080p';
        path = '/tmp/downloads';
        ready = true;
        downloadSpeed = 200 * 1024;
        downloaded = 2048000;
        progress = 1;
        numPeers = 15;
        files = [
          {
            name: 'Movie.1080p.mkv',
            path: 'Movie.1080p.mkv',
            length: 2048000,
            downloaded: 2048000,
            select: vi.fn(),
            deselect: vi.fn()
          }
        ];
        destroy = vi.fn().mockImplementation((cb) => { if (cb) cb(); });
      }

      activeMockTorrent = new FastCompletedTorrent();

      const job = {
        id: 'job-download-3',
        data: {
          fileId: 'tt3333333',
          type: 'movie',
          quality: '1080p',
          lockedCandidateHash: 'hash_active',
          candidates: [
            {
              hash: 'hash_active',
              magnetUrl: 'magnet:?xt=urn:btih:hash_active',
              fileIdx: 0,
              quality: '1080p',
              sizeBytes: 2048000,
              title: 'Movie Title',
              codec: 'h264' as const
            }
          ]
        },
        updateProgress: vi.fn().mockResolvedValue(undefined)
      } as unknown as Job;

      const processPromise = processDownloadJob(job as never);

      // Advance interval timer so pollInterval ticks and triggers handleDone
      await vi.advanceTimersByTimeAsync(TORRENT_QUEUE.POLL_INTERVAL_MS + 100);
      const result = await processPromise;

      expect(result.fileId).toBe('tt3333333');
      expect(result.status).toBe('completed');
      expect(enqueueFlowSpy).toHaveBeenCalled();
      expect(result.fileHash).toBe('os_hash_12345678');

      vi.useRealTimers();
    });
  });

  describe('createDownloadWorker', () => {
    it('creates BullMQ worker with correct queue name and options', () => {
      const worker = createDownloadWorker();
      expect(worker).toBeDefined();
      expect((worker as unknown as { queueName: string }).queueName).toBe(QUEUE_NAMES.DOWNLOAD);
    });
  });
});
