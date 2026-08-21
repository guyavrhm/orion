import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../../../src/main/db/index.js';
import { downloadsRepo, DownloadsRepo } from '../../../src/main/db/downloads.js';
import * as helpers from '../../../src/main/utils/helpers.js';

describe('db/downloads - DownloadsRepo', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM movie_downloads;
      DELETE FROM episode_downloads;
      DELETE FROM movie_progress;
      DELETE FROM episode_progress;
      DELETE FROM episode_metadata;
      DELETE FROM show_metadata;
      DELETE FROM movie_metadata;
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Recording Completed Movie Downloads', () => {
    it('should add and retrieve a movie download entry', () => {
      downloadsRepo.addDownloadEntry('tt0137523', {
        fileName: 'Fight.Club.1999.1080p.BluRay.mkv',
        torrentHash: 'torrent_hash_123',
        fileHash: 'file_hash_123',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 4500000000
      });

      expect(downloadsRepo.isDownloaded('tt0137523')).toBe(true);

      const single = downloadsRepo.getMovieDownloadSingle('tt0137523');
      expect(single).not.toBeNull();
      expect(single?.movie_id).toBe('tt0137523');
      expect(single?.fileName).toBe('Fight.Club.1999.1080p.BluRay.mkv');
      expect(single?.torrentHash).toBe('torrent_hash_123');
      expect(single?.fileHash).toBe('file_hash_123');
      expect(single?.fileIdx).toBe(0);
      expect(single?.quality).toBe('1080p');
      expect(single?.sizeBytes).toBe(4500000000);
      expect(typeof single?.downloadTime).toBe('number');
    });

    it('should return null for getMovieDownloadSingle when movie is not downloaded', () => {
      const single = downloadsRepo.getMovieDownloadSingle('tt_not_downloaded');
      expect(single).toBeNull();
      expect(downloadsRepo.isDownloaded('tt_not_downloaded')).toBe(false);
    });

    it('should update movie download details on subsequent addDownloadEntry call', () => {
      downloadsRepo.addDownloadEntry('tt0137523', {
        fileName: 'Fight.Club.720p.mkv',
        quality: '720p',
        sizeBytes: 2000000000
      });

      downloadsRepo.addDownloadEntry('tt0137523', {
        fileName: 'Fight.Club.1080p.mkv',
        quality: '1080p',
        sizeBytes: 4000000000
      });

      const single = downloadsRepo.getMovieDownloadSingle('tt0137523');
      expect(single?.quality).toBe('1080p');
      expect(single?.sizeBytes).toBe(4000000000);
    });
  });

  describe('Recording Completed Episode Downloads', () => {
    it('should add and retrieve an episode download entry', () => {
      downloadsRepo.addDownloadEntry('tt0944947_s1_e1', {
        fileName: 'Game.of.Thrones.S01E01.1080p.mkv',
        torrentHash: 'thash_got_1',
        fileHash: 'fhash_got_1',
        fileIdx: 1,
        quality: '1080p',
        sizeBytes: 1500000000
      });

      expect(downloadsRepo.isDownloaded('tt0944947_s1_e1')).toBe(true);

      const single = downloadsRepo.getEpisodeDownloadSingle('tt0944947_s1_e1');
      expect(single).not.toBeNull();
      expect(single?.episode_id).toBe('tt0944947_s1_e1');
      expect(single?.fileName).toBe('Game.of.Thrones.S01E01.1080p.mkv');
      expect(single?.quality).toBe('1080p');
      expect(single?.sizeBytes).toBe(1500000000);
    });

    it('should return null for getEpisodeDownloadSingle when episode is not downloaded', () => {
      const single = downloadsRepo.getEpisodeDownloadSingle('tt0944947_s1_e99');
      expect(single).toBeNull();
      expect(downloadsRepo.isDownloaded('tt0944947_s1_e99')).toBe(false);
    });

    it('should retrieve all downloaded episodes for a show using getShowDownloads', () => {
      downloadsRepo.addDownloadEntry('tt0944947_s1_e1', {
        fileName: 'GoT.S01E01.mkv',
        quality: '1080p',
        sizeBytes: 1000000000
      });

      downloadsRepo.addDownloadEntry('tt0944947_s1_e2', {
        fileName: 'GoT.S01E02.mkv',
        quality: '1080p',
        sizeBytes: 1100000000
      });

      // Different show
      downloadsRepo.addDownloadEntry('tt0903747_s1_e1', {
        fileName: 'BB.S01E01.mkv',
        quality: '1080p',
        sizeBytes: 900000000
      });

      const gotDownloads = downloadsRepo.getShowDownloads('tt0944947');
      expect(Object.keys(gotDownloads)).toHaveLength(2);
      expect(gotDownloads['tt0944947_s1_e1']).toBeDefined();
      expect(gotDownloads['tt0944947_s1_e2']).toBeDefined();
      expect(gotDownloads['tt0944947_s1_e1'].sizeBytes).toBe(1000000000);
      expect(gotDownloads['tt0944947_s1_e2'].sizeBytes).toBe(1100000000);
    });
  });

  describe('Aggregated Downloads List & Size', () => {
    it('should combine movies and episodes in getDownloads', () => {
      downloadsRepo.addDownloadEntry('tt_movie_1', {
        fileName: 'Movie1.mkv',
        sizeBytes: 2000000000
      });

      downloadsRepo.addDownloadEntry('tt_show_1_s1_e1', {
        fileName: 'Show1_S01E01.mkv',
        sizeBytes: 1000000000
      });

      const all = downloadsRepo.getDownloads();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['tt_movie_1'].sizeBytes).toBe(2000000000);
      expect(all['tt_show_1_s1_e1'].sizeBytes).toBe(1000000000);

      const totalSize = Object.values(all).reduce((acc, curr) => acc + (curr.sizeBytes || 0), 0);
      expect(totalSize).toBe(3000000000);
    });

    it('should return empty object when no downloads are registered', () => {
      const all = downloadsRepo.getDownloads();
      expect(all).toEqual({});
    });
  });

  describe('Deleting Downloads', () => {
    it('should remove a movie download entry with removeDownloadEntry', () => {
      downloadsRepo.addDownloadEntry('tt0137523', {
        fileName: 'FightClub.mkv',
        sizeBytes: 3000000000
      });
      expect(downloadsRepo.isDownloaded('tt0137523')).toBe(true);

      downloadsRepo.removeDownloadEntry('tt0137523');
      expect(downloadsRepo.isDownloaded('tt0137523')).toBe(false);
      expect(downloadsRepo.getMovieDownloadSingle('tt0137523')).toBeNull();
    });

    it('should remove an episode download entry with removeDownloadEntry', () => {
      downloadsRepo.addDownloadEntry('tt0944947_s1_e1', {
        fileName: 'GoT.mkv',
        sizeBytes: 1500000000
      });
      expect(downloadsRepo.isDownloaded('tt0944947_s1_e1')).toBe(true);

      downloadsRepo.removeDownloadEntry('tt0944947_s1_e1');
      expect(downloadsRepo.isDownloaded('tt0944947_s1_e1')).toBe(false);
      expect(downloadsRepo.getEpisodeDownloadSingle('tt0944947_s1_e1')).toBeNull();
    });

    it('should ignore invalid fileId in removeDownloadEntry', () => {
      expect(() => downloadsRepo.removeDownloadEntry('')).not.toThrow();
      expect(() => downloadsRepo.removeDownloadEntry('invalid:format')).not.toThrow();
    });
  });

  describe('scanDownloads (Disk Reconciliation)', () => {
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

    it('should keep downloads that exist on disk and remove downloads missing index.m3u8', () => {
      downloadsRepo.addDownloadEntry(testMovieId, { fileName: 'Movie.mkv' });
      downloadsRepo.addDownloadEntry(testMissingId, { fileName: 'Missing.mkv' });

      downloadsRepo.scanDownloads();

      expect(downloadsRepo.isDownloaded(testMovieId)).toBe(true);
      expect(downloadsRepo.isDownloaded(testMissingId)).toBe(false);
    });
  });

  describe('Cascade Deletes', () => {
    it('should cascade delete movie_downloads when movie_metadata is deleted', () => {
      downloadsRepo.addDownloadEntry('tt0137523', {
        fileName: 'FightClub.mkv',
        sizeBytes: 4000000000
      });
      expect(downloadsRepo.isDownloaded('tt0137523')).toBe(true);

      // Delete parent movie_metadata
      db.prepare('DELETE FROM movie_metadata WHERE id = ?').run('tt0137523');

      expect(downloadsRepo.isDownloaded('tt0137523')).toBe(false);
    });

    it('should cascade delete episode_downloads when show_metadata or episode_metadata is deleted', () => {
      downloadsRepo.addDownloadEntry('tt0944947_s1_e1', {
        fileName: 'GoT.S01E01.mkv',
        sizeBytes: 1500000000
      });
      expect(downloadsRepo.isDownloaded('tt0944947_s1_e1')).toBe(true);

      // Delete parent show_metadata
      db.prepare('DELETE FROM show_metadata WHERE id = ?').run('tt0944947');

      expect(downloadsRepo.isDownloaded('tt0944947_s1_e1')).toBe(false);
    });
  });
});
