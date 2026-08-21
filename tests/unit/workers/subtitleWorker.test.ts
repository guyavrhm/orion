import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import * as childProcess from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import {
  analyzeLine,
  fixRtlSubtitleText,
  applyRtlFixIfNecessary,
  extractEmbeddedSubtitles,
  scrapeAndSaveSubtitles,
  runFfs,
  readScores,
  writeScores,
  scoreLocalSubtitles,
  processSubtitles,
  processSubtitleJob,
  createSubtitleWorker,
  getFfsCommand
} from '../../../src/main/workers/subtitleWorker.js';
import { openSubtitlesClient } from '../../../src/main/clients/opensubtitles.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import { QUEUE_NAMES } from '../../../src/main/config/queue.js';
import type { Job } from 'bullmq';

// Mock child_process for offline execution
vi.mock('node:child_process', () => {
  return {
    execFile: vi.fn((_file, _args, opts, callback) => {
      const cb = typeof opts === 'function' ? opts : callback;
      if (cb) {
        cb(null, '', 'score: 0.92\noffset seconds: 0.10');
      }
      return { pid: 9999 };
    })
  };
});

// Mock fluent-ffmpeg
vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = vi.fn();
  (ffmpegFn as unknown as Record<string, unknown>).ffprobe = vi.fn();
  (ffmpegFn as unknown as Record<string, unknown>).setFfmpegPath = vi.fn();
  (ffmpegFn as unknown as Record<string, unknown>).setFfprobePath = vi.fn();
  return {
    default: ffmpegFn
  };
});

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
 * Helper scoring algorithm matching release groups, resolution, fps, and source.
 * Verifies matching rules for subtitle selection against media metadata.
 */
export function calculateSubtitleScore(
  subtitleFilename: string,
  mediaMetadata: {
    releaseGroup?: string;
    resolution?: string;
    source?: string;
    fps?: number;
    matchType?: 'h' | 'i';
  }
): number {
  let score = 0;
  const subLower = subtitleFilename.toLowerCase();

  // 1. Hash match vs IMDb match
  if (mediaMetadata.matchType === 'h') {
    score += 100;
  } else if (mediaMetadata.matchType === 'i') {
    score += 50;
  }

  // 2. Release group match (e.g. SPARKS, RARBG, YIFY, FGT, CMRG)
  if (mediaMetadata.releaseGroup) {
    const groupLower = mediaMetadata.releaseGroup.toLowerCase();
    if (subLower.includes(groupLower)) {
      score += 40;
    }
  }

  // 3. Resolution match (1080p, 720p, 2160p, 480p)
  if (mediaMetadata.resolution) {
    const resLower = mediaMetadata.resolution.toLowerCase();
    if (subLower.includes(resLower)) {
      score += 20;
    }
  }

  // 4. Source match (BluRay, WEB-DL, WEBRip, HDTV, DVD)
  if (mediaMetadata.source) {
    const srcLower = mediaMetadata.source.toLowerCase();
    if (subLower.includes(srcLower)) {
      score += 15;
    }
  }

  // 5. Framerate / FPS matching (23.976, 24, 25, 29.97)
  if (mediaMetadata.fps) {
    if (mediaMetadata.fps === 23.976 && (subLower.includes('23.976') || subLower.includes('23.98') || subLower.includes('23fps'))) {
      score += 10;
    } else if (mediaMetadata.fps === 25 && subLower.includes('25fps')) {
      score += 10;
    }
  }

  return score;
}

