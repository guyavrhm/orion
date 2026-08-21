import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  processFinalizeJob,
  createFinalizeWorker
} from '../../../src/main/workers/finalizeWorker.js';
import { downloadsRepo } from '../../../src/main/db/downloads.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import * as queues from '../../../src/main/queues/index.js';
import { DOWNLOAD_STATUS } from '../../../src/main/types/index.js';
import { QUEUE_NAMES, WORKER_CONCURRENCY } from '../../../src/main/config/queue.js';
import type { Job } from 'bullmq';

// Mock Redis
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

// Mock BullMQ
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

/**
 * Helper to parse and verify HLS Master or Media Playlists.
 * Ensures compliant #EXTM3U headers, media sequence, stream info, or segments.
 */
export function verifyMasterPlaylist(playlistContent: string): {
  isValid: boolean;
  hasHeader: boolean;
  isMultiVariant: boolean;
  targetDuration?: number;
  segmentCount: number;
  variants: { bandwidth?: number; resolution?: string; uri?: string }[];
} {
  if (!playlistContent || typeof playlistContent !== 'string') {
    return { isValid: false, hasHeader: false, isMultiVariant: false, segmentCount: 0, variants: [] };
  }

  const lines = playlistContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hasHeader = lines[0] === '#EXTM3U';

  if (!hasHeader) {
    return { isValid: false, hasHeader: false, isMultiVariant: false, segmentCount: 0, variants: [] };
  }

  let isMultiVariant = false;
  let targetDuration: number | undefined;
  let segmentCount = 0;
  const variants: { bandwidth?: number; resolution?: string; uri?: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.split(':')[1], 10);
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      isMultiVariant = true;
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      const resMatch = line.match(/RESOLUTION=([\dx]+)/i);
      const uri = lines[i + 1] && !lines[i + 1].startsWith('#') ? lines[i + 1] : undefined;
      variants.push({
        bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : undefined,
        resolution: resMatch ? resMatch[1] : undefined,
        uri
      });
    }

    if (line.startsWith('#EXTINF:')) {
      segmentCount++;
    }
  }

  const isValid = hasHeader && (isMultiVariant || segmentCount > 0 || targetDuration !== undefined);

  return {
    isValid,
    hasHeader,
    isMultiVariant,
    targetDuration,
    segmentCount,
    variants
  };
}

