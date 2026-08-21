import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { db } from '../../src/main/db/index.js';
import { metadataRepo } from '../../src/main/db/metadata.js';
import { progressRepo } from '../../src/main/db/progress.js';
import { downloadsRepo } from '../../src/main/db/downloads.js';
import { cinemetaClient } from '../../src/main/clients/cinemeta.js';
import { metahubClient } from '../../src/main/clients/metahub.js';
import { torrentProviderClient } from '../../src/main/clients/torrentProvider.js';
import * as queuesModule from '../../src/main/queues/index.js';
import apiRouter from '../../src/main/routes/api.js';
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
    transcodeQueue: {
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
    publishDownloadStatus: vi.fn().mockImplementation(async (id: string, status: string, progress: string | number) => {
      if (status === 'completed' || status === 'failed' || status === 'removed') {
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
      DELETE FROM episode_progress;
      DELETE FROM movie_progress;
      DELETE FROM episode_downloads;
      DELETE FROM movie_downloads;
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
      expect(res.body).toHaveProperty('downloads');
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

    it('GET /api/movies populates progress and download status from DB', async () => {
      const movieId = 'tt0063350';
      const mockMovies = [
        { id: movieId, title: 'Night of the Living Dead', year: '1968', type: 'movie' as const }
      ];

      vi.spyOn(cinemetaClient, 'fetchPopularMovies').mockResolvedValue(mockMovies);

      // Seed progress in SQLite
      progressRepo.saveMovieProgress(movieId, { timestamp: 3500, runtime: 5760 });

      // Seed download in SQLite
      downloadsRepo.addDownloadEntry(movieId, {
        fileName: 'Night_of_the_Living_Dead.m3u8',
        torrentHash: 'abcdef1234567890abcdef1234567890abcdef12',
        fileHash: 'filehash123',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 2500000000
      });

      const res = await request(app).get('/api/movies');

      expect(res.status).toBe(200);
      expect(res.body.progress[movieId]).toBeDefined();
      expect(res.body.progress[movieId].timestamp).toBe(3500);
      expect(res.body.downloads[movieId]).toBeDefined();
      expect(res.body.downloads[movieId].is_downloaded).toBe(true);
      expect(res.body.downloads[movieId].quality).toBe('1080p');
    });

    it('GET /api/shows returns popular shows with default limit of 11 and custom limits', async () => {
      const mockShows = Array.from({ length: 15 }, (_, i) => ({
        id: `tt${3000000 + i}`,
        title: `Show ${i + 1}`,
        year: '2023',
        type: 'series' as const,
        videos: []
      }));

      vi.spyOn(cinemetaClient, 'fetchPopularShows').mockResolvedValue(mockShows);

      const resDefault = await request(app).get('/api/shows');
      expect(resDefault.status).toBe(200);
      expect(resDefault.body.metadata).toHaveLength(11);

      const resLimited = await request(app).get('/api/shows?limit=4');
      expect(resLimited.status).toBe(200);
      expect(resLimited.body.metadata).toHaveLength(4);
    });

    it('GET /api/shows populates show progress and downloads from DB', async () => {
      const showId = 'tt0055662'; // The Beverly Hillbillies
      const mockShows = [
        { id: showId, title: 'The Beverly Hillbillies', year: '1962', type: 'series' as const, videos: [] }
      ];

      vi.spyOn(cinemetaClient, 'fetchPopularShows').mockResolvedValue(mockShows);

      // Seed show episode progress
      progressRepo.saveShowProgress(showId, {
        timestamp: 1200,
        last_season: 1,
        last_episode: 1,
        episodes: {
          [`${showId}_s1_e1`]: {
            id: `${showId}_s1_e1`,
            show_id: showId,
            season: 1,
            episode: 1,
            timestamp: 1200,
            runtime: 3000
          }
        }
      });

      // Seed episode download
      downloadsRepo.addDownloadEntry(`${showId}_s1_e1`, {
        fileName: 'BB_S01E01.m3u8',
        torrentHash: 'aabbccddeeff00112233445566778899aabbccdd',
        fileHash: 'epfilehash1',
        fileIdx: 1,
        quality: '1080p',
        sizeBytes: 1500000000
      });

      const res = await request(app).get('/api/shows');

      expect(res.status).toBe(200);
      expect(res.body.progress[showId]).toBeDefined();
      expect(res.body.progress[showId].last_season).toBe(1);
      expect(res.body.downloads[`${showId}_s1_e1`]).toBeDefined();
      expect(res.body.downloads[`${showId}_s1_e1`].is_downloaded).toBe(true);
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
      expect(cached?.metadata?.title).toBe('Charade');
    });

    it('GET /api/movies/:id returns cache hit from DB without calling Cinemeta', async () => {
      const movieId = 'tt0013442'; // Nosferatu
      const cachedMovie = {
        id: movieId,
        title: 'Nosferatu',
        year: '1922',
        type: 'movie',
        runtime: '94 min',
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
        type: 'series' as const,
        status: 'Ended',
        videos: [
          { id: `${showId}:1:1`, season: 1, episode: 1, title: 'The Purple Death' },
          { id: `${showId}:1:2`, season: 1, episode: 2, title: 'Freezing Torture' }
        ]
      };

      const fetchSpy = vi.spyOn(cinemetaClient, 'fetchMetadataDetails').mockResolvedValue(mockShow as any);

      const res = await request(app).get(`/api/shows/${showId}`);

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(showId, 'series');
      expect(res.body.metadata.title).toBe('Flash Gordon Conquers the Universe');
      expect(res.body.metadata.videos).toHaveLength(2);
      expect(res.body.metadata.videos[0].is_downloaded).toBe(false);

      // Verify cached in DB
      const cached = metadataRepo.getCachedMetadata(showId);
      expect(cached).not.toBeNull();
      expect(cached?.metadata?.title).toBe('Flash Gordon Conquers the Universe');
    });

    it('GET /api/shows/:id returns cache hit from DB with hydrated download status', async () => {
      const showId = 'tt0032475';
      const cachedShow = {
        id: showId,
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        type: 'series',
        status: 'Ended',
        videos: [
          { id: `${showId}:1:1`, season: 1, episode: 1, title: 'The Purple Death' },
          { id: `${showId}:1:2`, season: 1, episode: 2, title: 'Freezing Torture' }
        ]
      };

      metadataRepo.saveCachedMetadata(showId, 'series', cachedShow as any, 'Ended');

      // Mark S01E01 as downloaded in DB
      downloadsRepo.addDownloadEntry(`${showId}_s1_e1`, {
        fileName: 'FlashGordon_S01E01.m3u8',
        torrentHash: '1122334455667788990011223344556677889900',
        fileHash: 'fgfile1',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 2000000000
      });

      const fetchSpy = vi.spyOn(cinemetaClient, 'fetchMetadataDetails');

      const res = await request(app).get(`/api/shows/${showId}`);

      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(res.body.metadata.title).toBe('Flash Gordon Conquers the Universe');
      expect(res.body.metadata.videos[0].is_downloaded).toBe(true);
      expect(res.body.metadata.videos[1].is_downloaded).toBe(false);
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
          type: 'series',
          year: '1962',
          poster: 'https://example.com/tbh.jpg',
          genres: ['Comedy']
        }
      ];

      vi.spyOn(metahubClient, 'searchMetahub').mockResolvedValue(mockResults as any);

      // Seed progress for movie
      progressRepo.saveMovieProgress('tt0063350', { timestamp: 500, runtime: 5760 });

      const res = await request(app).get('/api/search?q=living%20dead');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('metadata');
      expect(res.body).toHaveProperty('progress');
      expect(res.body).toHaveProperty('downloads');
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
        downloads: {}
      });
    });

    it('returns populated continue watching records for movies with limit and downloads', async () => {
      const movieId = 'tt0052077'; // Plan 9 from Outer Space
      metadataRepo.saveCachedMetadata(movieId, 'movie', {
        id: movieId,
        title: 'Plan 9 from Outer Space',
        year: '1957',
        genres: ['Horror', 'Sci-Fi']
      } as any, 'movie');

      progressRepo.saveMovieProgress(movieId, { timestamp: 2400, runtime: 4740 });

      downloadsRepo.addDownloadEntry(movieId, {
        fileName: 'Plan_9_from_Outer_Space.m3u8',
        torrentHash: '1234567890123456789012345678901234567890',
        fileHash: 'plan9file',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 1500000000
      });

      const res = await request(app).get('/api/continue-watching?type=movie&limit=5');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveLength(1);
      expect(res.body.metadata[0].id).toBe(movieId);
      expect(res.body.metadata[0].title).toBe('Plan 9 from Outer Space');
      expect(res.body.progress[movieId]).toBeDefined();
      expect(res.body.progress[movieId].timestamp).toBe(2400);
      expect(res.body.downloads[movieId]).toBeDefined();
      expect(res.body.downloads[movieId].is_downloaded).toBe(true);
    });

    it('returns populated continue watching records for series', async () => {
      const showId = 'tt0046642'; // Sherlock Holmes (1954)
      metadataRepo.saveCachedMetadata(showId, 'series', {
        id: showId,
        title: 'Sherlock Holmes',
        year: '1954',
        genres: ['Crime', 'Drama', 'Mystery']
      } as any, 'Ended');

      progressRepo.saveShowProgress(showId, {
        timestamp: 1200,
        last_season: 1,
        last_episode: 1,
        episodes: {
          [`${showId}_s1_e1`]: {
            id: `${showId}_s1_e1`,
            show_id: showId,
            season: 1,
            episode: 1,
            timestamp: 1200,
            runtime: 1800
          }
        }
      });

      const res = await request(app).get('/api/continue-watching?type=series');

      expect(res.status).toBe(200);
      expect(res.body.metadata).toHaveLength(1);
      expect(res.body.metadata[0].id).toBe(showId);
      expect(res.body.progress[`${showId}_s1_e1`]).toBeDefined();
      expect(res.body.progress[`${showId}_s1_e1`].timestamp).toBe(1200);
    });
  });

  // ==========================================
  // ==========================================
  // 5. POST /api/save-timestamp
  // ==========================================
  describe('POST /api/save-timestamp', () => {
    it('returns 400 Bad Request if neither movieId nor showId is provided', async () => {
      const res = await request(app)
        .post('/api/save-timestamp')
        .send({ timestamp: 100 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.BAD_REQUEST });
    });

    it('returns 400 Bad Request if showId is provided without season or episode', async () => {
      const res = await request(app)
        .post('/api/save-timestamp')
        .send({ showId: 'tt1234567', timestamp: 100 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.BAD_REQUEST });
    });

    it('saves and updates movie watch progress and runtime', async () => {
      const movieId = 'tt0017925'; // The General

      // Save initial timestamp
      const res1 = await request(app)
        .post('/api/save-timestamp')
        .send({
          movieId,
          timestamp: 1500,
          metadata: { runtime: 4620 }
        });

      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({ success: true });

      const prog1 = progressRepo.getSingleMovieProgress(movieId);
      expect(prog1).not.toBeNull();
      expect(prog1?.timestamp).toBe(1500);
      expect(prog1?.runtime).toBe(4620);

      // Update timestamp and runtime
      const res2 = await request(app)
        .post('/api/save-timestamp')
        .send({
          movieId,
          timestamp: 3200,
          metadata: { runtime: 4620 }
        });

      expect(res2.status).toBe(200);
      const prog2 = progressRepo.getSingleMovieProgress(movieId);
      expect(prog2?.timestamp).toBe(3200);
    });

    it('saves and updates show episode watch progress', async () => {
      const showId = 'tt0055662'; // The Beverly Hillbillies

      const res = await request(app)
        .post('/api/save-timestamp')
        .send({
          showId,
          season: 2,
          episode: 3,
          timestamp: 850,
          metadata: { runtime: 1500 }
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      const showProg = progressRepo.getSingleShowProgress(showId);
      expect(showProg.last_season).toBe(2);
      expect(showProg.last_episode).toBe(3);
      expect(showProg.episodes[`${showId}_s2_e3`]).toBeDefined();
      expect(showProg.episodes[`${showId}_s2_e3`].timestamp).toBe(850);
      expect(showProg.episodes[`${showId}_s2_e3`].runtime).toBe(1500);
    });
  });

  // ==========================================
  // 6. Subtitle Preference Routes
  // ==========================================
  describe('GET & POST Subtitle Preferences', () => {
    it('GET returns null subtitle preference by default', async () => {
      const res = await request(app).get('/api/preferences/subtitles/tt1234567');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ subtitle_lang: null });
    });

    it('POST saves subtitle preference and GET retrieves it', async () => {
      const mediaId = 'tt1234567';

      // Save via POST /api/preferences/subtitles/:mediaId
      const postRes = await request(app)
        .post(`/api/preferences/subtitles/${mediaId}`)
        .send({ subtitle_lang: 'spa' });

      expect(postRes.status).toBe(200);
      expect(postRes.body).toEqual({ success: true });

      // Retrieve via GET /api/preferences/subtitles/:mediaId
      const getRes = await request(app).get(`/api/preferences/subtitles/${mediaId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({ subtitle_lang: 'spa' });

      // Update to null
      const postNullRes = await request(app)
        .post(`/api/preferences/subtitles/${mediaId}`)
        .send({ subtitle_lang: null });

      expect(postNullRes.status).toBe(200);

      const getNullRes = await request(app).get(`/api/preferences/subtitles/${mediaId}`);
      expect(getNullRes.status).toBe(200);
      expect(getNullRes.body).toEqual({ subtitle_lang: null });
    });
  });

  // ==========================================
  // 7. POST /api/download & DELETE /api/download/:id
  // ==========================================
  describe('POST & DELETE /api/download', () => {
    it('POST /api/download returns 400 Bad Request when movieId and showId are missing', async () => {
      const res = await request(app)
        .post('/api/download')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.BAD_REQUEST });
    });

    it('POST /api/download returns 404 NO_STREAMS_FOUND when no torrent candidates are found', async () => {
      vi.spyOn(torrentProviderClient, 'getTopTorrents').mockResolvedValue([]);

      const res = await request(app)
        .post('/api/download')
        .send({ movieId: 'tt9999999' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: ErrorCode.NO_STREAMS_FOUND });
    });

    it('POST /api/download returns completed status (200) if already downloaded in DB', async () => {
      const movieId = 'tt0017136'; // Metropolis
      downloadsRepo.addDownloadEntry(movieId, {
        fileName: 'Metropolis.m3u8',
        torrentHash: 'metropolishash123456789012345678901234',
        fileHash: 'fh_metropolis',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 3000000000
      });

      const getTorrentsSpy = vi.spyOn(torrentProviderClient, 'getTopTorrents');

      const res = await request(app)
        .post('/api/download')
        .send({ movieId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: movieId,
        status: 'completed',
        progress: '100.00'
      });
      expect(getTorrentsSpy).not.toHaveBeenCalled();
    });

    it('POST /api/download returns active state (200) if already active in Redis', async () => {
      const movieId = 'tt0017136';
      activeMediaStore[movieId] = {
        fileId: movieId,
        status: 'downloading' as any,
        progress: '65.40',
        updatedAt: Date.now()
      };

      const getTorrentsSpy = vi.spyOn(torrentProviderClient, 'getTopTorrents');

      const res = await request(app)
        .post('/api/download')
        .send({ movieId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: movieId,
        status: 'downloading',
        progress: '65.40'
      });
      expect(getTorrentsSpy).not.toHaveBeenCalled();
    });

    it('POST /api/download enqueues new movie download and returns 202 Accepted', async () => {
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
        .post('/api/download')
        .send({ movieId, metadata: { title: 'Night of the Living Dead', runtime: 5760 } });

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
          priority: 1
        })
      );
      expect(queuesModule.publishDownloadStatus).toHaveBeenCalledWith(movieId, 'queued', '0.00');
    });

    it('POST /api/download enqueues show episode download with composite fileId', async () => {
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
        type: 'series',
        genres: ['Comedy']
      } as any);

      const res = await request(app)
        .post('/api/download')
        .send({
          showId,
          season: 1,
          episode: 1,
          metadata: { name: 'The Beverly Hillbillies' }
        });

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

    it('DELETE /api/download/:id cancels queue jobs, deletes Redis active state and DB row', async () => {
      const movieId = 'tt0063350';

      // Seed download in DB & active state in Redis
      downloadsRepo.addDownloadEntry(movieId, {
        fileName: 'Night_of_the_Living_Dead.m3u8',
        torrentHash: 'hash123',
        fileHash: 'fh1',
        fileIdx: 0,
        quality: '1080p',
        sizeBytes: 1000
      });
      activeMediaStore[movieId] = {
        fileId: movieId,
        status: 'downloading' as any,
        progress: '30.00',
        updatedAt: Date.now()
      };

      const res = await request(app).delete(`/api/download/${movieId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: movieId,
        status: 'removed'
      });
      expect(queuesModule.deleteActiveMediaState).toHaveBeenCalledWith(movieId);
      expect(queuesModule.publishDownloadStatus).toHaveBeenCalledWith(movieId, 'removed', '0.00');
      expect(downloadsRepo.isDownloaded(movieId)).toBe(false);
    });
  });

  // ==========================================
  // 8. GET /api/queue-state
  // ==========================================
  describe('GET /api/queue-state', () => {
    it('returns empty queue state when no media is active', async () => {
      const res = await request(app).get('/api/queue-state');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        activeDownloads: {},
        active: null,
        current: null,
        queue: []
      });
    });

    it('returns segregated active and queued downloads from Redis state', async () => {
      activeMediaStore = {
        'tt111': { fileId: 'tt111', status: 'downloading' as any, progress: '50.00', updatedAt: 1 },
        'tt222': { fileId: 'tt222', status: 'queued' as any, progress: '0.00', updatedAt: 2 },
        'tt333': { fileId: 'tt333', status: 'queued' as any, progress: '0.00', updatedAt: 3 }
      };

      const res = await request(app).get('/api/queue-state');
      expect(res.status).toBe(200);
      expect(res.body.active?.fileId).toBe('tt111');
      expect(res.body.current?.fileId).toBe('tt111');
      expect(res.body.queue).toHaveLength(2);
      expect(res.body.queue.map((q: any) => q.fileId)).toEqual(['tt222', 'tt333']);
    });
  });

  // ==========================================
  // 9. POST /api/stream Resolver & GET /api/media/:id/subtitles
  // ==========================================
  describe('POST /api/stream & GET /api/media/:id/subtitles', () => {
    it('POST /api/stream throws 400 MEDIA_NOT_DOWNLOADED if media is not downloaded', async () => {
      const res = await request(app)
        .post('/api/stream')
        .send({ movieId: 'tt9998887' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: ErrorCode.MEDIA_NOT_DOWNLOADED });
    });

    it('GET /api/media/:id/subtitles returns empty subtitle list when none exist', async () => {
      const res = await request(app).get('/api/media/tt9998887/subtitles');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('subtitles');
      expect(Array.isArray(res.body.subtitles)).toBe(true);
    });
  });
});
