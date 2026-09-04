import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  parseFileId,
  getMediaDirs,
  getDirSize,
  fetchWithTimeout,
  cleanupJobTempDir,
  toUserMediaRequestStatus
} from '../../../src/main/utils/helpers.js';
import { STREAMS_DIR, MOVIES_TEMP, SHOWS_TEMP } from '../../../src/main/utils/paths.js';
import { MEDIA_REQUEST_STATUS } from '../../../src/main/types/events.js';

describe('utils/helpers', () => {
  describe('parseFileId', () => {
    it('should correctly parse standard movie IDs', () => {
      const result = parseFileId('tt0137523');
      expect(result).toEqual({
        type: 'movie',
        id: 'tt0137523',
        season: null,
        episode: null
      });
    });

    it('should correctly parse movie IDs with alphanumeric characters, underscores, and hyphens', () => {
      const result1 = parseFileId('movie_12345');
      expect(result1).toEqual({
        type: 'movie',
        id: 'movie_12345',
        season: null,
        episode: null
      });

      const result2 = parseFileId('custom-media-id-999');
      expect(result2).toEqual({
        type: 'movie',
        id: 'custom-media-id-999',
        season: null,
        episode: null
      });
    });

    it('should correctly parse show IDs with season and episode format (id_sX_eY)', () => {
      const result = parseFileId('tt0944947_s1_e1');
      expect(result).toEqual({
        type: 'show',
        id: 'tt0944947',
        season: '1',
        episode: '1'
      });
    });

    it('should correctly parse multi-digit seasons and episodes', () => {
      const result = parseFileId('tt0944947_s12_e105');
      expect(result).toEqual({
        type: 'show',
        id: 'tt0944947',
        season: '12',
        episode: '105'
      });
    });

    it('should reject path traversal attempts and return null', () => {
      expect(parseFileId('../../etc/passwd')).toBeNull();
      expect(parseFileId('../secrets')).toBeNull();
      expect(parseFileId('tt1234/evil')).toBeNull();
      expect(parseFileId('..\\windows\\system32')).toBeNull();
      expect(parseFileId('/var/log/syslog')).toBeNull();
      expect(parseFileId('tt123/../tt456')).toBeNull();
    });

    it('should reject invalid, empty, or non-string inputs', () => {
      expect(parseFileId('')).toBeNull();
      expect(parseFileId(null as unknown as string)).toBeNull();
      expect(parseFileId(undefined as unknown as string)).toBeNull();
      expect(parseFileId(12345 as unknown as string)).toBeNull();
      expect(parseFileId({} as unknown as string)).toBeNull();
    });

    it('should reject inputs containing illegal characters (spaces, colons, punctuation)', () => {
      expect(parseFileId('tt1234:1:1')).toBeNull();
      expect(parseFileId('tt1234 567')).toBeNull();
      expect(parseFileId('tt1234;rm -rf /')).toBeNull();
      expect(parseFileId('tt1234$evil')).toBeNull();
      expect(parseFileId('tt1234<script>')).toBeNull();
      expect(parseFileId('tt1234\nnewline')).toBeNull();
    });
  });

  describe('getMediaDirs', () => {
    it('should generate correct directory paths for movies', () => {
      const dirs = getMediaDirs('tt0137523');
      expect(dirs).not.toBeNull();
      const expectedBase = path.join(STREAMS_DIR, 'movies', 'tt0137523');
      expect(dirs?.baseDir).toBe(expectedBase);
      expect(dirs?.subtitlesDir).toBe(path.join(expectedBase, 'subtitles'));
      expect(dirs?.hlsDir).toBe(path.join(expectedBase, 'hls'));
    });

    it('should generate correct directory paths for shows', () => {
      const dirs = getMediaDirs('tt0944947_s2_e5');
      expect(dirs).not.toBeNull();
      const expectedBase = path.join(STREAMS_DIR, 'shows', 'tt0944947', '2', '5');
      expect(dirs?.baseDir).toBe(expectedBase);
      expect(dirs?.subtitlesDir).toBe(path.join(expectedBase, 'subtitles'));
      expect(dirs?.hlsDir).toBe(path.join(expectedBase, 'hls'));
    });

    it('should return null for malicious path traversal file IDs', () => {
      expect(getMediaDirs('../../etc/passwd')).toBeNull();
      expect(getMediaDirs('../../../root')).toBeNull();
      expect(getMediaDirs('movie/../other')).toBeNull();
    });

    it('should return null for invalid file IDs', () => {
      expect(getMediaDirs('')).toBeNull();
      expect(getMediaDirs('invalid:id:colon')).toBeNull();
      expect(getMediaDirs(null as unknown as string)).toBeNull();
    });
  });

  describe('getDirSize', () => {
    let testTempDir: string;

    beforeEach(() => {
      testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-helpers-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      }
    });

    it('should return 0 for a non-existent directory', () => {
      const nonExistent = path.join(testTempDir, 'does-not-exist');
      expect(getDirSize(nonExistent)).toBe(0);
    });

    it('should return 0 for an empty directory', () => {
      expect(getDirSize(testTempDir)).toBe(0);
    });

    it('should return file size when passed a direct file path', () => {
      const filePath = path.join(testTempDir, 'file.txt');
      fs.writeFileSync(filePath, Buffer.alloc(1024)); // 1 KB
      expect(getDirSize(filePath)).toBe(1024);
    });

    it('should accurately calculate recursive directory size', () => {
      // Create root level files
      fs.writeFileSync(path.join(testTempDir, 'file1.bin'), Buffer.alloc(500));
      fs.writeFileSync(path.join(testTempDir, 'file2.bin'), Buffer.alloc(1500));

      // Create nested directory with files
      const subDir = path.join(testTempDir, 'nested');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'file3.bin'), Buffer.alloc(3000));

      // Create deep nested directory with files
      const deepDir = path.join(subDir, 'deep');
      fs.mkdirSync(deepDir);
      fs.writeFileSync(path.join(deepDir, 'file4.bin'), Buffer.alloc(5000));

      const totalSize = getDirSize(testTempDir);
      expect(totalSize).toBe(500 + 1500 + 3000 + 5000);
    });

    it('should handle filesystem errors gracefully and return 0', () => {
      const spy = vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(getDirSize(testTempDir)).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();

      spy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('fetchWithTimeout', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should succeed and return response when fetch resolves before timeout', async () => {
      const mockResponse = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      const res = await fetchWithTimeout('https://api.example.com/data', {}, 5000);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true });
      expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    });

    it('should pass custom RequestInit options including headers', async () => {
      const mockResponse = new Response('ok', { status: 200 });
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

      await fetchWithTimeout('https://api.example.com/test', {
        method: 'POST',
        headers: { 'X-Custom-Header': 'val' }
      }, 3000);

      expect(globalFetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'X-Custom-Header': 'val' },
          signal: expect.any(AbortSignal)
        })
      );
    });

    it('should throw an error when request aborts due to timeout', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      await expect(fetchWithTimeout('https://api.example.com/slow', {}, 50)).rejects.toThrow();
    });
  });

  describe('cleanupJobTempDir', () => {
    it('purges rawTempDir recursively', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

      cleanupJobTempDir('/tmp/downloads/temp/shows/tt12345_s1_e1');

      expect(rmSpy).toHaveBeenCalledWith('/tmp/downloads/temp/shows/tt12345_s1_e1', {
        recursive: true,
        force: true
      });
    });

    it('safely does nothing when dirPath is null or undefined', () => {
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
      rmSpy.mockClear();

      cleanupJobTempDir(null);
      cleanupJobTempDir(undefined);

      expect(rmSpy).not.toHaveBeenCalled();
    });

    it('never removes base MOVIES_TEMP or SHOWS_TEMP', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});

      cleanupJobTempDir(MOVIES_TEMP);
      cleanupJobTempDir(SHOWS_TEMP);

      expect(rmSpy).not.toHaveBeenCalledWith(MOVIES_TEMP, expect.anything());
      expect(rmSpy).not.toHaveBeenCalledWith(SHOWS_TEMP, expect.anything());
    });
  });

  describe('toUserMediaRequestStatus', () => {
    it('should map queued status to queued with 0.00 progress', () => {
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.QUEUED, 50)).toEqual({
        status: 'queued',
        progress: '0.00'
      });
    });

    it('should scale downloading status (0-100% -> 0-80% preparing)', () => {
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.DOWNLOADING, 0)).toEqual({
        status: 'preparing',
        progress: '0.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.DOWNLOADING, 50)).toEqual({
        status: 'preparing',
        progress: '40.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.DOWNLOADING, '100.00')).toEqual({
        status: 'preparing',
        progress: '80.00'
      });
    });

    it('should scale processing status (0-100% -> 80-100% preparing)', () => {
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.PROCESSING, 0)).toEqual({
        status: 'preparing',
        progress: '80.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.PROCESSING, 50)).toEqual({
        status: 'preparing',
        progress: '90.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.PROCESSING, 100)).toEqual({
        status: 'preparing',
        progress: '100.00'
      });
    });

    it('should map ready status to ready with 100.00 progress', () => {
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.READY, 0)).toEqual({
        status: 'ready',
        progress: '100.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.READY, 50)).toEqual({
        status: 'ready',
        progress: '100.00'
      });
    });

    it('should map failed status with 0.00 progress', () => {
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.FAILED, 75)).toEqual({
        status: 'failed',
        progress: '0.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.REMOVED, 75)).toEqual({
        status: 'removed',
        progress: '0.00'
      });
    });

    it('should handle edge case inputs (NaN, clamped bounds, defaults)', () => {
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.DOWNLOADING, 'invalid')).toEqual({
        status: 'preparing',
        progress: '0.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.DOWNLOADING, -10)).toEqual({
        status: 'preparing',
        progress: '0.00'
      });
      expect(toUserMediaRequestStatus(MEDIA_REQUEST_STATUS.DOWNLOADING, 150)).toEqual({
        status: 'preparing',
        progress: '80.00'
      });
      expect(toUserMediaRequestStatus('unknown_status' as any, 45.678)).toEqual({
        status: 'queued',
        progress: '0.00'
      });
    });
  });
});
