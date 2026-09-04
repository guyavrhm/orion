import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  processFinalizeJob,
  createFinalizeWorker
} from '../../../src/main/workers/finalizeWorker.js';
import { streamsRepo } from '../../../src/main/db/streams.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import * as queues from '../../../src/main/queues/index.js';
import { MEDIA_REQUEST_STATUS } from '../../../src/main/types/index.js';
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

      const registerStreamSpy = vi.spyOn(streamsRepo, 'registerStream').mockImplementation(() => {});
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {});
      vi.spyOn(fs, 'readdirSync').mockReturnValue([] as unknown as fs.Dirent[]); // rawTempDir is empty

      const publishStatusSpy = vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);

      const job = {
        id: 'job-finalize-1',
        data: {
          fileId: 'tt0063350',
          rawTempDir: '/tmp/raw_temp_batch',
          quality: '1080p'
        },
        getChildrenValues: vi.fn().mockResolvedValue({
          'orion:transcode-fast:1': { fileId: 'tt0063350' }
        })
      } as unknown as Job;

      const result = await processFinalizeJob(job as never);

      // 1. Returns completed structure
      expect(result).toEqual({
        fileId: 'tt0063350',
        hlsDir: '/media/movies/tt0063350/hls',
        size_bytes: 3500000000
      });

      // 2. Registers in SQLite database
      expect(registerStreamSpy).toHaveBeenCalledWith('tt0063350', {
        quality: '1080p',
        size_bytes: 3500000000,
        ready_at: expect.any(Number)
      });

      // 3. Cleans up raw temporary directory recursively
      expect(rmSpy).toHaveBeenCalledWith('/tmp/raw_temp_batch', { recursive: true, force: true });

      // 4. Publishes ready request status
      expect(publishStatusSpy).toHaveBeenCalledWith('tt0063350', MEDIA_REQUEST_STATUS.READY);
    });

    it('purges isolated rawTempDir when path matches fileId', async () => {
      const mockDirs = {
        baseDir: '/media/shows/tt8888888/1/1',
        subtitlesDir: '/media/shows/tt8888888/1/1/subtitles',
        hlsDir: '/media/shows/tt8888888/1/1/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(helpers, 'getDirSize').mockReturnValue(1200000000);

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(streamsRepo, 'registerStream').mockImplementation(() => {});
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);

      const job = {
        id: 'job-finalize-isolated',
        data: {
          fileId: 'tt8888888_s1_e1',
          rawTempDir: '/tmp/downloads/temp/shows/tt8888888_s1_e1',
          quality: '1080p'
        },
        getChildrenValues: vi.fn().mockResolvedValue({
          'orion:transcode-fast:1': { fileId: 'tt8888888_s1_e1' }
        })
      } as unknown as Job;

      await processFinalizeJob(job as never);

      expect(rmSpy).toHaveBeenCalledWith('/tmp/downloads/temp/shows/tt8888888_s1_e1', {
        recursive: true,
        force: true
      });
    });

    it('throws error, cleans up baseDir and rawTempDir, and publishes FAILED status if transcode failed', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt5555555',
        subtitlesDir: '/media/movies/tt5555555/subtitles',
        hlsDir: '/media/movies/tt5555555/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);

      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        const pStr = String(p);
        if (pStr === mockDirs.baseDir) return true;
        if (pStr === '/tmp/raw_temp') return true;
        return false;
      });

      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      const publishStatusSpy = vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);

      const job = {
        id: 'job-finalize-missing-hls',
        data: {
          fileId: 'tt5555555',
          rawTempDir: '/tmp/raw_temp'
        },
        getChildrenValues: vi.fn().mockResolvedValue({})
      } as unknown as Job;

      await expect(processFinalizeJob(job as never)).rejects.toThrow(
        'Transcode job failed for tt5555555'
      );
      expect(publishStatusSpy).toHaveBeenCalledWith('tt5555555', MEDIA_REQUEST_STATUS.FAILED);
      expect(rmSpy).toHaveBeenCalledWith(mockDirs.baseDir, { recursive: true, force: true });
      expect(rmSpy).toHaveBeenCalledWith('/tmp/raw_temp', { recursive: true, force: true });
    });

    it('throws error if media directories cannot be resolved', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(null);

      const job = {
        id: 'job-finalize-invalid',
        data: {
          fileId: 'invalid@@@'
        },
        getChildrenValues: vi.fn().mockResolvedValue({
          'orion:transcode-fast:1': { fileId: 'invalid@@@' }
        })
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
      vi.spyOn(streamsRepo, 'registerStream').mockImplementation(() => {});
      vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);

      // Simulating EPERM / filesystem permission error on rmSync
      vi.spyOn(fs, 'rmSync').mockImplementation(() => {
        throw new Error('EPERM: operation not permitted');
      });

      const job = {
        id: 'job-finalize-eperm',
        data: {
          fileId: 'tt7777777',
          rawTempDir: '/tmp/protected/temp'
        },
        getChildrenValues: vi.fn().mockResolvedValue({
          'orion:transcode-fast:1': { fileId: 'tt7777777' }
        })
      } as unknown as Job;

      const result = await processFinalizeJob(job as never);
      expect(result.fileId).toBe('tt7777777');
    });

    it('handles transcode child failure reported via getChildrenValues', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt6666666',
        subtitlesDir: '/media/movies/tt6666666/subtitles',
        hlsDir: '/media/movies/tt6666666/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      const publishStatusSpy = vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);

      const job = {
        id: 'job-transcode-fail',
        data: {
          fileId: 'tt6666666',
          rawTempDir: '/tmp/raw_temp_corrupt'
        },
        getChildrenValues: vi.fn().mockResolvedValue({})
      } as unknown as Job;

      await expect(processFinalizeJob(job as never)).rejects.toThrow(
        'Transcode job failed for tt6666666'
      );
      expect(publishStatusSpy).toHaveBeenCalledWith('tt6666666', MEDIA_REQUEST_STATUS.FAILED);
      expect(rmSpy).toHaveBeenCalledWith(mockDirs.baseDir, { recursive: true, force: true });
      expect(rmSpy).toHaveBeenCalledWith('/tmp/raw_temp_corrupt', { recursive: true, force: true });
    });

    it('retains subtitles and finalizes successfully when subtitle child encounters an error', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt7777777',
        subtitlesDir: '/media/movies/tt7777777/subtitles',
        hlsDir: '/media/movies/tt7777777/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(helpers, 'getDirSize').mockReturnValue(2000000);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(streamsRepo, 'registerStream').mockImplementation(() => {});
      vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

      const job = {
        id: 'job-sub-fail',
        data: {
          fileId: 'tt7777777',
          rawTempDir: '/tmp/raw_temp',
          quality: '1080p'
        },
        getChildrenValues: vi.fn().mockResolvedValue({
          'orion:transcode-fast:123': {
            fileId: 'tt7777777'
          }
        })
      } as unknown as Job;

      const result = await processFinalizeJob(job as never);
      expect(result.fileId).toBe('tt7777777');
      expect(rmSpy).not.toHaveBeenCalledWith(mockDirs.subtitlesDir, { recursive: true, force: true });
      expect(rmSpy).toHaveBeenCalledWith('/tmp/raw_temp', { recursive: true, force: true });
    });

    it('retains subtitles and finalizes successfully when both transcode and subtitle children succeed', async () => {
      const mockDirs = {
        baseDir: '/media/movies/tt7777777',
        subtitlesDir: '/media/movies/tt7777777/subtitles',
        hlsDir: '/media/movies/tt7777777/hls'
      };
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(mockDirs);
      vi.spyOn(helpers, 'getDirSize').mockReturnValue(2000000);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(streamsRepo, 'registerStream').mockImplementation(() => {});
      vi.spyOn(queues, 'publishMediaRequestStatus').mockResolvedValue(1);
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

      const job = {
        id: 'job-all-ok',
        data: {
          fileId: 'tt7777777',
          rawTempDir: '/tmp/raw_temp',
          quality: '1080p'
        },
        getChildrenValues: vi.fn().mockResolvedValue({
          'orion:transcode-fast:123': { fileId: 'tt7777777' },
          'orion:subtitle:456': { fileId: 'tt7777777' }
        })
      } as unknown as Job;

      const result = await processFinalizeJob(job as never);
      expect(result.fileId).toBe('tt7777777');
      expect(rmSpy).not.toHaveBeenCalledWith(mockDirs.subtitlesDir, { recursive: true, force: true });
      expect(rmSpy).toHaveBeenCalledWith('/tmp/raw_temp', { recursive: true, force: true });
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
