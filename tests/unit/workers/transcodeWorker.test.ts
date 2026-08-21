import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import {
  getLanguageCodesFromCountry,
  probeMediaStreams,
  getPreferredAudioStreamIndex,
  convertToHls,
  processTranscodeJob,
  createTranscodeWorker,
  createFastTranscodeWorker,
  createHeavyTranscodeWorker
} from '../../../src/main/workers/transcodeWorker.js';
import { metadataRepo } from '../../../src/main/db/metadata.js';
import * as queues from '../../../src/main/queues/index.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import { DOWNLOAD_STATUS } from '../../../src/main/types/index.js';
import { QUEUE_NAMES, WORKER_CONCURRENCY } from '../../../src/main/config/queue.js';
import type { Job } from 'bullmq';

// Create flexible ffmpeg mock instance
let activeMockFfmpegInstance: Record<string, unknown> = {};

vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = vi.fn(() => activeMockFfmpegInstance);
  (ffmpegFn as unknown as Record<string, unknown>).ffprobe = vi.fn();
  (ffmpegFn as unknown as Record<string, unknown>).setFfmpegPath = vi.fn();
  (ffmpegFn as unknown as Record<string, unknown>).setFfprobePath = vi.fn();
  return {
    default: ffmpegFn
  };
});

// Mock Redis connection and BullMQ
vi.mock('../../../src/main/config/redis.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
    unref: vi.fn()
  }),
  redisPublisher: {
    publish: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1)
  }
}));

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

    emit(event: string, ...args: unknown[]) {
      if (this.listeners[event]) {
        for (const cb of this.listeners[event]) {
          cb(...args);
        }
      }
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

    emit(event: string, ...args: unknown[]) {
      if (this.listeners[event]) {
        for (const cb of this.listeners[event]) {
          cb(...args);
        }
      }
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

describe('transcodeWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getLanguageCodesFromCountry', () => {
    it('returns empty array for undefined, null, or empty string', () => {
      expect(getLanguageCodesFromCountry()).toEqual([]);
      expect(getLanguageCodesFromCountry(undefined)).toEqual([]);
      expect(getLanguageCodesFromCountry(null)).toEqual([]);
      expect(getLanguageCodesFromCountry('')).toEqual([]);
      expect(getLanguageCodesFromCountry('   ')).toEqual([]);
      expect(getLanguageCodesFromCountry(123 as unknown as string)).toEqual([]);
    });

    it('resolves languages for single country (case-insensitive and trimmed)', () => {
      const usLangs = getLanguageCodesFromCountry('United States');
      expect(usLangs).toContain('eng');
      expect(usLangs).toContain('spa');

      const franceLangs = getLanguageCodesFromCountry('  FRANCE  ');
      expect(franceLangs).toEqual(['fre', 'fra', 'fr', 'french']);

      const japanLangs = getLanguageCodesFromCountry('Japan');
      expect(japanLangs).toEqual(['jpn', 'ja', 'japanese']);

      const israelLangs = getLanguageCodesFromCountry('israel');
      expect(israelLangs).toContain('heb');
      expect(israelLangs).toContain('ara');
      expect(israelLangs).toContain('eng');
    });

    it('resolves and merges languages for comma-separated multiple countries with deduplication', () => {
      const result = getLanguageCodesFromCountry('United States, France, Germany');
      expect(result).toContain('eng');
      expect(result).toContain('spa');
      expect(result).toContain('fre');
      expect(result).toContain('ger');

      // Deduplication check
      const usAndUk = getLanguageCodesFromCountry('USA, United Kingdom');
      const engCount = usAndUk.filter((l) => l === 'eng').length;
      expect(engCount).toBe(1);
    });

    it('ignores unknown countries while preserving valid matches', () => {
      const result = getLanguageCodesFromCountry('Atlantis, France, Narnia');
      expect(result).toEqual(['fre', 'fra', 'fr', 'french']);

      const allUnknown = getLanguageCodesFromCountry('UnknownLand, Fantasia');
      expect(allUnknown).toEqual([]);
    });
  });

  describe('probeMediaStreams', () => {
    it('identifies 8-bit standard H.264 video stream as fast copyable (isVideoH264: true)', async () => {
      const mockFfprobeData = {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            pix_fmt: 'yuv420p',
            profile: 'High'
          },
          {
            codec_type: 'audio',
            codec_name: 'aac',
            index: 1,
            tags: { language: 'eng' }
          }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/movie.mp4', ['eng']);
      expect(result).toEqual({
        audioIndex: 0,
        isVideoH264: true,
        videoCodec: 'h264',
        pixFmt: 'yuv420p'
      });
    });

    it('identifies HEVC 10-bit HDR video as non-copyable (isVideoH264: false)', async () => {
      const mockFfprobeData = {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'hevc',
            pix_fmt: 'yuv420p10le',
            profile: 'Main 10'
          },
          {
            codec_type: 'audio',
            codec_name: 'eac3',
            index: 1,
            tags: { language: 'eng' }
          }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/movie.mkv', ['eng']);
      expect(result.isVideoH264).toBe(false);
      expect(result.videoCodec).toBe('hevc');
      expect(result.pixFmt).toBe('yuv420p10le');
      expect(result.audioIndex).toBe(0);
    });

    it('identifies AV1 video as non-copyable (isVideoH264: false)', async () => {
      const mockFfprobeData = {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'av1',
            pix_fmt: 'yuv420p',
            profile: 'Main'
          }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/movie.mkv', ['eng']);
      expect(result.isVideoH264).toBe(false);
      expect(result.videoCodec).toBe('av1');
    });

    it('identifies 10-bit H.264 / High 10 Profile as requiring adaptive re-encoding (isVideoH264: false)', async () => {
      const mockFfprobeData = {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            pix_fmt: 'yuv420p10le',
            profile: 'High 10'
          }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/anime.mkv', ['jpn']);
      expect(result.isVideoH264).toBe(false);
      expect(result.videoCodec).toBe('h264');
      expect(result.pixFmt).toBe('yuv420p10le');
    });

    it('identifies 12-bit H.264 as non-copyable (isVideoH264: false)', async () => {
      const mockFfprobeData = {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            pix_fmt: 'yuv420p12le',
            profile: 'High 4:4:4 Predictive'
          }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/test.mkv', []);
      expect(result.isVideoH264).toBe(false);
    });

    it('correctly selects preferred audio stream among multi-track audio by exact tag match', async () => {
      const mockFfprobeData = {
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'ac3', index: 1, tags: { language: 'eng', title: 'English 5.1' } },
          { codec_type: 'audio', codec_name: 'aac', index: 2, tags: { language: 'spa', title: 'Spanish Latino' } },
          { codec_type: 'audio', codec_name: 'aac', index: 3, tags: { language: 'fre', title: 'French Director Commentary' } }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/movie.mkv', ['spa', 'es']);
      expect(result.audioIndex).toBe(1);
    });

    it('matches sub-tag language identifiers (e.g. es-ES matching es)', async () => {
      const mockFfprobeData = {
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'ac3', index: 1, tags: { language: 'en-US' } },
          { codec_type: 'audio', codec_name: 'aac', index: 2, tags: { language: 'es-ES' } }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/movie.mkv', ['es']);
      expect(result.audioIndex).toBe(1);
    });

    it('matches language by word boundary in track title when tag is missing or generic', async () => {
      const mockFfprobeData = {
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'ac3', index: 1, tags: { language: 'und', title: 'English Audio Description' } },
          { codec_type: 'audio', codec_name: 'aac', index: 2, tags: { language: 'und', title: 'Japanese Original Audio' } }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/anime.mkv', ['japanese', 'jpn']);
      expect(result.audioIndex).toBe(1);
    });

    it('defaults to relative audio index 0 if only one audio stream exists or none match', async () => {
      const mockFfprobeData = {
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'ac3', index: 1, tags: { language: 'rus' } },
          { codec_type: 'audio', codec_name: 'aac', index: 2, tags: { language: 'ita' } }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/movie.mkv', ['heb', 'eng']);
      expect(result.audioIndex).toBe(0);
    });

    it('handles ffprobe errors and returns safe default stream copy values', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(new Error('Corrupt media file'), null);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/corrupt.mp4', ['eng']);
      expect(result).toEqual({
        audioIndex: 0,
        isVideoH264: true,
        videoCodec: 'unknown',
        pixFmt: 'unknown'
      });
    });

    it('handles metadata with missing streams gracefully', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {});
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const result = await probeMediaStreams('/path/to/empty.mp4', ['eng']);
      expect(result).toEqual({
        audioIndex: 0,
        isVideoH264: true,
        videoCodec: 'unknown',
        pixFmt: 'unknown'
      });
    });
  });

  describe('getPreferredAudioStreamIndex', () => {
    it('delegates to probeMediaStreams and returns audioIndex', async () => {
      const mockFfprobeData = {
        streams: [
          { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { codec_type: 'audio', codec_name: 'aac', index: 1, tags: { language: 'fra' } },
          { codec_type: 'audio', codec_name: 'aac', index: 2, tags: { language: 'eng' } }
        ]
      };

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, mockFfprobeData);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const idx = await getPreferredAudioStreamIndex('/path/to/movie.mkv', ['eng']);
      expect(idx).toBe(1);
    });
  });

  describe('convertToHls', () => {
    let mockFfmpegInstance: {
      outputOptions: ReturnType<typeof vi.fn>;
      format: ReturnType<typeof vi.fn>;
      output: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      run: ReturnType<typeof vi.fn>;
      ffmpegProc?: { pid?: number };
    };

    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as string);

      mockFfmpegInstance = {
        outputOptions: vi.fn().mockReturnThis(),
        format: vi.fn().mockReturnThis(),
        output: vi.fn().mockReturnThis(),
        on: vi.fn().mockReturnThis(),
        run: vi.fn().mockReturnThis(),
        ffmpegProc: { pid: 1234 }
      };

      activeMockFfmpegInstance = mockFfmpegInstance;
    });

    it('generates Fast Lane parameters (-c:v copy + aac) when video is standard 8-bit H.264', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
            { codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } }
          ]
        });
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      mockFfmpegInstance.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'end') {
          setTimeout(() => handler(), 10);
        }
        return mockFfmpegInstance;
      });

      const outputDir = '/tmp/test_hls';
      const resultPath = await convertToHls('/tmp/source.mp4', outputDir, 'USA', 'tt1234567');

      expect(resultPath).toBe(path.join(outputDir, 'index.m3u8'));
      expect(mockFfmpegInstance.format).toHaveBeenCalledWith('hls');
      expect(mockFfmpegInstance.output).toHaveBeenCalledWith(path.join(outputDir, 'index.m3u8'));

      const outputOpts = mockFfmpegInstance.outputOptions.mock.calls[0][0] as string[];
      expect(outputOpts).toContain('-c:v copy');
      expect(outputOpts).toContain('-threads 1');
      expect(outputOpts).toContain('-c:a aac');
      expect(outputOpts).toContain('-ac 2');
      expect(outputOpts).toContain('-b:a 192k');
      expect(outputOpts).toContain('-af aresample=async=1');
      expect(outputOpts).toContain('-hls_time 6');
      expect(outputOpts).toContain('-hls_playlist_type vod');
      expect(outputOpts).toContain('-hls_list_size 0');
      expect(outputOpts).toContain('-map 0:v:0');
      expect(outputOpts).toContain('-map 0:a:0?');
    });

    it('generates Heavy Lane parameters (libx264 veryfast crf 22) when video is HEVC/10-bit', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {
          streams: [
            { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p10le', profile: 'Main 10' },
            { codec_type: 'audio', codec_name: 'eac3', tags: { language: 'eng' } }
          ]
        });
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const publishStatusSpy = vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      mockFfmpegInstance.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'end') {
          setTimeout(() => handler(), 10);
        }
        return mockFfmpegInstance;
      });

      const outputDir = '/tmp/test_hls_heavy';
      await convertToHls('/tmp/source_hevc.mkv', outputDir, 'USA', 'tt9999999');

      const outputOpts = mockFfmpegInstance.outputOptions.mock.calls[0][0] as string[];
      expect(outputOpts).toContain('-c:v libx264');
      expect(outputOpts).toContain('-preset veryfast');
      expect(outputOpts).toContain('-crf 22');
      expect(outputOpts).toContain('-pix_fmt yuv420p');
      expect(outputOpts.some((opt) => opt.startsWith('-threads'))).toBe(true);

      expect(publishStatusSpy).toHaveBeenCalledWith('tt9999999', DOWNLOAD_STATUS.PROCESSING, '0.00');
    });

    it('handles process start and sets OS scheduling priority to background', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {
          streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }]
        });
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const setPrioritySpy = vi.spyOn(os, 'setPriority').mockImplementation(() => {});

      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      mockFfmpegInstance.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return mockFfmpegInstance;
      });

      mockFfmpegInstance.run.mockImplementation(() => {
        handlers['start']?.forEach((h) => h('ffmpeg -i /tmp/test.mp4 ...'));
        setTimeout(() => handlers['end']?.forEach((h) => h()), 10);
      });

      await convertToHls('/tmp/test.mp4', '/tmp/out', null, 'tt111');
      expect(setPrioritySpy).toHaveBeenCalledWith(1234, 19);
    });

    it('throttles and broadcasts progress percentage updates', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {
          streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }]
        });
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const publishStatusSpy = vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      mockFfmpegInstance.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        return mockFfmpegInstance;
      });

      mockFfmpegInstance.run.mockImplementation(() => {
        handlers['progress']?.forEach((h) => h({ percent: 15.6 }));
        handlers['progress']?.forEach((h) => h({ percent: 100 }));
        setTimeout(() => handlers['end']?.forEach((h) => h()), 10);
      });

      await convertToHls('/tmp/test.mp4', '/tmp/out', null, 'tt222');
      expect(publishStatusSpy).toHaveBeenCalledWith('tt222', DOWNLOAD_STATUS.PROCESSING, '15.00');
      expect(publishStatusSpy).toHaveBeenCalledWith('tt222', DOWNLOAD_STATUS.PROCESSING, '100.00');
    });

    it('rejects promise on ffmpeg error', async () => {
      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {
          streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }]
        });
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      mockFfmpegInstance.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') {
          setTimeout(() => handler(new Error('FFmpeg segmentation fault')), 10);
        }
        return mockFfmpegInstance;
      });

      await expect(convertToHls('/tmp/test.mp4', '/tmp/out', null, 'tt333')).rejects.toThrow(
        'FFmpeg segmentation fault'
      );
    });
  });

  describe('processTranscodeJob', () => {
    it('successfully processes transcode job retrieving country metadata', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      vi.spyOn(metadataRepo, 'getCachedMetadata').mockReturnValue({
        id: 'tt1234567',
        metadata: {
          title: 'Test Movie',
          year: '2024',
          country: 'Japan'
        } as unknown as Record<string, unknown>,
        lastFetched: Date.now()
      } as unknown as ReturnType<typeof metadataRepo.getCachedMetadata>);

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
            { codec_type: 'audio', codec_name: 'aac', tags: { language: 'jpn' } }
          ]
        });
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const mockFfmpegInstance = {
        outputOptions: vi.fn().mockReturnThis(),
        format: vi.fn().mockReturnThis(),
        output: vi.fn().mockReturnThis(),
        on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'end') setTimeout(() => handler(), 10);
          return mockFfmpegInstance;
        }),
        run: vi.fn().mockReturnThis()
      };
      activeMockFfmpegInstance = mockFfmpegInstance;

      const job = {
        id: 'job-1',
        data: {
          fileId: 'tt1234567',
          sourcePath: '/tmp/downloads/movie.mp4'
        }
      } as unknown as Job<{ fileId: string; sourcePath: string }>;

      const result = await processTranscodeJob(job as never);
      expect(result).toEqual({
        fileId: 'tt1234567',
        status: 'transcoded'
      });
    });

    it('throws error and publishes FAILED status if transcoding fails', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt9999999',
        subtitlesDir: '/media/movies/tt9999999/subtitles',
        hlsDir: '/media/movies/tt9999999/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const publishStatusSpy = vi.spyOn(queues, 'publishDownloadStatus').mockResolvedValue(1);

      vi.spyOn(ffmpeg, 'ffprobe').mockImplementation((_filePath, callback) => {
        (callback as (err: Error | null, data: unknown) => void)(new Error('Failed to probe'), null);
        return {} as unknown as ffmpeg.FfmpegCommand;
      });

      const mockFfmpegInstance = {
        outputOptions: vi.fn().mockReturnThis(),
        format: vi.fn().mockReturnThis(),
        output: vi.fn().mockReturnThis(),
        on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'error') setTimeout(() => handler(new Error('Transcoding failed')), 10);
          return mockFfmpegInstance;
        }),
        run: vi.fn().mockReturnThis()
      };
      activeMockFfmpegInstance = mockFfmpegInstance;

      const job = {
        id: 'job-fail',
        data: {
          fileId: 'tt9999999',
          sourcePath: '/tmp/downloads/corrupt.mp4'
        }
      } as unknown as Job<{ fileId: string; sourcePath: string }>;

      await expect(processTranscodeJob(job as never)).rejects.toThrow('Transcoding failed');
      expect(publishStatusSpy).toHaveBeenCalledWith('tt9999999', DOWNLOAD_STATUS.FAILED);
    });

    it('throws error if media directories cannot be resolved', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue(null);

      const job = {
        id: 'job-invalid',
        data: {
          fileId: 'invalid@@fileId',
          sourcePath: '/tmp/invalid'
        }
      } as unknown as Job<{ fileId: string; sourcePath: string }>;

      await expect(processTranscodeJob(job as never)).rejects.toThrow(
        'Could not resolve media directories for invalid@@fileId'
      );
    });
  });

  describe('Worker Initializers', () => {
    it('createTranscodeWorker initializes standard worker with defaults', () => {
      const worker = createTranscodeWorker();
      expect(worker).toBeDefined();
      expect((worker as unknown as { queueName: string }).queueName).toBe(QUEUE_NAMES.TRANSCODE);
    });

    it('createFastTranscodeWorker initializes fast queue lane worker', () => {
      const worker = createFastTranscodeWorker();
      expect(worker).toBeDefined();
      expect((worker as unknown as { queueName: string }).queueName).toBe(QUEUE_NAMES.TRANSCODE_FAST);
      expect((worker as unknown as { opts: { concurrency: number } }).opts.concurrency).toBe(
        WORKER_CONCURRENCY.TRANSCODE_FAST
      );
    });

    it('createHeavyTranscodeWorker initializes heavy queue lane worker', () => {
      const worker = createHeavyTranscodeWorker();
      expect(worker).toBeDefined();
      expect((worker as unknown as { queueName: string }).queueName).toBe(QUEUE_NAMES.TRANSCODE_HEAVY);
      expect((worker as unknown as { opts: { concurrency: number } }).opts.concurrency).toBe(
        WORKER_CONCURRENCY.TRANSCODE_HEAVY
      );
    });
  });
});
