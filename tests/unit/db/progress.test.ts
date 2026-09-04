import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../src/main/db/index.js';
import { progressRepo } from '../../../src/main/db/progress.js';
import { metadataRepo } from '../../../src/main/db/metadata.js';
import { streamsRepo } from '../../../src/main/db/streams.js';

describe('db/progress - ProgressRepo', () => {
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

  describe('Movie Watch Progress', () => {
    it('should return null for single movie progress when no progress is saved', () => {
      const progress = progressRepo.getProgress('tt0063350');
      expect(progress).toBeNull();
    });

    it('should save and retrieve single movie progress and auto-insert dummy metadata if missing', () => {
      progressRepo.saveProgress('tt0063350', {
        timestamp: 120.5,
        runtime: 8340
      });

      const progress = progressRepo.getProgress('tt0063350');
      expect(progress).not.toBeNull();
      expect(progress?.id).toBe('tt0063350');
      expect(progress?.timestamp).toBeCloseTo(120.5);
      expect(progress?.runtime).toBe(8340);
      expect(typeof progress?.last_updated).toBe('number');
    });

    it('should preserve existing values when partial updates are provided', () => {
      progressRepo.saveProgress('tt0063350', {
        timestamp: 300,
        runtime: 7200
      });

      // Update only timestamp
      progressRepo.saveProgress('tt0063350', {
        timestamp: 450
      });

      const progress = progressRepo.getProgress('tt0063350');
      expect(progress?.timestamp).toBe(450);
      expect(progress?.runtime).toBe(7200);
    });

    it('should return all watched movies joined with movie metadata using getMovieProgress', () => {
      // Save metadata for movie 1
      metadataRepo.saveCachedMetadata('tt0056923', 'movie', {
        id: 'tt0056923',
        type: 'movie',
        title: 'Charade',
        year: '1963',
        released: null,
        genres: ['Comedy', 'Mystery'],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        dvdRelease: null,
        moviedb_id: null,
        popularity: null
      });
      progressRepo.saveProgress('tt0056923', {
        timestamp: 500,
        runtime: 6780
      });

      // Save metadata for movie 2
      metadataRepo.saveCachedMetadata('tt0017136', 'movie', {
        id: 'tt0017136',
        type: 'movie',
        title: 'Metropolis',
        year: '1927',
        released: null,
        genres: ['Drama', 'Sci-Fi'],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        dvdRelease: null,
        moviedb_id: null,
        popularity: null
      });
      progressRepo.saveProgress('tt0017136', {
        timestamp: 1000,
        runtime: 9180
      });

      const cw = progressRepo.getContinueWatching('movie');
      expect(cw.metadata).toHaveLength(2);
      expect(cw.progress['tt0056923'].timestamp).toBe(500);
      expect(cw.progress['tt0017136'].timestamp).toBe(1000);
    });

    it('should return empty envelope from getContinueWatching when no progress exists', () => {
      const cw = progressRepo.getContinueWatching('movie');
      expect(cw.metadata).toEqual([]);
      expect(cw.progress).toEqual({});
      expect(cw.ready).toEqual({});
    });

    it('should ignore empty or invalid fileId in saveProgress', () => {
      progressRepo.saveProgress('', { timestamp: 10, runtime: 0 });
      progressRepo.saveProgress('invalid!@#', { timestamp: 10, runtime: 0 });
      expect(progressRepo.getProgress('')).toBeNull();
      expect(progressRepo.getProgress('invalid!@#')).toBeNull();
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

    it('should save and retrieve show progress with multiple episodes via saveProgress', () => {
      metadataRepo.saveCachedMetadata('tt0032475', 'show', {
        id: 'tt0032475',
        type: 'show',
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        released: null,
        genres: [],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        status: 'Ended',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt0032475_s1_e1',
            show_id: 'tt0032475',
            season: 1,
            episode: 1,
            title: 'The Purple Death',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          },
          {
            id: 'tt0032475_s1_e2',
            show_id: 'tt0032475',
            season: 1,
            episode: 2,
            title: 'Freezing Torture',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      }, 'Ended');

      // First watch episode 1
      progressRepo.saveProgress('tt0032475_s1_e1', {
        timestamp: 3600,
        runtime: 3600
      });

      // Set episode 1 timestamp to past
      db.prepare('UPDATE progress SET last_updated = 1000 WHERE id = ?').run('tt0032475_s1_e1');

      // Then watch episode 2
      progressRepo.saveProgress('tt0032475_s1_e2', {
        timestamp: 1200,
        runtime: 3400
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

    it('should retrieve show progress records using getSingleShowProgress', () => {
      progressRepo.saveProgress('tt_show_a_s1_e1', {
        timestamp: 500,
        runtime: 2500
      });

      progressRepo.saveProgress('tt_show_b_s2_e3', {
        timestamp: 800,
        runtime: 3000
      });

      const showA = progressRepo.getSingleShowProgress('tt_show_a');
      expect(showA.last_season).toBe(1);
      expect(showA.last_episode).toBe(1);
      expect(showA.episodes['tt_show_a_s1_e1'].timestamp).toBe(500);

      const showB = progressRepo.getSingleShowProgress('tt_show_b');
      expect(showB.last_season).toBe(2);
      expect(showB.last_episode).toBe(3);
      expect(showB.episodes['tt_show_b_s2_e3'].timestamp).toBe(800);
    });

    it('should save and retrieve single episode progress directly via saveProgress', () => {
      progressRepo.saveProgress('tt_direct_show_s1_e1', {
        timestamp: 1500,
        runtime: 3000
      });

      const showProgress = progressRepo.getSingleShowProgress('tt_direct_show');
      expect(showProgress.id).toBe('tt_direct_show');
      expect(showProgress.last_season).toBe(1);
      expect(showProgress.last_episode).toBe(1);
      expect(showProgress.episodes['tt_direct_show_s1_e1']).toBeDefined();
      expect(showProgress.episodes['tt_direct_show_s1_e1'].timestamp).toBe(1500);
      expect(showProgress.episodes['tt_direct_show_s1_e1'].runtime).toBe(3000);
    });
  });

  describe('getContinueWatching', () => {
    it('should return continue watching list for movies ordered by last_updated descending', () => {
      metadataRepo.saveCachedMetadata('movie_1', 'movie', { id: 'movie_1', type: 'movie', title: 'Movie One', year: '2021', released: null, genres: [], poster: null, background: null, logo: null, rating: null, runtime: null, description: null, awards: null, cast: [], director: [], writer: [], country: null, dvdRelease: null, moviedb_id: null, popularity: null });
      metadataRepo.saveCachedMetadata('movie_2', 'movie', { id: 'movie_2', type: 'movie', title: 'Movie Two', year: '2022', released: null, genres: [], poster: null, background: null, logo: null, rating: null, runtime: null, description: null, awards: null, cast: [], director: [], writer: [], country: null, dvdRelease: null, moviedb_id: null, popularity: null });
      metadataRepo.saveCachedMetadata('movie_3', 'movie', { id: 'movie_3', type: 'movie', title: 'Movie Three', year: '2023', released: null, genres: [], poster: null, background: null, logo: null, rating: null, runtime: null, description: null, awards: null, cast: [], director: [], writer: [], country: null, dvdRelease: null, moviedb_id: null, popularity: null });

      progressRepo.saveProgress('movie_1', { timestamp: 100, runtime: 5000 });
      // Update movie_2 with manual earlier timestamp
      progressRepo.saveProgress('movie_2', { timestamp: 200, runtime: 5000 });
      // Update movie_3 with latest timestamp
      progressRepo.saveProgress('movie_3', { timestamp: 300, runtime: 5000 });

      // Set explicit last_updated to test sorting
      db.prepare('UPDATE progress SET last_updated = 1000 WHERE id = ?').run('movie_1');
      db.prepare('UPDATE progress SET last_updated = 3000 WHERE id = ?').run('movie_2');
      db.prepare('UPDATE progress SET last_updated = 2000 WHERE id = ?').run('movie_3');

      // Mock streamsRepo.isReady for movie_2
      vi.spyOn(streamsRepo, 'isReady').mockImplementation((id: string) => id === 'movie_2');
      vi.spyOn(streamsRepo, 'getMovieStream').mockImplementation((id: string) => {
        if (id === 'movie_2') {
          return {
            id: 'movie_2',
            show_id: null,
            quality: '1080p',
            size_bytes: 1500000000,
            ready_at: 123456
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
      expect(cw.ready['movie_2']).toBeDefined();
      expect(cw.ready['movie_2'].quality).toBe('1080p');
      expect(cw.ready['movie_1']).toBeUndefined();
    });

    it('should respect the limit parameter for movies', () => {
      metadataRepo.saveCachedMetadata('m1', 'movie', { id: 'm1', type: 'movie', title: 'M1', year: null, released: null, genres: [], poster: null, background: null, logo: null, rating: null, runtime: null, description: null, awards: null, cast: [], director: [], writer: [], country: null, dvdRelease: null, moviedb_id: null, popularity: null });
      metadataRepo.saveCachedMetadata('m2', 'movie', { id: 'm2', type: 'movie', title: 'M2', year: null, released: null, genres: [], poster: null, background: null, logo: null, rating: null, runtime: null, description: null, awards: null, cast: [], director: [], writer: [], country: null, dvdRelease: null, moviedb_id: null, popularity: null });
      progressRepo.saveProgress('m1', { timestamp: 10, runtime: 100 });
      progressRepo.saveProgress('m2', { timestamp: 20, runtime: 100 });

      const cw = progressRepo.getContinueWatching('movie', 1);
      expect(cw.metadata).toHaveLength(1);
    });

    it('should return continue watching list for shows ordered by latest watched episode', () => {
      metadataRepo.saveCachedMetadata('show_1', 'show', {
        id: 'show_1',
        type: 'show',
        title: 'Show One',
        year: '2020',
        released: null,
        genres: [],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: '45',
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        status: 'Ended',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          { id: 'show_1_s1_e1', show_id: 'show_1', season: 1, episode: 1, title: 'Show 1 Ep 1', description: null, thumbnail: null, released: null, rating: null, tvdb_id: null, runtime: null },
          { id: 'show_1_s1_e2', show_id: 'show_1', season: 1, episode: 2, title: 'Show 1 Ep 2', description: null, thumbnail: null, released: null, rating: null, tvdb_id: null, runtime: null }
        ]
      }, 'Ended');

      metadataRepo.saveCachedMetadata('show_2', 'show', {
        id: 'show_2',
        type: 'show',
        title: 'Show Two',
        year: '2021',
        released: null,
        genres: [],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        status: 'Ended',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          { id: 'show_2_s1_e1', show_id: 'show_2', season: 1, episode: 1, title: 'Show 2 Ep 1', description: null, thumbnail: null, released: null, rating: null, tvdb_id: null, runtime: null }
        ]
      }, 'Ended');

      progressRepo.saveProgress('show_1_s1_e1', { timestamp: 100, runtime: 1000 });
      progressRepo.saveProgress('show_1_s1_e2', { timestamp: 200, runtime: 1000 });
      progressRepo.saveProgress('show_2_s1_e1', { timestamp: 300, runtime: 1000 });

      // Explicitly set timestamps for all episodes
      db.prepare('UPDATE progress SET last_updated = 1000 WHERE id = ?').run('show_1_s1_e1');
      db.prepare('UPDATE progress SET last_updated = 2000 WHERE id = ?').run('show_1_s1_e2');
      db.prepare('UPDATE progress SET last_updated = 5000 WHERE id = ?').run('show_2_s1_e1');

      const cw = progressRepo.getContinueWatching('show', 10);
      expect(cw.metadata).toHaveLength(2);
      expect(cw.metadata[0].id).toBe('show_2');
      expect(cw.metadata[1].id).toBe('show_1');
      expect(cw.metadata[1].runtime).toBe(45);
      expect(cw.progress['show_2_s1_e1'].timestamp).toBe(300);
      expect(cw.progress['show_1_s1_e2'].timestamp).toBe(200);
    });

    it('should return empty results when no continue watching records exist', () => {
      const cwMovies = progressRepo.getContinueWatching('movie');
      expect(cwMovies).toEqual({ metadata: [], progress: {}, ready: {} });

      const cwShows = progressRepo.getContinueWatching('show');
      expect(cwShows).toEqual({ metadata: [], progress: {}, ready: {} });
    });
  });
});
