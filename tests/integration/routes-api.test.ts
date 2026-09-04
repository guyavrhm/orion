import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { db } from '../../src/main/db/index.js';
import { metadataRepo } from '../../src/main/db/metadata.js';
import { progressRepo } from '../../src/main/db/progress.js';
import { streamsRepo } from '../../src/main/db/streams.js';
import { cinemetaClient } from '../../src/main/clients/cinemeta.js';
import { metahubClient } from '../../src/main/clients/metahub.js';
import { torrentProviderClient } from '../../src/main/clients/torrentProvider.js';
import * as queuesModule from '../../src/main/queues/index.js';
import apiRouter from '../../src/main/routes/api.js';
import { DOWNLOAD_PRIORITIES } from '../../src/main/config/queue.js';
import { ErrorCode, type ActiveMediaState } from '../../src/main/types/index.js';

// In-memory Redis active media store for mock
let activeMediaStore: Record<string, ActiveMediaState> = {};

// Mock the queues module
vi.mock('../../src/main/queues/index.js', () => {
  return {
    downloadQueue: {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) })
    },
    transcodeFastQueue: {
      getJob: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) })
    },
    transcodeHeavyQueue: {
      getJob: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) })
    },
    subtitleQueue: {
      getJob: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) })
    },
    finalizeQueue: {
      getJob: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) })
    },
    flowProducer: {
      add: vi.fn().mockResolvedValue({ job: { id: 'flow-job-1' } })
    },
    publishMediaRequestStatus: vi.fn().mockImplementation(async (id: string, status: string, progress: string | number) => {
      if (status === 'ready' || status === 'completed' || status === 'failed' || status === 'removed') {
        delete activeMediaStore[id];
      } else {
        activeMediaStore[id] = {
          fileId: id,
          status: status as any,
          progress: String(progress),
          updatedAt: Date.now()
        };
      }
      return 1;
    }),
    getActiveMediaState: vi.fn().mockImplementation(async (fileId: string) => {
      return activeMediaStore[fileId] || null;
    }),
    getAllActiveMedia: vi.fn().mockImplementation(async () => {
      return { ...activeMediaStore };
    }),
    setActiveMediaState: vi.fn().mockImplementation(async (fileId: string, status: string, progress: string | number) => {
      activeMediaStore[fileId] = {
        fileId,
        status: status as any,
        progress: String(progress),
        updatedAt: Date.now()
      };
    }),
    deleteActiveMediaState: vi.fn().mockImplementation(async (fileId: string) => {
      delete activeMediaStore[fileId];
    }),
    publishEvent: vi.fn().mockResolvedValue(1)
  };
});

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(apiRouter);

  // Global Error Handler matching server.ts
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err.status === 'number' && err.status >= 400
      ? err.status
      : (res.statusCode >= 400 ? res.statusCode : 500);
    const errorCode = err.code || (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST);
    res.status(status).json({
      error: errorCode
    });
  });

  return app;
}

