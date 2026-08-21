import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store } from '../../../src/renderer/state/Store.js';

describe('Store (Frontend State Management)', () => {
  beforeEach(() => {
    // Reset store state and listeners before each test
    store.state = {
      currentPage: 'movies',
      metadata: {},
      progress: {},
      downloads: {},
      activeDownloads: {},
      popularMovies: null,
      popularShows: null,
      continueWatchingMovies: null,
      continueWatchingShows: null
    };
    store.listeners = new Set();
  });

  describe('Pub/Sub and State Updates', () => {
    it('should subscribe to state changes and receive notifications', () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      store.updateState({ currentPage: 'shows' }, 'page-changed', { page: 'shows' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        'page-changed',
        expect.objectContaining({ currentPage: 'shows' }),
        { page: 'shows' }
      );

      unsubscribe();
      store.updateState({ currentPage: 'search' });
      expect(listener).toHaveBeenCalledTimes(1); // Not called after unsubscribe
    });

    it('should handle listener errors gracefully without interrupting notification loop', () => {
      const faultyListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener crash');
      });
      const validListener = vi.fn();

      store.subscribe(faultyListener);
      store.subscribe(validListener);

      expect(() => {
        store.notify('test-event', { foo: 'bar' });
      }).not.toThrow();

      expect(faultyListener).toHaveBeenCalled();
      expect(validListener).toHaveBeenCalled();
    });
  });

  describe('cacheMetadata', () => {
    it('should ignore invalid or missing item arguments', () => {
      const notifySpy = vi.spyOn(store, 'notify');
      store.cacheMetadata(null);
      store.cacheMetadata(undefined);
      store.cacheMetadata({} as any);

      expect(notifySpy).not.toHaveBeenCalled();
      expect(store.state.metadata).toEqual({});
    });

    it('should cache new metadata item and emit metadata-cached event', () => {
      const listener = vi.fn();
      store.subscribe(listener);

      const movie = {
        id: 'tt0063350',
        name: 'Night of the Living Dead',
        type: 'movie',
        year: '1968',
        poster: 'https://images.metahub.space/poster/medium/tt0063350/img.jpg'
      };

      store.cacheMetadata(movie);

      expect(store.state.metadata['tt0063350']).toMatchObject(movie);
      expect(store.getMedia('tt0063350')).toMatchObject(movie);
      expect(listener).toHaveBeenCalledWith(
        'metadata-cached',
        expect.any(Object),
        { id: 'tt0063350' }
      );
    });

    it('should merge partial metadata without overwriting existing complete fields', () => {
      // Step 1: Initial partial metadata
      store.cacheMetadata({
        id: 'tt0056923',
        name: 'Charade',
        year: '1963',
        genres: ['Comedy', 'Mystery'],
        poster: 'https://img.com/poster.jpg'
      });

      // Step 2: Incoming update with extra fields and null/undefined values
      store.cacheMetadata({
        id: 'tt0056923',
        imdbRating: '7.9',
        runtime: '113 min',
        name: undefined, // Should NOT overwrite existing name
        poster: null     // Should NOT overwrite existing poster
      });

      const cached = store.getMedia('tt0056923');
      expect(cached?.name).toBe('Charade');
      expect(cached?.poster).toBe('https://img.com/poster.jpg');
      expect(cached?.imdbRating).toBe('7.9');
      expect(cached?.runtime).toBe('113 min');
      expect(cached?.genres).toEqual(['Comedy', 'Mystery']);
    });

    it('should preserve populated arrays when incoming array is empty', () => {
      store.cacheMetadata({
        id: 'tt0056923',
        genres: ['Comedy', 'Mystery'],
        cast: ['Cary Grant', 'Audrey Hepburn']
      });

      store.cacheMetadata({
        id: 'tt0056923',
        genres: [], // Empty array should not overwrite populated array
        cast: []
      });

      const cached = store.getMedia('tt0056923');
      expect(cached?.genres).toEqual(['Comedy', 'Mystery']);
      expect(cached?.cast).toEqual(['Cary Grant', 'Audrey Hepburn']);
    });

    it('should safely merge videos/episodes list by season & episode without duplicates', () => {
      store.cacheMetadata({
        id: 'tt0055662',
        type: 'series',
        name: 'The Beverly Hillbillies',
        videos: [
          { season: 1, episode: 1, name: 'The Clampetts Strike Oil', thumbnail: 'thumb1.jpg' },
          { season: 1, episode: 2, name: 'Getting Settled', thumbnail: 'thumb2.jpg' }
        ]
      });

      // Merge new episode 3 and update episode 1 title
      store.cacheMetadata({
        id: 'tt0055662',
        videos: [
          { season: 1, episode: 1, overview: 'Updated Pilot description' },
          { season: 1, episode: 3, name: 'Meanwhile, Back at the Cabin', thumbnail: 'thumb3.jpg' }
        ]
      });

      const cached = store.getMedia('tt0055662');
      expect(cached?.videos).toHaveLength(3);

      // Episode 1 should retain original name and thumbnail while gaining new overview
      const ep1 = cached?.videos.find((v: any) => v.season === 1 && v.episode === 1);
      expect(ep1?.name).toBe('The Clampetts Strike Oil');
      expect(ep1?.thumbnail).toBe('thumb1.jpg');
      expect(ep1?.overview).toBe('Updated Pilot description');

      // Episode 3 should be newly added
      const ep3 = cached?.videos.find((v: any) => v.season === 1 && v.episode === 3);
      expect(ep3?.name).toBe('Meanwhile, Back at the Cabin');
    });

    it('should strip transient properties progress and is_downloaded from metadata', () => {
      store.cacheMetadata({
        id: 'tt0063350',
        name: 'Night of the Living Dead',
        progress: { timestamp: 500 },
        is_downloaded: true
      });

      const cached = store.getMedia('tt0063350');
      expect(cached?.progress).toBeUndefined();
      expect(cached?.is_downloaded).toBeUndefined();
    });

    it('should correctly handle _isFull flag and getFullMedia / hasFullMedia helpers', () => {
      store.cacheMetadata({
        id: 'tt0063350',
        name: 'Night of the Living Dead'
      });

      expect(store.hasFullMedia('tt0063350')).toBe(false);
      expect(store.getFullMedia('tt0063350')).toBeNull();

      store.cacheMetadata({
        id: 'tt0063350',
        _isFull: true,
        description: 'Full movie details loaded'
      });

      expect(store.hasFullMedia('tt0063350')).toBe(true);
      expect(store.getFullMedia('tt0063350')).toMatchObject({
        id: 'tt0063350',
        _isFull: true
      });
    });
  });

  describe('Watch Progress and Continue Watching', () => {
    it('should cache single and batch watch progress records', () => {
      store.cacheProgress({
        id: 'tt0111161',
        timestamp: 1800,
        runtime: 8520,
        last_updated: 1700000000000
      });

      expect(store.state.progress['tt0111161']).toEqual({
        id: 'tt0111161',
        timestamp: 1800,
        runtime: 8520,
        last_updated: 1700000000000
      });

      // Show progress with nested episodes
      store.cacheProgress({
        id: 'tt0903747',
        last_updated: 1700000000000,
        episodes: {
          'tt0903747_s1_e1': { season: 1, episode: 1, timestamp: 900, runtime: 3480 }
        }
      });

      expect(store.state.progress['tt0903747_s1_e1']).toMatchObject({
        id: 'tt0903747_s1_e1',
        show_id: 'tt0903747',
        season: 1,
        episode: 1,
        timestamp: 900
      });
    });

    it('should update local progress cache and continue watching list for movies', () => {
      store.updateLocalProgressCache({
        movieId: 'tt0111161',
        timestamp: 1200,
        metadata: { runtime: 142 }
      });

      expect(store.state.progress['tt0111161']).toMatchObject({
        id: 'tt0111161',
        timestamp: 1200,
        runtime: 142
      });

      expect(store.state.continueWatchingMovies).toHaveLength(1);
      expect(store.state.continueWatchingMovies?.[0].id).toBe('tt0111161');
    });

    it('should update local progress cache and continue watching list for series', () => {
      store.updateLocalProgressCache({
        showId: 'tt0903747',
        timestamp: 600,
        metadata: { season: 2, episode: 4, runtime: 48 }
      });

      expect(store.state.progress['tt0903747_s2_e4']).toMatchObject({
        id: 'tt0903747_s2_e4',
        timestamp: 600,
        runtime: 48
      });

      expect(store.state.continueWatchingShows).toHaveLength(1);
      expect(store.state.continueWatchingShows?.[0]).toMatchObject({
        id: 'tt0903747',
        episodeId: 'tt0903747_s2_e4'
      });
    });

    it('should cap continue watching lists at 10 items and deduplicate existing entries', () => {
      // Add 12 items
      for (let i = 1; i <= 12; i++) {
        store.addOrUpdateContinueWatching(`movie_${i}`, 'movie', { timestamp: i * 100 });
      }

      expect(store.state.continueWatchingMovies).toHaveLength(10);
      expect(store.state.continueWatchingMovies?.[0].id).toBe('movie_12'); // Most recent at front

      // Re-adding existing movie_5 should bring it to the top
      store.addOrUpdateContinueWatching('movie_5', 'movie', { timestamp: 999 });
      expect(store.state.continueWatchingMovies).toHaveLength(10);
      expect(store.state.continueWatchingMovies?.[0].id).toBe('movie_5');
    });

    it('should compute getMovieConfig with progress and download status', () => {
      store.state.progress['tt0111161'] = { id: 'tt0111161', timestamp: 2500 } as any;
      store.state.downloads['tt0111161'] = { id: 'tt0111161', is_downloaded: true } as any;

      const config = store.getMovieConfig('tt0111161');
      expect(config).toMatchObject({
        timestamp: 2500,
        is_downloaded: true
      });
    });

    it('should compute getShowConfig aggregating episode progress and latest watched episode', () => {
      store.state.progress['tt0903747_s1_e1'] = { id: 'tt0903747_s1_e1', timestamp: 1000, runtime: 3000, last_updated: 100 } as any;
      store.state.progress['tt0903747_s1_e2'] = { id: 'tt0903747_s1_e2', timestamp: 500, runtime: 3000, last_updated: 300 } as any;
      store.state.downloads['tt0903747_s1_e1'] = { id: 'tt0903747_s1_e1', is_downloaded: true } as any;

      const showConfig = store.getShowConfig('tt0903747');
      expect(showConfig.last_season).toBe(1);
      expect(showConfig.last_episode).toBe(2); // Higher last_updated
      expect(showConfig.episodes['tt0903747_s1_e1'].is_downloaded).toBe(true);
      expect(showConfig.episodes['tt0903747_s1_e2'].is_downloaded).toBe(false);
    });
  });

  describe('Download State Management', () => {
    it('should track batch and individual download records', () => {
      store.cacheDownloadsBatch([
        { id: 'tt0111161', movie_id: 'tt0111161' },
        { fileId: 'tt0903747_s1_e1' }
      ]);

      expect(store.isMovieDownloaded('tt0111161')).toBe(true);
      expect(store.isEpisodeDownloaded('tt0903747', 1, 1)).toBe(true);
      expect(store.isEpisodeDownloaded('tt0903747', 1, 2)).toBe(false);
    });

    it('should manage active in-flight download progress states', () => {
      store.setActiveDownload('tt0111161', 'downloading', '45.50');
      expect(store.getActiveDownload('tt0111161')).toEqual({
        fileId: 'tt0111161',
        status: 'downloading',
        progress: '45.50'
      });
      expect(store.isDownloadingOrQueued('tt0111161')).toBeTruthy();

      store.removeActiveDownload('tt0111161');
      expect(store.getActiveDownload('tt0111161')).toBeNull();
    });

    it('should set download status to true and clear active download record', () => {
      store.setActiveDownload('tt0111161', 'downloading', '99.00');
      store.setDownloadStatus('tt0111161', true);

      expect(store.isMovieDownloaded('tt0111161')).toBe(true);
      expect(store.getActiveDownload('tt0111161')).toBeNull();

      // Setting download status to false removes it
      store.setDownloadStatus('tt0111161', false);
      expect(store.isMovieDownloaded('tt0111161')).toBe(false);
    });
  });
});