describe('subtitleWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('calculateSubtitleScore', () => {
    it('scores exact release group, resolution, source, and fps match highest', () => {
      const videoMeta = {
        releaseGroup: 'SPARKS',
        resolution: '1080p',
        source: 'BluRay',
        fps: 23.976,
        matchType: 'h' as const
      };

      const matchSub = 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264-SPARKS.23.976fps.eng.srt';
      const nonMatchSub = 'Night.of.the.Living.Dead.1968.720p.HDTV.x264-EVO.eng.srt';

      const matchScore = calculateSubtitleScore(matchSub, videoMeta);
      const nonMatchScore = calculateSubtitleScore(nonMatchSub, videoMeta);

      // Hash match (100) + SPARKS (40) + 1080p (20) + BluRay (15) + 23.976 (10) = 185
      expect(matchScore).toBe(185);
      // Hash match (100) = 100
      expect(nonMatchScore).toBe(100);
      expect(matchScore).toBeGreaterThan(nonMatchScore);
    });

    it('scores resolution and source matches when release group is absent', () => {
      const videoMeta = {
        resolution: '720p',
        source: 'WEB-DL',
        matchType: 'i' as const
      };

      const score = calculateSubtitleScore('Series.S01E01.720p.WEB-DL.srt', videoMeta);
      // IMDb match (50) + 720p (20) + WEB-DL (15) = 85
      expect(score).toBe(85);
    });
  });

  describe('analyzeLine', () => {
    it('correctly peels outer HTML tags and extracts core text', () => {
      expect(analyzeLine('Hello world')).toEqual({
        openTags: [],
        closeTags: [],
        coreText: 'Hello world'
      });

      expect(analyzeLine('<i>Italic text</i>')).toEqual({
        openTags: ['<i>'],
        closeTags: ['</i>'],
        coreText: 'Italic text'
      });

      expect(analyzeLine('<i><b><font color="#ffff00">Bold italic yellow</font></b></i>')).toEqual({
        openTags: ['<i>', '<b>', '<font color="#ffff00">'],
        closeTags: ['</font>', '</b>', '</i>'],
        coreText: 'Bold italic yellow'
      });
    });
  });

  describe('fixRtlSubtitleText', () => {
    it('normalizes carriage returns and preserves WEBVTT header and cues', () => {
      const raw = 'WEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:04.000\r\nHello world!\r\n';
      const result = fixRtlSubtitleText(raw);

      expect(result).toContain('WEBVTT');
      expect(result).toContain('00:00:01.000 --> 00:00:04.000');
      expect(result).toContain('Hello world!');
      expect(result).not.toContain('\r');
    });

    it('detects Hebrew and Arabic characters and prepends \\u202b (RLE)', () => {
      const hebrewSubtitle = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
שלום מה שלומך`;

      const fixed = fixRtlSubtitleText(hebrewSubtitle);
      expect(fixed).toContain('\u202bשלום מה שלומך');
    });

    it('detects and fixes LTR-hacked inverted punctuation in Hebrew/Arabic subtitles', () => {
      const hackedLines = [
        'WEBVTT',
        '',
        '1',
        '00:00:01.000 --> 00:00:02.000',
        '!שלום עולם',
        '2',
        '00:00:02.000 --> 00:00:03.000',
        '?מה אתה עושה',
        '3',
        '00:00:03.000 --> 00:00:04.000',
        '.אני הולך הביתה',
        '4',
        '00:00:04.000 --> 00:00:05.000',
        '!זה לא ייאמן',
        '5',
        '00:00:05.000 --> 00:00:06.000',
        '!תעצור מיד',
        '6',
        '00:00:06.000 --> 00:00:07.000',
        '?איפה כולם',
        '7',
        '00:00:07.000 --> 00:00:08.000',
        '!הם ברחו',
        '8',
        '00:00:08.000 --> 00:00:09.000',
        '.אין זמן',
        '9',
        '00:00:09.000 --> 00:00:10.000',
        '!מהר מהר',
        '10',
        '00:00:10.000 --> 00:00:11.000',
        '!בוא אחרי',
        '11',
        '00:00:11.000 --> 00:00:12.000',
        '?אתה בטוח',
        '12',
        '00:00:12.000 --> 00:00:13.000',
        '!כן בהחלט'
      ].join('\n');

      const fixed = fixRtlSubtitleText(hackedLines);

      expect(fixed).toContain('\u202bשלום עולם!');
      expect(fixed).toContain('\u202bמה אתה עושה?');
      expect(fixed).toContain('\u202bאני הולך הביתה.');
    });

    it('preserves outer HTML tags when fixing RTL punctuation and applying RLE', () => {
      const lines = ['WEBVTT', ''];
      for (let i = 1; i <= 12; i++) {
        lines.push(`${i}`);
        lines.push(`00:00:0${i - 1}.000 --> 00:00:0${i}.000`);
        lines.push(`<i>!טקסט מודגש</i>`);
        lines.push('');
      }

      const fixed = fixRtlSubtitleText(lines.join('\n'));
      expect(fixed).toContain('\u202b<i>טקסט מודגש!</i>');
    });
  });

  describe('applyRtlFixIfNecessary', () => {
    it('applies RTL fix to local file if language is in RTL_LANGS', () => {
      const filePath = '/tmp/subtitles/movie_heb_0.vtt';
      const originalContent = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nשלום';

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(originalContent);
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      applyRtlFixIfNecessary(filePath);

      expect(writeSpy).toHaveBeenCalledWith(filePath, expect.stringContaining('\u202bשלום'), 'utf8');
    });

    it('skips fixing for non-RTL languages', () => {
      const filePath = '/tmp/subtitles/movie_eng_0.vtt';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const readSpy = vi.spyOn(fs, 'readFileSync');

      applyRtlFixIfNecessary(filePath);

      expect(readSpy).not.toHaveBeenCalled();
    });
  });

  describe('extractEmbeddedSubtitles', () => {
    it('extracts text-based embedded subtitle streams and converts to VTT', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as string);

      (ffmpeg.ffprobe as unknown as ReturnType<typeof vi.fn>).mockImplementation((_file: string, callback: (err: Error | null, data: unknown) => void) => {
        callback(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264' },
            { codec_type: 'subtitle', codec_name: 'subrip', index: 2, tags: { language: 'eng' } },
            { codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', index: 3, tags: { language: 'eng' } } // bitmap image (ignored)
          ]
        });
      });

      const execSpy = vi.spyOn(childProcess, 'execFile');

      const result = await extractEmbeddedSubtitles('tt1234567', '/media/source.mkv');
      expect(result).toBe(true);
      expect(execSpy).toHaveBeenCalled();
    });

    it('returns false when no embedded text subtitles are present', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });

      (ffmpeg.ffprobe as unknown as ReturnType<typeof vi.fn>).mockImplementation((_file: string, callback: (err: Error | null, data: unknown) => void) => {
        callback(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264' },
            { codec_type: 'subtitle', codec_name: 'dvd_subtitle', index: 2, tags: { language: 'eng' } }
          ]
        });
      });

      const result = await extractEmbeddedSubtitles('tt1234567', '/media/source.mkv');
      expect(result).toBe(false);
    });
  });

  describe('scrapeAndSaveSubtitles', () => {
    it('fetches OpenSubtitles candidates, formats SRT to WEBVTT, and writes to disk', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as unknown as string);

      vi.spyOn(openSubtitlesClient, 'fetchSubtitles').mockResolvedValue([
        {
          id: 'sub-1',
          lang: 'eng',
          m: 'h',
          url: 'https://subs.test/eng.srt',
          format: 'srt'
        } as never
      ]);

      const mockSrtContent = '1\r\n00:00:01,000 --> 00:00:04,000\r\nHello from OpenSubtitles';
      vi.spyOn(helpers, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockSrtContent)
      } as unknown as Response);

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      await scrapeAndSaveSubtitles('tt1234567', 'tt1234567', 'movie');

      expect(writeSpy).toHaveBeenCalledWith(
        path.join('/media/movies/tt1234567/subtitles', 'tt1234567_eng_0.vtt'),
        expect.stringContaining('WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000'),
        'utf-8'
      );
    });
  });

  describe('runFfs and scoreLocalSubtitles', () => {
    it('runFfs parses score and offset seconds from ffsubsync stderr output', async () => {
      const mockStderr = `
INFO:ffsubsync:score: 0.875
INFO:ffsubsync:offset seconds: -0.250
`;
      vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cb) {
          cb(null, '', mockStderr);
        }
        return { pid: 9999 } as unknown as childProcess.ChildProcess;
      });

      const score = await runFfs('ffs', '/tmp/video.mp4', '/tmp/sub.vtt');
      expect(score).toBe(0.875);
    });

    it('readScores and writeScores manipulate scores.json correctly', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ track_1: 0.95 }));
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const scores = readScores('/tmp/subs');
      expect(scores).toEqual({ track_1: 0.95 });

      writeScores('/tmp/subs', { track_1: 0.95, track_2: 0.8 });
      expect(writeSpy).toHaveBeenCalledWith(
        path.join('/tmp/subs', 'scores.json'),
        JSON.stringify({ track_1: 0.95, track_2: 0.8 }, null, 2),
        'utf8'
      );
    });

    it('scoreLocalSubtitles serializes speech on first run and aligns subsequent subtitles', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'tt1234567_eng_0.vtt',
        'tt1234567_eng_1.vtt'
      ] as unknown as fs.Dirent[]);

      const execSpy = vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cb) {
          cb(null, '', 'score: 0.92\noffset seconds: 0.10');
        }
        return { pid: 9999 } as unknown as childProcess.ChildProcess;
      });

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await scoreLocalSubtitles('tt1234567', '/media/video.mp4');

      expect(execSpy).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledWith(
        path.join('/media/movies/tt1234567/subtitles', 'scores.json'),
        expect.any(String),
        'utf8'
      );
    });

    it('handles ENOENT gracefully when ffsubsync is not installed', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['tt1234567_eng_0.vtt'] as unknown as fs.Dirent[]);

      const enoentErr = new Error('spawn ffs ENOENT') as Error & { code: string };
      enoentErr.code = 'ENOENT';

      vi.spyOn(childProcess, 'execFile').mockImplementation((_file, _args, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        if (cb) {
          cb(enoentErr, '', '');
        }
        return { pid: 9999 } as unknown as childProcess.ChildProcess;
      });

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      await scoreLocalSubtitles('tt1234567', '/media/video.mp4');

      expect(writeSpy).toHaveBeenCalledWith(
        path.join('/media/movies/tt1234567/subtitles', 'scores.json'),
        expect.stringContaining('"tt1234567_eng_0": 0'),
        'utf8'
      );
    });
  });

  describe('processSubtitleJob and Worker', () => {
    it('successfully processes subtitle job and returns subtitles_ready', async () => {
      vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
        baseDir: '/media/movies/tt1234567',
        subtitlesDir: '/media/movies/tt1234567/subtitles',
        hlsDir: '/media/movies/tt1234567/hls'
      });
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (String(p).includes('scores.json')) return true; // Already processed
        return false;
      });

      const job = {
        id: 'job-sub-1',
        data: {
          fileId: 'tt1234567',
          sourcePath: '/media/video.mp4',
          fileHash: 'hash_123',
          fileSize: 10000,
          targetFileName: 'movie.mp4'
        }
      } as unknown as Job;

      const result = await processSubtitleJob(job as never);
      expect(result).toEqual({
        fileId: 'tt1234567',
        status: 'subtitles_ready'
      });
    });

    it('throws if fileId is invalid', async () => {
      const job = {
        id: 'job-sub-invalid',
        data: {
          fileId: 'invalid@@@',
          sourcePath: '/media/video.mp4'
        }
      } as unknown as Job;

      await expect(processSubtitleJob(job as never)).rejects.toThrow(
        'Invalid fileId format for subtitle processing: invalid@@@'
      );
    });

    it('createSubtitleWorker initializes BullMQ worker properly', () => {
      const worker = createSubtitleWorker();
      expect(worker).toBeDefined();
      expect((worker as unknown as { queueName: string }).queueName).toBe(QUEUE_NAMES.SUBTITLE);
    });
  });
});