describe('REST API Routes Integration Tests', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
    activeMediaStore = {};

    // Clear SQLite tables in proper foreign-key safe order
    db.exec(`
      DELETE FROM progress;
      DELETE FROM streams;
      DELETE FROM subtitle_preferences;
      DELETE FROM episode_metadata;
      DELETE FROM movie_metadata;
      DELETE FROM show_metadata;
    `);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. GET /api/movies & GET /api/shows
  // ==========================================
  describe('GET /api/movies & GET /api/shows', () => {
    it('GET /api/movies returns popular movies with default limit of 11', async () => {
      const mockMovies = Array.from({ length: 20 }, (_, i) => ({
        id: `tt${1000000 + i}`,
        title: `Movie ${i + 1}`,
        year: '2024',
        type: 'movie' as const,
        poster: `https://example.com/p${i}.jpg`,
        genres: ['Action', 'Sci-Fi']
      }));

      vi.spyOn(cinemetaClient, 'fetchPopularMovies').mockResolvedValue(mockMovies);

      const res = await request(app).get('/api/movies');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metadata');
      expect(res.body).toHaveProperty('progress');
      expect(res.body).toHaveProperty('ready');
      expect(res.body.metadata).toHaveLength(11);
      expect(res.body.metadata[0].id).toBe('tt1000000');
      expect(res.body.metadata[0].type).toBe('movie');
    });

    it('GET /api/movies respects custom limit query param', async () => {
      const mockMovies = Array.from({ length: 10 }, (_, i) => ({
        id: `tt${2000000 + i}`,
        title: `Movie ${i + 1}`,
        year: '2024',
        type: 'movie' as const
      }));

      vi.spyOn(cinemetaClient, 'fetchPopularMovies').mockResolvedValue(mockMovies);

      const res = await request(app).get('/api/movies?limit=3');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveLength(3);
    });

    it('GET /api/movies populates progress and ready status from DB', async () => {
      const movieId = 'tt0063350';
      const mockMovies = [
        { id: movieId, title: 'Night of the Living Dead', year: '1968', type: 'movie' as const }
      ];

      vi.spyOn(cinemetaClient, 'fetchPopularMovies').mockResolvedValue(mockMovies);

      // Seed progress in SQLite
      progressRepo.saveProgress(movieId, { timestamp: 3500, runtime: 5760 });

      // Seed stream in SQLite
      streamsRepo.registerStream(movieId, {
        quality: '1080p',
        size_bytes: 2500000000
      });

      const res = await request(app).get('/api/movies');

      expect(res.status).toBe(200);
      expect(res.body.progress[movieId]).toBeDefined();
      expect(res.body.progress[movieId].timestamp).toBe(3500);
      expect(res.body.ready[movieId]).toBeDefined();
      expect(res.body.ready[movieId].quality).toBe('1080p');
    });

    it('GET /api/shows returns popular shows with default limit of 11 and custom limits', async () => {
      const mockShows = Array.from({ length: 15 }, (_, i) => ({
        id: `tt${3000000 + i}`,
        title: `Show ${i + 1}`,
        year: '2023',
        type: 'show' as const,
        episodes: []
      }));

      vi.spyOn(cinemetaClient, 'fetchPopularShows').mockResolvedValue(mockShows);

      const res = await request(app).get('/api/shows');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveLength(11);
    });

    it('GET /api/shows populates show progress and ready status from DB', async () => {
      const showId = 'tt0903747'; // Breaking Bad
      const mockShows = [
        {
          id: showId,
          title: 'Breaking Bad',
          year: '2008',
          type: 'show' as const,
          episodes: [{ id: `${showId}:1:1`, season: 1, episode: 1, title: 'Pilot' }]
        }
      ];

      vi.spyOn(cinemetaClient, 'fetchPopularShows').mockResolvedValue(mockShows);

      // Seed progress in SQLite
      progressRepo.saveProgress(`${showId}_s1_e1`, {
        timestamp: 1200,
        runtime: 3480
      });

      // Seed stream in SQLite
      streamsRepo.registerStream(`${showId}_s1_e1`, {
        quality: '1080p',
        size_bytes: 1500000000
      });

      const res = await request(app).get('/api/shows');

      expect(res.status).toBe(200);
      expect(res.body.progress[`${showId}_s1_e1`]).toBeDefined();
      expect(res.body.progress[`${showId}_s1_e1`].timestamp).toBe(1200);
      expect(res.body.ready[`${showId}_s1_e1`]).toBeDefined();
      expect(res.body.ready[`${showId}_s1_e1`].quality).toBe('1080p');
    });
  });

  // ==========================================
  // 2. GET /api/movies/:id & GET /api/shows/:id
  // ==========================================
  describe('GET /api/movies/:id & GET /api/shows/:id', () => {
    it('GET /api/movies/:id handles cache miss by fetching from Cinemeta and saving to DB', async () => {
      const movieId = 'tt0056923'; // Charade
      const mockMeta = {
        id: movieId,
        title: 'Charade',
        year: '1963',
        type: 'movie' as const,
        runtime: '113 min',
        cast: ['Cary Grant', 'Audrey Hepburn'],
        genres: ['Comedy', 'Mystery']
      };

      const fetchSpy = vi.spyOn(cinemetaClient, 'fetchMetadataDetails').mockResolvedValue(mockMeta as any);

      const res = await request(app).get(`/api/movies/${movieId}`);

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(movieId, 'movie');
      expect(res.body.metadata.title).toBe('Charade');

      // Verify cached in DB
      const cached = metadataRepo.getCachedMetadata(movieId);
      expect(cached).not.toBeNull();
      expect(cached?.title).toBe('Charade');
    });

    it('GET /api/movies/:id returns cache hit from DB without calling Cinemeta', async () => {
      const movieId = 'tt0013442'; // Nosferatu
      const cachedMovie = {
        id: movieId,
        title: 'Nosferatu',
        year: '1922',
        type: 'movie' as const,
        runtime: 94,
        cast: ['Max Schreck', 'Gustav von Wangenheim'],
        genres: ['Horror', 'Mystery']
      };

      metadataRepo.saveCachedMetadata(movieId, 'movie', cachedMovie as any, 'movie');
      const fetchSpy = vi.spyOn(cinemetaClient, 'fetchMetadataDetails');

      const res = await request(app).get(`/api/movies/${movieId}`);

      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(res.body.metadata.title).toBe('Nosferatu');
      expect(res.body.metadata.cast).toContain('Max Schreck');
    });

    it('GET /api/shows/:id handles cache miss by fetching from Cinemeta and saving to DB', async () => {
      const showId = 'tt0032475'; // Flash Gordon Conquers the Universe
      const mockShow = {
        id: showId,
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        type: 'show' as const,
        status: 'Ended',
        episodes: [
          { id: `${showId}:1:1`, season: 1, episode: 1, title: 'The Purple Death' },
          { id: `${showId}:1:2`, season: 1, episode: 2, title: 'Freezing Torture' }
        ]
      };

      const fetchSpy = vi.spyOn(cinemetaClient, 'fetchMetadataDetails').mockResolvedValue(mockShow as any);

      const res = await request(app).get(`/api/shows/${showId}`);

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(showId, 'show');
      expect(res.body.metadata.title).toBe('Flash Gordon Conquers the Universe');
      expect(res.body.metadata.episodes).toHaveLength(2);
      expect(res.body.ready[`${showId}_s1_e1`]).toBeUndefined();

      // Verify cached in DB
      const cached = metadataRepo.getCachedMetadata(showId);
      expect(cached).not.toBeNull();
      expect(cached?.title).toBe('Flash Gordon Conquers the Universe');
    });

    it('GET /api/shows/:id returns cache hit from DB with hydrated download status', async () => {
      const showId = 'tt0032475';
      const cachedShow = {
        id: showId,
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        type: 'show' as const,
        status: 'Ended',
        episodes: [
          { id: `${showId}:1:1`, season: 1, episode: 1, title: 'The Purple Death' },
          { id: `${showId}:1:2`, season: 1, episode: 2, title: 'Freezing Torture' }
        ]
      };

      metadataRepo.saveCachedMetadata(showId, 'show', cachedShow as any, 'Ended');

      // Mark S01E01 as ready in DB
      streamsRepo.registerStream(`${showId}_s1_e1`, {
        quality: '1080p',
        size_bytes: 2000000000
      });

      const fetchSpy = vi.spyOn(cinemetaClient, 'fetchMetadataDetails');

      const res = await request(app).get(`/api/shows/${showId}`);

      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(res.body.metadata.title).toBe('Flash Gordon Conquers the Universe');
      expect(res.body.ready[`${showId}_s1_e1`]).toBeDefined();
      expect(res.body.ready[`${showId}_s1_e2`]).toBeUndefined();
    });
  });

  // ==========================================
  // 3. GET /api/search?q=query
  // ==========================================
  describe('GET /api/search', () => {
    it('returns 400 Bad Request when query parameter q is missing', async () => {
      const res = await request(app).get('/api/search');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.BAD_REQUEST });
    });

    it('returns search results structure with metadata, progress, and downloads', async () => {
      const mockResults = [
        {
          id: 'tt0063350',
          title: 'Night of the Living Dead',
          type: 'movie',
          year: '1968',
          poster: 'https://example.com/notld.jpg',
          genres: ['Horror']
        },
        {
          id: 'tt0055662',
          title: 'The Beverly Hillbillies',
          type: 'show',
          year: '1962',
          poster: 'https://example.com/tbh.jpg',
          genres: ['Comedy']
        }
      ];

      vi.spyOn(metahubClient, 'searchMetahub').mockResolvedValue(mockResults as any);

      // Seed progress for movie
      progressRepo.saveProgress('tt0063350', { timestamp: 500, runtime: 5760 });

      const res = await request(app).get('/api/search?q=living%20dead');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metadata');
      expect(res.body).toHaveProperty('progress');
      expect(res.body).toHaveProperty('ready');
      expect(res.body.metadata).toHaveLength(2);
      expect(res.body.metadata[0].title).toBe('Night of the Living Dead');
      expect(res.body.metadata[1].title).toBe('The Beverly Hillbillies');
      expect(res.body.progress['tt0063350']).toBeDefined();
      expect(res.body.progress['tt0063350'].timestamp).toBe(500);
    });
  });

  // ==========================================
  // 4. GET /api/continue-watching
  // ==========================================
  describe('GET /api/continue-watching', () => {
    it('returns empty lists when no progress records exist', async () => {
      const res = await request(app).get('/api/continue-watching');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        metadata: [],
        progress: {},
        ready: {}
      });
    });

    it('returns populated continue watching records for movies with limit and ready state', async () => {
      const movieId = 'tt0052077'; // Plan 9 from Outer Space
      metadataRepo.saveCachedMetadata(movieId, 'movie', {
        id: movieId,
        title: 'Plan 9 from Outer Space',
        year: '1957',
        genres: ['Horror', 'Sci-Fi']
      } as any, 'movie');

      progressRepo.saveProgress(movieId, { timestamp: 2400, runtime: 4740 });

      streamsRepo.registerStream(movieId, {
        quality: '1080p',
        size_bytes: 1500000000
      });

      const res = await request(app).get('/api/continue-watching?type=movie&limit=5');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveLength(1);
      expect(res.body.metadata[0].id).toBe(movieId);
      expect(res.body.metadata[0].title).toBe('Plan 9 from Outer Space');
      expect(res.body.progress[movieId]).toBeDefined();
      expect(res.body.progress[movieId].timestamp).toBe(2400);
      expect(res.body.ready[movieId]).toBeDefined();
      expect(res.body.ready[movieId].quality).toBe('1080p');
    });

    it('returns populated continue watching records for show', async () => {
      const showId = 'tt0046642'; // Sherlock Holmes (1954)
      metadataRepo.saveCachedMetadata(showId, 'show', {
        id: showId,
        title: 'Sherlock Holmes',
        year: '1954',
        genres: ['Crime', 'Drama', 'Mystery']
      } as any, 'Ended');

      progressRepo.saveProgress(`${showId}_s1_e1`, {
        timestamp: 1200,
        runtime: 1800
      });

      const res = await request(app).get('/api/continue-watching?type=show');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveLength(1);
      expect(res.body.metadata[0].id).toBe(showId);
      expect(res.body.progress[`${showId}_s1_e1`]).toBeDefined();
      expect(res.body.progress[`${showId}_s1_e1`].timestamp).toBe(1200);
    });
  });

  // ==========================================
  // 5. POST /api/media/:id/progress
  // ==========================================
  describe('POST /api/media/:id/progress', () => {
    it('returns 400 Bad Request if media id is invalid', async () => {
      const res = await request(app)
        .post(`/api/media/${encodeURIComponent('invalid!@#')}/progress`)
        .send({ timestamp: 100 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.BAD_REQUEST });
    });

    it('saves and updates movie watch progress and runtime', async () => {
      const movieId = 'tt0017925'; // The General

      // Save initial timestamp
      const res1 = await request(app)
        .post(`/api/media/${movieId}/progress`)
        .send({
          timestamp: 1500,
          runtime: 4620
        });

      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({ success: true });

      const prog1 = progressRepo.getProgress(movieId);
      expect(prog1).not.toBeNull();
      expect(prog1?.timestamp).toBe(1500);
      expect(prog1?.runtime).toBe(4620);

      // Update timestamp and runtime
      const res2 = await request(app)
        .post(`/api/media/${movieId}/progress`)
        .send({
          timestamp: 3200,
          runtime: 4620
        });

      expect(res2.status).toBe(200);
      const prog2 = progressRepo.getProgress(movieId);
      expect(prog2?.timestamp).toBe(3200);
    });

    it('saves and updates show episode watch progress', async () => {
      const showId = 'tt0055662'; // The Beverly Hillbillies
      const fileId = `${showId}_s2_e3`;

      const res = await request(app)
        .post(`/api/media/${fileId}/progress`)
        .send({
          timestamp: 850,
          runtime: 1500
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      const showProg = progressRepo.getSingleShowProgress(showId);
      expect(showProg.last_season).toBe(2);
      expect(showProg.last_episode).toBe(3);
      expect(showProg.episodes[fileId]).toBeDefined();
      expect(showProg.episodes[fileId].timestamp).toBe(850);
      expect(showProg.episodes[fileId].runtime).toBe(1500);
    });
  });

  // ==========================================
  // 6. Subtitle Preference Routes
  // ==========================================
  describe('GET & POST Subtitle Preferences', () => {
    it('GET returns null subtitle preference by default', async () => {
      const res = await request(app).get('/api/media/tt1234567/subtitles/preference');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ subtitle_lang: null });
    });

    it('POST saves subtitle preference and GET retrieves it', async () => {
      const mediaId = 'tt1234567';

      // Save via POST /api/media/:id/subtitles/preference
      const postRes = await request(app)
        .post(`/api/media/${mediaId}/subtitles/preference`)
        .send({ subtitle_lang: 'spa' });

      expect(postRes.status).toBe(200);
      expect(postRes.body).toEqual({ success: true });

      // Retrieve via GET /api/media/:id/subtitles/preference
      const getRes = await request(app).get(`/api/media/${mediaId}/subtitles/preference`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({ subtitle_lang: 'spa' });

      // Update to null
      const postNullRes = await request(app)
        .post(`/api/media/${mediaId}/subtitles/preference`)
        .send({ subtitle_lang: null });

      expect(postNullRes.status).toBe(200);

      const getNullRes = await request(app).get(`/api/media/${mediaId}/subtitles/preference`);
      expect(getNullRes.status).toBe(200);
      expect(getNullRes.body).toEqual({ subtitle_lang: null });
    });
  });

  // ==========================================
  // 7. POST /api/media/:id/request
  // ==========================================
  describe('POST /api/media/:id/request', () => {
    it('POST /api/media/:id/request returns 400 Bad Request when media id is invalid', async () => {
      const res = await request(app)
        .post(`/api/media/${encodeURIComponent('invalid!@#')}/request`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.BAD_REQUEST });
    });

    it('POST /api/media/:id/request returns 404 NO_STREAMS_FOUND when no torrent candidates are found', async () => {
      vi.spyOn(torrentProviderClient, 'getTopTorrents').mockResolvedValue([]);

      const res = await request(app)
        .post('/api/media/tt9999999/request')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ErrorCode.NO_STREAMS_FOUND });
    });

    it('POST /api/media/:id/request returns ready status (200) if already downloaded in DB', async () => {
      const movieId = 'tt0017136'; // Metropolis
      streamsRepo.registerStream(movieId, {
        quality: '1080p',
        size_bytes: 3000000000
      });

      const getTorrentsSpy = vi.spyOn(torrentProviderClient, 'getTopTorrents');

      const res = await request(app)
        .post(`/api/media/${movieId}/request`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: movieId,
        status: 'ready',
        progress: '100.00'
      });
      expect(getTorrentsSpy).not.toHaveBeenCalled();
    });

    it('POST /api/media/:id/request returns active state (200) if already active in Redis', async () => {
      const movieId = 'tt0017136';
      activeMediaStore[movieId] = {
        fileId: movieId,
        status: 'downloading' as any,
        progress: '65.40',
        updatedAt: Date.now()
      };

      const getTorrentsSpy = vi.spyOn(torrentProviderClient, 'getTopTorrents');

      const res = await request(app)
        .post(`/api/media/${movieId}/request`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: movieId,
        status: 'preparing',
        progress: '52.32'
      });
      expect(getTorrentsSpy).not.toHaveBeenCalled();
    });

    it('POST /api/media/:id/request enqueues new movie request and returns 202 Accepted', async () => {
      const movieId = 'tt0063350'; // Night of the Living Dead
      const mockTorrents = [
        {
          hash: '1234567890abcdef1234567890abcdef12345678',
          title: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264',
          quality: '1080p',
          size: '2.5 GB',
          sizeGB: 2.5,
          peers: 150,
          fileIdx: 0,
          codec: 'h264' as const
        }
      ];

      vi.spyOn(torrentProviderClient, 'getTopTorrents').mockResolvedValue(mockTorrents);
      vi.spyOn(torrentProviderClient, 'constructMagnetUrl').mockReturnValue('magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678');
      vi.spyOn(cinemetaClient, 'fetchMetadataDetails').mockResolvedValue({
        id: movieId,
        title: 'Night of the Living Dead',
        type: 'movie',
        genres: ['Horror']
      } as any);

      const res = await request(app)
        .post(`/api/media/${movieId}/request`);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        id: movieId,
        status: 'queued',
        progress: '0.00'
      });
      expect(queuesModule.downloadQueue.add).toHaveBeenCalledWith(
        'download',
        expect.objectContaining({
          fileId: movieId,
          hash: '1234567890abcdef1234567890abcdef12345678',
          quality: '1080p'
        }),
        expect.objectContaining({
          jobId: movieId,
          priority: DOWNLOAD_PRIORITIES.NORMAL
        })
      );
      expect(queuesModule.publishMediaRequestStatus).toHaveBeenCalledWith(movieId, 'queued', '0.00');
    });

    it('POST /api/media/:id/request enqueues show episode request with composite fileId', async () => {
      const showId = 'tt0055662'; // The Beverly Hillbillies
      const fileId = `${showId}_s1_e1`;
      const mockTorrents = [
        {
          hash: 'abcdef1234567890abcdef1234567890abcdef12',
          title: 'The.Beverly.Hillbillies.S01E01.720p',
          quality: '720p',
          size: '1.2 GB',
          sizeGB: 1.2,
          peers: 80,
          fileIdx: 0,
          codec: 'h264' as const
        }
      ];

      vi.spyOn(torrentProviderClient, 'getTopTorrents').mockResolvedValue(mockTorrents);
      vi.spyOn(torrentProviderClient, 'constructMagnetUrl').mockReturnValue('magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12');
      vi.spyOn(cinemetaClient, 'fetchMetadataDetails').mockResolvedValue({
        id: showId,
        title: 'The Beverly Hillbillies',
        type: 'show',
        genres: ['Comedy']
      } as any);

      const res = await request(app)
        .post(`/api/media/${fileId}/request`);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        id: fileId,
        status: 'queued',
        progress: '0.00'
      });
      expect(queuesModule.downloadQueue.add).toHaveBeenCalledWith(
        'download',
        expect.objectContaining({ fileId }),
        expect.objectContaining({ jobId: fileId })
      );
    });
  });

  // ==========================================
  // 8. GET /api/queue
  // ==========================================
  describe('GET /api/queue', () => {
    it('returns empty queue state when no media is active', async () => {
      const res = await request(app).get('/api/queue');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        activeMediaRequests: {}
      });
    });

    it('returns active requests transformed to user status from Redis state', async () => {
      activeMediaStore = {
        'tt111': { fileId: 'tt111', status: 'downloading' as any, progress: '50.00', updatedAt: 1 },
        'tt222': { fileId: 'tt222', status: 'queued' as any, progress: '0.00', updatedAt: 2 },
        'tt333': { fileId: 'tt333', status: 'queued' as any, progress: '0.00', updatedAt: 3 }
      };

      const res = await request(app).get('/api/queue');
      expect(res.status).toBe(200);
      expect(res.body.activeMediaRequests['tt111']).toMatchObject({
        fileId: 'tt111',
        status: 'preparing',
        progress: '40.00'
      });
      expect(res.body.activeMediaRequests['tt222']).toMatchObject({
        fileId: 'tt222',
        status: 'queued',
        progress: '0.00'
      });
    });
  });

  // ==========================================
  // 9. GET /api/media/:id/stream Resolver
  // ==========================================
  describe('GET /api/media/:id/stream', () => {
    it('GET /api/media/:id/stream throws 400 MEDIA_NOT_READY if media is not ready', async () => {
      const res = await request(app).get('/api/media/tt9998887/stream');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.MEDIA_NOT_READY });
    });
  });
});
