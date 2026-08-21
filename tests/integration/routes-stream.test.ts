import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import streamRouter from '../../src/main/routes/stream.js';
import { DOWNLOADS_DIR } from '../../src/main/utils/paths.js';

function createStreamTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(streamRouter);
  return app;
}

describe('Stream & Subtitle Routes Integration Tests', () => {
  let app: Express;

  const testMovieId = 'tt9999001';
  const testShowId = 'tt9999002';
  const testShowFileId = `${testShowId}_s1_e1`;

  const movieHlsDir = path.join(DOWNLOADS_DIR, 'movies', testMovieId, 'hls');
  const movieSubDir = path.join(DOWNLOADS_DIR, 'movies', testMovieId, 'subtitles');
  const showHlsDir = path.join(DOWNLOADS_DIR, 'series', testShowId, '1', '1', 'hls');
  const showSubDir = path.join(DOWNLOADS_DIR, 'series', testShowId, '1', '1', 'subtitles');

  const movieBaseDir = path.join(DOWNLOADS_DIR, 'movies', testMovieId);
  const showBaseDir = path.join(DOWNLOADS_DIR, 'series', testShowId);

  const sampleM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment0.ts
#EXT-X-ENDLIST`;

  const sampleTs = Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0xb0, 0x0d]); // Mock MPEG-TS sync byte 0x47 packet
  const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hello, world!`;

  beforeAll(() => {
    app = createStreamTestApp();

    // Create test media folders
    fs.mkdirSync(movieHlsDir, { recursive: true });
    fs.mkdirSync(movieSubDir, { recursive: true });
    fs.mkdirSync(showHlsDir, { recursive: true });
    fs.mkdirSync(showSubDir, { recursive: true });

    // Populate test files
    fs.writeFileSync(path.join(movieHlsDir, 'index.m3u8'), sampleM3u8, 'utf-8');
    fs.writeFileSync(path.join(movieHlsDir, 'segment0.ts'), sampleTs);
    fs.writeFileSync(path.join(movieSubDir, 'en.vtt'), sampleVtt, 'utf-8');

    fs.writeFileSync(path.join(showHlsDir, 'index.m3u8'), sampleM3u8, 'utf-8');
    fs.writeFileSync(path.join(showSubDir, 'es.vtt'), sampleVtt, 'utf-8');
  });

  afterAll(() => {
    // Clean up test directories
    try {
      if (fs.existsSync(movieBaseDir)) {
        fs.rmSync(movieBaseDir, { recursive: true, force: true });
      }
      if (fs.existsSync(showBaseDir)) {
        fs.rmSync(showBaseDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  // ==========================================
  // 1. GET /stream/hls/:id/:filename
  // ==========================================
  describe('GET /stream/hls/:id/:filename', () => {
    it('serves .m3u8 playlist with Content-Type application/vnd.apple.mpegurl and CORS headers', async () => {
      const res = await request(app).get(`/stream/hls/${testMovieId}/index.m3u8`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/vnd\.apple\.mpegurl/i);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.text).toContain('#EXTM3U');
      expect(res.text).toContain('segment0.ts');
    });

    it('serves .ts video segment with Content-Type video/MP2T and CORS headers', async () => {
      const res = await request(app).get(`/stream/hls/${testMovieId}/segment0.ts`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/video\/MP2T/i);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.body).toBeInstanceOf(Buffer);
      expect(res.body[0]).toBe(0x47);
    });

    it('serves show episode .m3u8 playlist via composite id (tt_s1_e1)', async () => {
      const res = await request(app).get(`/stream/hls/${testShowFileId}/index.m3u8`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/vnd\.apple\.mpegurl/i);
      expect(res.text).toContain('#EXTM3U');
    });

    it('returns 404 when file does not exist in media directory', async () => {
      const res = await request(app).get(`/stream/hls/${testMovieId}/nonexistent.m3u8`);

      expect(res.status).toBe(404);
      expect(res.text).toBe('File not found');
    });

    it('returns 404 when id does not exist', async () => {
      const res = await request(app).get('/stream/hls/tt0000000/index.m3u8');

      expect(res.status).toBe(404);
      expect(res.text).toBe('File not found');
    });
  });

  // ==========================================
  // 2. GET /subtitles/:fileId/:filename
  // ==========================================
  describe('GET /subtitles/:fileId/:filename', () => {
    it('serves .vtt subtitle file with Content-Type text/vtt and CORS headers', async () => {
      const res = await request(app).get(`/subtitles/${testMovieId}/en.vtt`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/vtt/i);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.text).toContain('WEBVTT');
      expect(res.text).toContain('Hello, world!');
    });

    it('serves series episode subtitle file via composite id (tt_s1_e1)', async () => {
      const res = await request(app).get(`/subtitles/${testShowFileId}/es.vtt`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/vtt/i);
      expect(res.text).toContain('WEBVTT');
    });

    it('returns 404 when subtitle file does not exist', async () => {
      const res = await request(app).get(`/subtitles/${testMovieId}/fr.vtt`);

      expect(res.status).toBe(404);
      expect(res.text).toBe('Subtitle not found');
    });

    it('returns 404 when fileId does not exist', async () => {
      const res = await request(app).get('/subtitles/tt0000000/en.vtt');

      expect(res.status).toBe(404);
      expect(res.text).toBe('Subtitle not found');
    });
  });

  // ==========================================
  // 3. Path Traversal & Security Tests
  // ==========================================
  describe('Path Traversal & Security Validation', () => {
    it('prevents directory traversal using ../../ in filename for /stream/hls', async () => {
      const res = await request(app).get(`/stream/hls/${testMovieId}/../../../../etc/passwd`);

      // Express or path.basename safely restricts directory escaping and returns 404
      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('root:');
    });

    it('prevents directory traversal using URL-encoded slashes (%2e%2e%2f) in /stream/hls', async () => {
      const res = await request(app).get(`/stream/hls/${testMovieId}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('root:');
    });

    it('prevents directory traversal in media ID param for /stream/hls', async () => {
      const res = await request(app).get('/stream/hls/..%2f..%2fetc/passwd');

      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('root:');
    });

    it('prevents directory traversal using ../../ in filename for /subtitles', async () => {
      const res = await request(app).get(`/subtitles/${testMovieId}/../../../../etc/passwd`);

      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('root:');
    });

    it('prevents directory traversal using URL-encoded slashes in /subtitles', async () => {
      const res = await request(app).get(`/subtitles/${testMovieId}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

      expect([400, 404]).toContain(res.status);
      expect(res.text).not.toContain('root:');
    });

    it('rejects invalid fileId formats with special characters safely without erroring', async () => {
      const invalidIds = [
        'invalid*id',
        'movie;rm -rf /',
        'id<script>',
        '../../../etc',
        'id|whoami'
      ];

      for (const id of invalidIds) {
        const streamRes = await request(app).get(`/stream/hls/${encodeURIComponent(id)}/index.m3u8`);
        expect(streamRes.status).toBeGreaterThanOrEqual(400);
        expect(streamRes.status).toBeLessThan(500);

        const subRes = await request(app).get(`/subtitles/${encodeURIComponent(id)}/en.vtt`);
        expect(subRes.status).toBeGreaterThanOrEqual(400);
        expect(subRes.status).toBeLessThan(500);
      }
    });
  });
});