describe('finalizeWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyMasterPlaylist', () => {
    it('validates a standard single-variant HLS playlist with #EXTM3U and #EXTINF segments', () => {
      const vodPlaylist = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.000000,
index0.ts
#EXTINF:6.000000,
index1.ts
#EXTINF:4.500000,
index2.ts
#EXT-X-ENDLIST
`.trim();

      const result = verifyMasterPlaylist(vodPlaylist);
      expect(result.isValid).toBe(true);
      expect(result.hasHeader).toBe(true);
      expect(result.isMultiVariant).toBe(false);
      expect(result.targetDuration).toBe(6);
      expect(result.segmentCount).toBe(3);
    });

    it('validates a multi-variant master playlist with #EXT-X-STREAM-INF declarations', () => {
      const masterPlaylist = `
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/index.m3u8
`.trim();

      const result = verifyMasterPlaylist(masterPlaylist);
      expect(result.isValid).toBe(true);
      expect(result.hasHeader).toBe(true);
      expect(result.isMultiVariant).toBe(true);
      expect(result.variants).toHaveLength(2);
      expect(result.variants[0]).toEqual({
        bandwidth: 5000000,
        resolution: '1920x1080',
        uri: '1080p/index.m3u8'
      });
      expect(result.variants[1]).toEqual({
        bandwidth: 2500000,
        resolution: '1280x720',
        uri: '720p/index.m3u8'
      });
    });

    it('rejects invalid playlists lacking #EXTM3U header', () => {
      const invalid = `
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
index0.ts
`.trim();

      const result = verifyMasterPlaylist(invalid);
      expect(result.isValid).toBe(false);
      expect(result.hasHeader).toBe(false);
    });

    it('handles empty or non-string playlist content gracefully', () => {
      expect(verifyMasterPlaylist('')).toEqual({
        isValid: false,
        hasHeader: false,
        isMultiVariant: false,
        segmentCount: 0,
        variants: []
      });
      expect(verifyMasterPlaylist(null as unknown as string)).toEqual({
        isValid: false,
        hasHeader: false,
        isMultiVariant: false,
        segmentCount: 0,
        variants: []
      });
    });
  });

  describe('processFinalizeJob', () => {
    it('successfully finalizes media: checks playlist, registers download, cleans source and empty rawTempDir', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt0063350',
        subtitlesDir: '/media/movies/tt0063350/subtitles',
        hlsDir: '/media/movies/tt0063350/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(helpers, 'getDirSize').mockReturnValue(3500000000); // 3.5 GB

      // Playlist exists
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.includes('index.m3u8')) return true;
        if (pathStr.includes('source.mp4')) return true;
        if (pathStr.includes('source.npz')) return true;
        if (pathStr === '/tmp/raw_temp_batch') return true;
        return false;
      });

      const addDownloadEntrySpy = vi.spyOn(downloadsRepo, 'addDownloadEntry').mockImplementation(() => {});
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {});
      vi.spyOn(fs, 'readdirSync').mockReturnValue([] as unknown as fs.Dirent[]); // rawTempDir is empty

      const publishStatusSpy = vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      const job = {
        id: 'job-finalize-1',
        data: {
          fileId: 'tt0063350',
          sourcePath: '/tmp/downloads/source.mp4',
          rawTempDir: '/tmp/raw_temp_batch',
          hash: 'torrent_hash_123',
          fileHash: 'file_hash_456',
          fileIdx: 0,
          targetFileName: 'Night.of.the.Living.Dead.1968.1080p.mkv',
          quality: '1080p',
          sizeBytes: 3500000000
        }
      } as unknown as Job;

      const result = await processFinalizeJob(job as never);

      // 1. Returns completed structure
      expect(result).toEqual({
        fileId: 'tt0063350',
        status: 'completed',
        hlsDir: '/media/movies/tt0063350/hls',
        sizeBytes: 3500000000
      });

      // 2. Registers in SQLite database
      expect(addDownloadEntrySpy).toHaveBeenCalledWith('tt0063350', {
        fileName: 'Night.of.the.Living.Dead.1968.1080p.mkv',
        torrentHash: 'torrent_hash_123',
        fileHash: 'file_hash_456',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 3500000000
      });

      // 3. Cleans up raw source file and .npz speech reference
      expect(rmSpy).toHaveBeenCalledWith('/tmp/downloads/source.mp4', { force: true });
      expect(rmSpy).toHaveBeenCalledWith('/tmp/downloads/source.npz', { force: true });

      // 4. Removes empty rawTempDir
      expect(rmdirSpy).toHaveBeenCalledWith('/tmp/raw_temp_batch');

      // 5. Publishes completed download status
      expect(publishStatusSpy).toHaveBeenCalledWith('tt0063350', DOWNLOAD_STATUS.COMPLETED);
    });

    it('preserves rawTempDir if other files remain inside it (e.g. batch show episodes)', async () => {
      const mockDirs = {
        baseDir: '/media/series/tt9999999/1/1',
        subtitlesDir: '/media/series/tt9999999/1/1/subtitles',
        hlsDir: '/media/series/tt9999999/1/1/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(helpers, 'getDirSize').mockReturnValue(1200000000);

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(downloadsRepo, 'addDownloadEntry').mockImplementation(() => {});
      vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {});
      vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      // Remaining files exist in rawTempDir (e.g. episode 2, episode 3)
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'Episode2.mkv',
        'Episode3.mkv'
      ] as unknown as fs.Dirent[]);

      const job = {
        id: 'job-finalize-2',
        data: {
          fileId: 'tt9999999_s1_e1',
          sourcePath: '/tmp/downloads/Show.S01/Episode1.mkv',
          rawTempDir: '/tmp/downloads/Show.S01',
          hash: 'show_batch_hash',
          quality: '1080p'
        }
      } as unknown as Job;

      await processFinalizeJob(job as never);

      // rawTempDir should NOT be removed since other episodes are present
      expect(rmdirSpy).not.toHaveBeenCalled();
    });

    it('throws error and publishes FAILED status if master HLS playlist does not exist', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt5555555',
        subtitlesDir: '/media/movies/tt5555555/subtitles',
        hlsDir: '/media/movies/tt5555555/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);

      // Master playlist missing
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const publishStatusSpy = vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      const job = {
        id: 'job-finalize-missing-hls',
        data: {
          fileId: 'tt5555555',
          sourcePath: '/tmp/source.mp4'
        }
      } as unknown as Job;

      await expect(processFinalizeJob(job as never)).rejects.toThrow(
        'Master HLS playlist /media/movies/tt5555555/hls/index.m3u8 does not exist'
      );
      expect(publishStatusSpy).toHaveBeenCalledWith('tt5555555', DOWNLOAD_STATUS.FAILED);
    });

    it('throws error if media directories cannot be resolved', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(null);

      const job = {
        id: 'job-finalize-invalid',
        data: {
          fileId: 'invalid@@@',
          sourcePath: '/tmp/source.mp4'
        }
      } as unknown as Job;

      await expect(processFinalizeJob(job as never)).rejects.toThrow(
        'Could not resolve media directories for invalid@@@'
      );
    });

    it('tolerates sourcePath cleanup errors gracefully without failing finalization', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt7777777',
        subtitlesDir: '/media/movies/tt7777777/subtitles',
        hlsDir: '/media/movies/tt7777777/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(helpers, 'getDirSize').mockReturnValue(2000000);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(downloadsRepo, 'addDownloadEntry').mockImplementation(() => {});
      vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      // Simulating EPERM / filesystem permission error on rmSync
      vi.spyOn(fs, 'rmSync').mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      const job = {
        id: 'job-finalize-eperm',
        data: {
          fileId: 'tt7777777',
          sourcePath: '/tmp/protected/source.mp4'
        }
      } as unknown as Job;

      const result = await processFinalizeJob(job as never);
      expect(result.status).toBe('completed');
    });
  });

  describe('createFinalizeWorker', () => {
    it('initializes BullMQ worker for finalize queue with correct options', () => {
      const worker = createFinalizeWorker();
      expect(worker).toBeDefined();
      expect((worker as unknown as { queueName: string }).queueName).toBe(QUEUE_NAMES.FINALIZE);
      expect((worker as unknown as { opts: { concurrency: number } }).opts.concurrency).toBe(
        WORKER_CONCURRENCY.FINALIZE
      );
    });
  });
});
