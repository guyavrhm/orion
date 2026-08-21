import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../src/main/db/index.js';
import { progressRepo } from '../../../src/main/db/progress.js';
import { metadataRepo } from '../../../src/main/db/metadata.js';
import { downloadsRepo } from '../../../src/main/db/downloads.js';

describe('db/progress - ProgressRepo', () => {
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

  describe('Movie Watch Progress', () => {
    it('should return null for single movie progress when no progress is saved', () => {
      const progress = progressRepo.getSingleMovieProgress('tt0137523');
      expect(progress).toBeNull();
    });

    it('should save and retrieve single movie progress and auto-insert dummy metadata if missing', () => {
      progressRepo.saveMovieProgress('tt0137523', {
        timestamp: 120.5,
        runtime: 8340
      });

      const progress = progressRepo.getSingleMovieProgress('tt0137523');
      expect(progress).not.toBeNull();
      expect(progress?.id).toBe('tt0137523');
      expect(progress?.timestamp).toBeCloseTo(120.5);
      expect(progress?.runtime).toBe(8340);
      expect(typeof progress?.last_updated).toBe('number');
    });

    it('should preserve existing values when partial updates are provided', () => {
      progressRepo.saveMovieProgress('tt0137523', {
        timestamp: 300,
        runtime: 7200
      });

      // Update only timestamp
      progressRepo.saveMovieProgress('tt0137523', {
        timestamp: 450
      });

      const progress = progressRepo.getSingleMovieProgress('tt0137523');
      expect(progress?.timestamp).toBe(450);
      expect(progress?.runtime).toBe(7200);
    });

    it('should return all watched movies joined with movie metadata using getMovieProgress', () => {
      // Save metadata for movie 1
      metadataRepo.saveCachedMetadata('tt0056923', 'movie', {
        name: 'Charade',
        year: '1963',
        genres: ['Comedy', 'Mystery']
      });
      progressRepo.saveMovieProgress('tt0056923', {
        timestamp: 500,
        runtime: 6780
      });

      // Save metadata for movie 2
      metadataRepo.saveCachedMetadata('tt0017136', 'movie', {
        name: 'Metropolis',
        year: '1927',
        genres: ['Drama', 'Sci-Fi']
      });
      progressRepo.saveMovieProgress('tt0017136', {
        timestamp: 1000,
        runtime: 9180
      });

      const allProgress = progressRepo.getMovieProgress();
      expect(Object.keys(allProgress)).toHaveLength(2);
      expect(allProgress['tt0056923'].name).toBe('Charade');
      expect(allProgress['tt0056923'].timestamp).toBe(500);
      expect(allProgress['tt0017136'].name).toBe('Metropolis');
      expect(allProgress['tt0017136'].timestamp).toBe(1000);
    });

    it('should return empty object from getMovieProgress when no progress exists', () => {
      const allProgress = progressRepo.getMovieProgress();
      expect(allProgress).toEqual({});
    });

    it('should ignore empty movieId in saveMovieProgress', () => {
      progressRepo.saveMovieProgress('', { timestamp: 10 });
      expect(progressRepo.getMovieProgress()).toEqual({});
    });
  });

  describe('Show & Episode Watch Progress', () => {
    it('should return default structure for single show progress when no progress exists', () => {
      const progress = progressRepo.getSingleShowProgress('tt0032475');
      expect(progress).toEqual({
        id: 'tt0032475',
        last_season: 1,
        last_episode: 1,
        last_updated: null,
        episodes: {}
      });
    });

    it('should save and retrieve show progress with multiple episodes', () => {
      metadataRepo.saveCachedMetadata('tt0032475', 'series', {
        name: 'Flash Gordon Conquers the Universe',
        videos: [
          { season: 1, episode: 1, title: 'The Purple Death' },
          { season: 1, episode: 2, title: 'Freezing Torture' }
        ]
      }, 'Ended');

      // First watch episode 1
      progressRepo.saveShowProgress('tt0032475', {
        last_season: 1,
        last_episode: 1,
        episodes: {
          'tt0032475_s1_e1': {
            id: 'tt0032475_s1_e1',
            show_id: 'tt0032475',
            season: 1,
            episode: 1,
            timestamp: 3600,
            runtime: 3600
          }
        }
      });

      // Set episode 1 timestamp to past
      db.prepare('UPDATE episode_progress SET last_updated = 1000 WHERE episode_id = ?').run('tt0032475_s1_e1');

      // Then watch episode 2
      progressRepo.saveShowProgress('tt0032475', {
        last_season: 1,
        last_episode: 2,
        episodes: {
          'tt0032475_s1_e1': {
            id: 'tt0032475_s1_e1',
            show_id: 'tt0032475',
            season: 1,
            episode: 1,
            timestamp: 3600,
            runtime: 3600
          },
          'tt0032475_s1_e2': {
            id: 'tt0032475_s1_e2',
            show_id: 'tt0032475',
            season: 1,
            episode: 2,
            timestamp: 1200,
            runtime: 3400
          }
        }
      });

      const showProgress = progressRepo.getSingleShowProgress('tt0032475');
      expect(showProgress.id).toBe('tt0032475');
      expect(showProgress.last_season).toBe(1);
      expect(showProgress.last_episode).toBe(2);
      expect(showProgress.last_updated).not.toBeNull();
      expect(Object.keys(showProgress.episodes)).toHaveLength(2);
      expect(showProgress.episodes['tt0032475_s1_e1'].timestamp).toBe(3600);
      expect(showProgress.episodes['tt0032475_s1_e2'].timestamp).toBe(1200);
    });

    it('should retrieve all show progress records using getShowProgress', () => {
      progressRepo.saveShowProgress('tt_show_a', {
        last_season: 1,
        last_episode: 1,
        episodes: {
          'tt_show_a_s1_e1': {
            season: 1,
            episode: 1,
            timestamp: 500,
            runtime: 2500
          }
        }
      });

      progressRepo.saveShowProgress('tt_show_b', {
        last_season: 2,
        last_episode: 3,
        episodes: {
          'tt_show_b_s2_e3': {
            season: 2,
            episode: 3,
            timestamp: 800,
            runtime: 3000
          }
        }
      });

      const allShows = progressRepo.getShowProgress();
      expect(Object.keys(allShows)).toHaveLength(2);
      expect(allShows['tt_show_a'].last_season).toBe(1);
      expect(allShows['tt_show_a'].last_episode).toBe(1);
      expect(allShows['tt_show_b'].last_season).toBe(2);
      expect(allShows['tt_show_b'].last_episode).toBe(3);
    });

    it('should return empty object from getShowProgress when no progress exists', () => {
      expect(progressRepo.getShowProgress()).toEqual({});
    });

    it('should ignore empty showId in saveShowProgress', () => {
      progressRepo.saveShowProgress('', {
        last_season: 1,
        last_episode: 1,
        episodes: {}
      });
      expect(progressRepo.getShowProgress()).toEqual({});
    });
  });

  describe('getContinueWatching', () => {
    it('should return continue watching list for movies ordered by last_updated descending', () => {
      metadataRepo.saveCachedMetadata('movie_1', 'movie', { name: 'Movie One', year: '2021' });
      metadataRepo.saveCachedMetadata('movie_2', 'movie', { name: 'Movie Two', year: '2022' });
      metadataRepo.saveCachedMetadata('movie_3', 'movie', { name: 'Movie Three', year: '2023' });

      progressRepo.saveMovieProgress('movie_1', { timestamp: 100, runtime: 5000 });
      // Update movie_2 with manual earlier timestamp
      progressRepo.saveMovieProgress('movie_2', { timestamp: 200, runtime: 5000 });
      // Update movie_3 with latest timestamp
      progressRepo.saveMovieProgress('movie_3', { timestamp: 300, runtime: 5000 });

      // Set explicit last_updated to test sorting
      db.prepare('UPDATE movie_progress SET last_updated = 1000 WHERE movie_id = ?').run('movie_1');
      db.prepare('UPDATE movie_progress SET last_updated = 3000 WHERE movie_id = ?').run('movie_2');
      db.prepare('UPDATE movie_progress SET last_updated = 2000 WHERE movie_id = ?').run('movie_3');

      // Mock downloadsRepo.isDownloaded for movie_2
      vi.spyOn(downloadsRepo, 'isDownloaded').mockImplementation((id: string) => id === 'movie_2');
      vi.spyOn(downloadsRepo, 'getMovieDownloadSingle').mockImplementation((id: string) => {
        if (id === 'movie_2') {
          return {
            movie_id: 'movie_2',
            fileName: 'movie_2.mp4',
            torrentHash: 'hash123',
            fileHash: 'fhash123',
            fileIdx: 0,
            quality: '1080p',
            sizeBytes: 1500000000,
            downloadTime: 123456
          };
        }
        return null;
      });

      const cw = progressRepo.getContinueWatching('movie', 10);
      expect(cw.metadata).toHaveLength(3);
      // Order: movie_2 (3000) -> movie_3 (2000) -> movie_1 (1000)
      expect(cw.metadata[0].id).toBe('movie_2');
      expect(cw.metadata[1].id).toBe('movie_3');
      expect(cw.metadata[2].id).toBe('movie_1');

      expect(cw.progress['movie_2'].timestamp).toBe(200);
      expect(cw.downloads['movie_2']).toBeDefined();
      expect(cw.downloads['movie_2'].is_downloaded).toBe(true);
      expect(cw.downloads['movie_2'].quality).toBe('1080p');
      expect(cw.downloads['movie_1']).toBeUndefined();
    });

    it('should respect the limit parameter for movies', () => {
      metadataRepo.saveCachedMetadata('m1', 'movie', { name: 'M1' });
      metadataRepo.saveCachedMetadata('m2', 'movie', { name: 'M2' });
      progressRepo.saveMovieProgress('m1', { timestamp: 10, runtime: 100 });
      progressRepo.saveMovieProgress('m2', { timestamp: 20, runtime: 100 });

      const cw = progressRepo.getContinueWatching('movie', 1);
      expect(cw.metadata).toHaveLength(1);
    });

    it('should return continue watching list for series ordered by latest watched episode', () => {
      metadataRepo.saveCachedMetadata('show_1', 'series', {
        name: 'Show One',
        videos: [
          { season: 1, episode: 1, title: 'Show 1 Ep 1' },
          { season: 1, episode: 2, title: 'Show 1 Ep 2' }
        ]
      }, 'Ended');

      metadataRepo.saveCachedMetadata('show_2', 'series', {
        name: 'Show Two',
        videos: [
          { season: 1, episode: 1, title: 'Show 2 Ep 1' }
        ]
      }, 'Ended');

      progressRepo.saveShowProgress('show_1', {
        last_season: 1,
        last_episode: 2,
        episodes: {
          'show_1_s1_e1': { season: 1, episode: 1, timestamp: 100, runtime: 1000 },
          'show_1_s1_e2': { season: 1, episode: 2, timestamp: 200, runtime: 1000 }
        }
      });

      progressRepo.saveShowProgress('show_2', {
        last_season: 1,
        last_episode: 1,
        episodes: {
          'show_2_s1_e1': { season: 1, episode: 1, timestamp: 300, runtime: 1000 }
        }
      });

      // Explicitly set timestamps for all episodes
      db.prepare('UPDATE episode_progress SET last_updated = 1000 WHERE episode_id = ?').run('show_1_s1_e1');
      db.prepare('UPDATE episode_progress SET last_updated = 2000 WHERE episode_id = ?').run('show_1_s1_e2');
      db.prepare('UPDATE episode_progress SET last_updated = 5000 WHERE episode_id = ?').run('show_2_s1_e1');

      const cw = progressRepo.getContinueWatching('series', 10);
      expect(cw.metadata).toHaveLength(2);
      expect(cw.metadata[0].id).toBe('show_2');
      expect(cw.metadata[1].id).toBe('show_1');
      expect(cw.progress['show_2_s1_e1'].timestamp).toBe(300);
      expect(cw.progress['show_1_s1_e2'].timestamp).toBe(200);
    });

    it('should return empty results when no continue watching records exist', () => {
      const cwMovies = progressRepo.getContinueWatching('movie');
      expect(cwMovies).toEqual({ metadata: [], progress: {}, downloads: {} });

      const cwShows = progressRepo.getContinueWatching('series');
      expect(cwShows).toEqual({ metadata: [], progress: {}, downloads: {} });
    });
  });
});
