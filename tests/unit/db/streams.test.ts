import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../../src/main/db/index.js';
import { streamsRepo } from '../../../src/main/db/streams.js';
import * as helpers from '../../../src/main/utils/helpers.js';

describe('db/streams - StreamsRepo', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM streams;
      DELETE FROM progress;
      DELETE FROM episode_metadata;
      DELETE FROM show_metadata;
      DELETE FROM movie_metadata;
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Recording Completed Movie Streams', () => {
    it('should add and retrieve a movie stream entry', () => {
      streamsRepo.registerStream('tt0063350', {
        quality: '1080p',
        size_bytes: 4500000000,
        ready_at: 1700000000
      });

      expect(streamsRepo.isReady('tt0063350')).toBe(true);

      const single = streamsRepo.getMovieStream('tt0063350');
      expect(single).not.toBeNull();
      expect(single?.id).toBe('tt0063350');
      expect(single?.quality).toBe('1080p');
      expect(single?.size_bytes).toBe(4500000000);
      expect(single?.ready_at).toBe(1700000000);
    });

    it('should return null for getMovieStream when movie is not ready', () => {
      const single = streamsRepo.getMovieStream('tt_not_ready');
      expect(single).toBeNull();
      expect(streamsRepo.isReady('tt_not_ready')).toBe(false);
    });

    it('should update movie stream details on subsequent registerStream call', () => {
      streamsRepo.registerStream('tt0063350', {
        quality: '720p',
        size_bytes: 2000000000
      });

      streamsRepo.registerStream('tt0063350', {
        quality: '1080p',
        size_bytes: 4000000000
      });

      const single = streamsRepo.getMovieStream('tt0063350');
      expect(single?.quality).toBe('1080p');
      expect(single?.size_bytes).toBe(4000000000);
    });
  });

  describe('Recording Completed Episode Streams', () => {
    it('should add and retrieve an episode stream entry', () => {
      streamsRepo.registerStream('tt0055662_s1_e1', {
        quality: '1080p',
        size_bytes: 1500000000,
        ready_at: 1700000000
      });

      expect(streamsRepo.isReady('tt0055662_s1_e1')).toBe(true);

      const single = streamsRepo.getEpisodeStream('tt0055662_s1_e1');
      expect(single).not.toBeNull();
      expect(single?.id).toBe('tt0055662_s1_e1');
      expect(single?.quality).toBe('1080p');
      expect(single?.size_bytes).toBe(1500000000);
      expect(single?.ready_at).toBe(1700000000);
    });

    it('should return null for getEpisodeStream when episode is not ready', () => {
      const single = streamsRepo.getEpisodeStream('tt0055662_s1_e99');
      expect(single).toBeNull();
      expect(streamsRepo.isReady('tt0055662_s1_e99')).toBe(false);
    });

    it('should retrieve all ready episodes for a show using getShowStreams', () => {
      streamsRepo.registerStream('tt0055662_s1_e1', {
        quality: '1080p',
        size_bytes: 1000000000
      });

      streamsRepo.registerStream('tt0055662_s1_e2', {
        quality: '1080p',
        size_bytes: 1100000000
      });

      // Different show
      streamsRepo.registerStream('tt0046642_s1_e1', {
        quality: '1080p',
        size_bytes: 900000000
      });

      const showStreams = streamsRepo.getShowStreams('tt0055662');
      expect(Object.keys(showStreams)).toHaveLength(2);
      expect(showStreams['tt0055662_s1_e1']).toBeDefined();
      expect(showStreams['tt0055662_s1_e2']).toBeDefined();
      expect(showStreams['tt0055662_s1_e1'].size_bytes).toBe(1000000000);
      expect(showStreams['tt0055662_s1_e2'].size_bytes).toBe(1100000000);
    });
  });

  describe('Aggregated Streams List & Size', () => {
    it('should combine movies and episodes in getStreams', () => {
      streamsRepo.registerStream('tt_movie_1', {
        size_bytes: 2000000000
      });

      streamsRepo.registerStream('tt_show_1_s1_e1', {
        size_bytes: 1000000000
      });

      const all = streamsRepo.getStreams();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['tt_movie_1'].size_bytes).toBe(2000000000);
      expect(all['tt_show_1_s1_e1'].size_bytes).toBe(1000000000);

      const totalSize = Object.values(all).reduce((acc, curr) => acc + (curr.size_bytes || 0), 0);
      expect(totalSize).toBe(3000000000);
    });

    it('should return empty object when no streams are registered', () => {
      const all = streamsRepo.getStreams();
      expect(all).toEqual({});
    });
  });

  describe('Deleting Streams', () => {
    it('should remove a movie stream entry with removeStream', () => {
      streamsRepo.registerStream('tt0063350', {
        size_bytes: 3000000000
      });
      expect(streamsRepo.isReady('tt0063350')).toBe(true);

      streamsRepo.removeStream('tt0063350');
      expect(streamsRepo.isReady('tt0063350')).toBe(false);
      expect(streamsRepo.getMovieStream('tt0063350')).toBeNull();
    });

    it('should remove an episode stream entry with removeStream', () => {
      streamsRepo.registerStream('tt0055662_s1_e1', {
        size_bytes: 1500000000
      });
      expect(streamsRepo.isReady('tt0055662_s1_e1')).toBe(true);

      streamsRepo.removeStream('tt0055662_s1_e1');
      expect(streamsRepo.isReady('tt0055662_s1_e1')).toBe(false);
      expect(streamsRepo.getEpisodeStream('tt0055662_s1_e1')).toBeNull();
    });

    it('should ignore invalid fileId in removeStream', () => {
      expect(() => streamsRepo.removeStream('')).not.toThrow();
      expect(() => streamsRepo.removeStream('invalid:format')).not.toThrow();
    });
  });

  describe('scanStreams (Disk Reconciliation)', () => {
    const testMovieId = 'tt_scan_movie_exists';
    const testMissingId = 'tt_scan_movie_missing';
    let realHlsDir: string;
    let realBaseDir: string;

    beforeEach(() => {
      const dirs = helpers.getMediaDirs(testMovieId);
      if (dirs) {
        realBaseDir = dirs.baseDir;
        realHlsDir = dirs.hlsDir;
        fs.mkdirSync(realHlsDir, { recursive: true });
        fs.writeFileSync(path.join(realHlsDir, 'index.m3u8'), '#EXTM3U');
      }
    });

    afterEach(() => {
      if (realBaseDir && fs.existsSync(realBaseDir)) {
        fs.rmSync(realBaseDir, { recursive: true, force: true });
      }
    });

    it('should keep streams that exist on disk and remove streams missing index.m3u8', () => {
      streamsRepo.registerStream(testMovieId, { size_bytes: 1000 });
      streamsRepo.registerStream(testMissingId, { size_bytes: 1000 });

      streamsRepo.scanStreams();

      expect(streamsRepo.isReady(testMovieId)).toBe(true);
      expect(streamsRepo.isReady(testMissingId)).toBe(false);
    });
  });

  describe('Cascade Deletes', () => {
    it('should cascade delete streams when movie_metadata is deleted', () => {
      db.prepare('INSERT INTO movie_metadata (id, title) VALUES (?, ?)').run('tt0063350', 'Test Movie');
      streamsRepo.registerStream('tt0063350', {
        size_bytes: 4000000000
      });
      expect(streamsRepo.isReady('tt0063350')).toBe(true);

      // Delete parent movie_metadata
      db.prepare('DELETE FROM movie_metadata WHERE id = ?').run('tt0063350');

      expect(streamsRepo.isReady('tt0063350')).toBe(false);
    });

    it('should cascade delete streams when show_metadata or episode_metadata is deleted', () => {
      db.prepare('INSERT INTO show_metadata (id, title) VALUES (?, ?)').run('tt0055662', 'Test Show');
      streamsRepo.registerStream('tt0055662_s1_e1', {
        size_bytes: 1500000000
      });
      expect(streamsRepo.isReady('tt0055662_s1_e1')).toBe(true);

      // Delete parent show_metadata
      db.prepare('DELETE FROM show_metadata WHERE id = ?').run('tt0055662');

      expect(streamsRepo.isReady('tt0055662_s1_e1')).toBe(false);
    });
  });
});
