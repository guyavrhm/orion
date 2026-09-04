import express, { type Request, type Response, type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { metadataRepo } from '../db/metadata.js';
import { progressRepo } from '../db/progress.js';
import { streamsRepo } from '../db/streams.js';
import {
  getLocalSubtitles,
  getSubtitlePreference,
  saveSubtitlePreference
} from '../db/subtitles.js';
import { torrentProviderClient } from '../clients/torrentProvider.js';
import { cinemetaClient } from '../clients/cinemeta.js';
import { metahubClient } from '../clients/metahub.js';
import {
  downloadQueue,
  subtitleQueue,
  finalizeQueue,
  getActiveMediaState,
  getAllActiveMedia,
  deleteActiveMediaState,
  publishMediaRequestStatus
} from '../queues/index.js';
import { DOWNLOAD_PRIORITIES } from '../config/queue.js';
import { MEDIA_REQUEST_STATUS, ErrorCode } from '../types/index.js';
import { parseFileId, getMediaDirs, toUserMediaRequestStatus } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import type {
  MovieMetadata,
  ShowMetadata,
  Progress,
  ProgressUpdate,
  Stream,
  SubtitleTrack,
  SubtitlePreference,
  MediaResponse,
  QueueStateResponse,
  UserActiveMediaState,
  MediaRequestStatus,
  MediaRequestStatusEvent,
  UserMediaRequestResponse,
  MediaType,
  ParsedTorrentCandidate
} from '../types/index.js';

const router: Router = express.Router();

// ==========================================
// Request / Response DTO Interfaces
// ==========================================

export interface CatalogQuery {
  limit?: string;
}

export interface SearchQuery {
  q?: string;
}

export interface ContinueWatchingQuery {
  limit?: string;
  type?: MediaType;
}

export interface MediaIdParam {
  id: string;
}

export type CatalogMoviesResponse = MediaResponse<MovieMetadata[]>;
export type CatalogShowsResponse = MediaResponse<ShowMetadata[]>;
export type MovieDetailResponse = MediaResponse<MovieMetadata>;
export type ShowDetailResponse = MediaResponse<ShowMetadata>;
export type SearchResponse = MediaResponse<(MovieMetadata | ShowMetadata)[]>;

export interface SuccessResponse {
  success: boolean;
}

export interface StreamResponse {
  success: boolean;
  url: string;
  subtitles: SubtitleTrack[];
}

// 1. Browsing catalogs
router.get('/api/movies', async (req: Request<unknown, CatalogMoviesResponse, unknown, CatalogQuery>, res: Response<CatalogMoviesResponse>) => {
  const limit = Number(req.query.limit) || 11;
  const list = await cinemetaClient.fetchPopularMovies();
  const sliced = list.slice(0, limit);

  const progressMap: Record<string, Progress> = {};
  const readyMap: Record<string, Stream> = {};

  for (const item of sliced) {
    const { id } = item;

    // Populate watch progress
    const prog = progressRepo.getProgress(id);
    if (prog) {
      progressMap[id] = prog;
    }

    // Populate ready status
    const st = streamsRepo.getMovieStream(id);
    if (st) {
      readyMap[id] = {
        id: st.id,
        show_id: st.show_id,
        quality: st.quality,
        size_bytes: st.size_bytes,
        ready_at: st.ready_at
      };
    }
  }

  res.json({ metadata: sliced, progress: progressMap, ready: readyMap });
});

router.get('/api/shows', async (req: Request<unknown, CatalogShowsResponse, unknown, CatalogQuery>, res: Response<CatalogShowsResponse>) => {
  const limit = Number(req.query.limit) || 11;
  const list = await cinemetaClient.fetchPopularShows();
  const sliced = list.slice(0, limit);

  const progressMap: Record<string, Progress> = {};
  const readyMap: Record<string, Stream> = {};

  for (const item of sliced) {
    const { id } = item;

    // Populate watch progress
    const prog = progressRepo.getSingleShowProgress(id);
    if (prog && prog.episodes) {
      for (const [epId, epProg] of Object.entries(prog.episodes)) {
        progressMap[epId] = epProg;
      }
    }

    // Populate ready status
    const showStreams = streamsRepo.getShowStreams(id);
    if (showStreams) {
      for (const [epId, st] of Object.entries(showStreams)) {
        readyMap[epId] = {
          id: st.id,
          show_id: id,
          quality: st.quality,
          size_bytes: st.size_bytes,
          ready_at: st.ready_at
        };
      }
    }
  }

  res.json({ metadata: sliced, progress: progressMap, ready: readyMap });
});

// 2. Details
router.get('/api/movies/:id', async (req: Request<MediaIdParam, MovieDetailResponse>, res: Response<MovieDetailResponse>) => {
  const id = req.params.id;
  const cached = metadataRepo.getCachedMovieMetadata(id);
  const singleProg = progressRepo.getProgress(id) || { id, show_id: null, timestamp: 0, runtime: 0, last_updated: 0 };
  const progress: Record<string, Progress> = { [id]: singleProg };
  const st = streamsRepo.getMovieStream(id);
  const ready: Record<string, Stream> = st
    ? { [id]: { id: st.id, show_id: st.show_id, quality: st.quality, size_bytes: st.size_bytes, ready_at: st.ready_at } }
    : {};

  if (cached) {
    logger.debug(`Detail movie Cache HIT: ${id}`);
    return res.json({ metadata: cached, progress, ready });
  }

  logger.debug(`Detail movie Cache MISS: ${id}. Fetching from Cinemeta.`);
  const movieMeta = (await cinemetaClient.fetchMetadataDetails(id, 'movie')) as MovieMetadata;
  metadataRepo.saveCachedMetadata(movieMeta.id, 'movie', movieMeta, 'movie');

  res.json({ metadata: movieMeta, progress, ready });
});

router.get('/api/shows/:id', async (req: Request<MediaIdParam, ShowDetailResponse>, res: Response<ShowDetailResponse>) => {
  const id = req.params.id;
  const cached = metadataRepo.getCachedShowMetadata(id);
  const singleProg = progressRepo.getSingleShowProgress(id);
  const progress: Record<string, Progress> = {};
  if (singleProg && singleProg.episodes) {
    for (const [epId, epProg] of Object.entries(singleProg.episodes)) {
      progress[epId] = epProg;
    }
  }

  const showStreams = streamsRepo.getShowStreams(id);
  const ready: Record<string, Stream> = {};
  if (showStreams) {
    for (const [epId, st] of Object.entries(showStreams)) {
      ready[epId] = {
        id: st.id,
        show_id: id,
        quality: st.quality,
        size_bytes: st.size_bytes,
        ready_at: st.ready_at
      };
    }
  }

  if (cached && cached.episodes.length > 0) {
    const isContinuing = cached.status === 'Continuing';
    const isExpired = isContinuing && cached.last_fetched && (Date.now() - cached.last_fetched > 24 * 60 * 60 * 1000);
    if (!isExpired) {
      logger.debug(`Detail show Cache HIT (valid): ${id}`);
      return res.json({ metadata: cached, progress, ready });
    }
    logger.debug(`Detail show Cache expired (TTL): ${id}. Re-fetching.`);
  }

  const showMeta = (await cinemetaClient.fetchMetadataDetails(id, 'show')) as ShowMetadata;
  metadataRepo.saveCachedMetadata(showMeta.id, 'show', showMeta, showMeta.status || 'Continuing');

  res.json({ metadata: showMeta, progress, ready });
});

// 3. Search
router.get('/api/search', async (req: Request<unknown, SearchResponse, unknown, SearchQuery>, res: Response<SearchResponse>) => {
  const query = req.query.q;
  if (!query) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'Query parameter q is required');
  }
  const list = await metahubClient.searchMetahub(query);

  const progressMap: Record<string, Progress> = {};
  const readyMap: Record<string, Stream> = {};

  for (const item of list) {
    const { id } = item;
    const isMovie = item.type === 'movie';

    if (isMovie) {
      const prog = progressRepo.getProgress(id);
      if (prog) {
        progressMap[id] = prog;
      }
      const st = streamsRepo.getMovieStream(id);
      if (st) {
        readyMap[id] = {
          id: st.id,
          show_id: st.show_id,
          quality: st.quality,
          size_bytes: st.size_bytes,
          ready_at: st.ready_at
        };
      }
    } else {
      const prog = progressRepo.getSingleShowProgress(id);
      if (prog && prog.episodes) {
        for (const [epId, epProg] of Object.entries(prog.episodes)) {
          progressMap[epId] = epProg;
        }
      }
      const showStreams = streamsRepo.getShowStreams(id);
      if (showStreams) {
        for (const [epId, st] of Object.entries(showStreams)) {
          readyMap[epId] = {
            id: st.id,
            show_id: id,
            quality: st.quality,
            size_bytes: st.size_bytes,
            ready_at: st.ready_at
          };
        }
      }
    }
  }

  res.json({ metadata: list, progress: progressMap, ready: readyMap });
});

// 4. Subtitle preference settings
router.get('/api/media/:id/subtitles/preference', (req: Request<MediaIdParam, Pick<SubtitlePreference, 'subtitle_lang'>>, res: Response<Pick<SubtitlePreference, 'subtitle_lang'>>) => {
  const { id } = req.params;
  const lang = getSubtitlePreference(id);
  res.json({ subtitle_lang: lang });
});

router.post('/api/media/:id/subtitles/preference', (req: Request<MediaIdParam, SuccessResponse, Partial<Pick<SubtitlePreference, 'subtitle_lang'>>>, res: Response<SuccessResponse>) => {
  const { id } = req.params;
  const { subtitle_lang } = req.body;
  saveSubtitlePreference(id, subtitle_lang ?? null);
  res.json({ success: true });
});

// 6. Queue State
router.get('/api/queue', async (_req: Request, res: Response<QueueStateResponse>) => {
  const activeMediaMap = await getAllActiveMedia();
  const transformedMap: Record<string, UserActiveMediaState> = {};
  for (const [key, val] of Object.entries(activeMediaMap)) {
    const transformed = toUserMediaRequestStatus(val.status, val.progress);
    transformedMap[key] = {
      ...val,
      status: transformed.status,
      progress: transformed.progress
    };
  }

  res.json({
    activeMediaRequests: transformedMap
  });
});

// 7. Continue watching carousel lists
router.get('/api/continue-watching', (req: Request<unknown, MediaResponse<(MovieMetadata | ShowMetadata)[]>, unknown, ContinueWatchingQuery>, res: Response<MediaResponse<(MovieMetadata | ShowMetadata)[]>>) => {
  const limit = Number(req.query.limit) || 10;
  const type = req.query.type ?? 'movie';
  const data = progressRepo.getContinueWatching(type, limit);
  res.json(data);
});

// 8. Progress update
router.post('/api/media/:id/progress', (req: Request<MediaIdParam, SuccessResponse, ProgressUpdate>, res: Response<SuccessResponse>) => {
  const fileId = req.params.id;
  const parsed = parseFileId(fileId);
  if (!parsed) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'Invalid media id');
  }

  const { timestamp, runtime } = req.body;
  progressRepo.saveProgress(fileId, { timestamp, runtime });

  res.json({ success: true });
});

// 9. Play resolver URL and subtitles query
router.get('/api/media/:id/stream', (req: Request<MediaIdParam, StreamResponse>, res: Response<StreamResponse>) => {
  const fileId = req.params.id;
  const dirs = getMediaDirs(fileId);
  const playlistPath = dirs ? path.join(dirs.hlsDir, 'index.m3u8') : '';

  if (playlistPath && fs.existsSync(playlistPath) && streamsRepo.isReady(fileId)) {
    logger.info(`Stream start: HLS playlist exists for ${fileId}, playing immediately.`);
    const subtitles = getLocalSubtitles(fileId);
    return res.json({
      success: true,
      url: `/stream/hls/${fileId}/index.m3u8`,
      subtitles
    });
  }

  throw new BadRequestError(ErrorCode.MEDIA_NOT_READY, 'Media not ready. Please request it first.');
});

// 10. Enqueue media request
router.post('/api/media/:id/request', async (req: Request<MediaIdParam, UserMediaRequestResponse>, res: Response<UserMediaRequestResponse>) => {
  const fileId = req.params.id;
  const parsed = parseFileId(fileId);
  if (!parsed) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'Invalid media id');
  }

  const { type, id: mediaId } = parsed;
  const isMovie = type === 'movie';
  const season = isMovie ? undefined : Number(parsed.season);
  const episode = isMovie ? undefined : Number(parsed.episode);
  const dirs = getMediaDirs(fileId);

  // 1. Check if fully ready in SQLite
  if (streamsRepo.isReady(fileId)) {
    return res.json({
      id: fileId,
      status: MEDIA_REQUEST_STATUS.READY,
      progress: '100.00'
    });
  }

  // 2. Check if already active/in-flight in Redis (O(1) lookup across all stages)
  const activeMedia = await getActiveMediaState(fileId);
  if (activeMedia) {
    const transformed = toUserMediaRequestStatus(activeMedia.status, activeMedia.progress);
    return res.json({
      id: fileId,
      status: transformed.status,
      progress: transformed.progress
    });
  }

  // 3. Clean up partial HLS directory if it exists but is neither downloaded nor active
  if (dirs && dirs.baseDir && fs.existsSync(dirs.baseDir)) {
    logger.warn(`Cleaning up partial/incomplete HLS directory for ${fileId}`);
    fs.rmSync(dirs.baseDir, { recursive: true, force: true });
  }

  const topCandidates = await torrentProviderClient.getTopTorrents(
    mediaId,
    type,
    season,
    episode,
    3
  );

  if (!topCandidates || topCandidates.length === 0) {
    throw new NotFoundError(ErrorCode.NO_STREAMS_FOUND, 'No torrent streams found matching criteria.');
  }

  const candidateObjects: ParsedTorrentCandidate[] = topCandidates.map((c) => {
    const size_bytes = Math.round(c.sizeGB * 1024 * 1024 * 1024);
    const magnetUrl = torrentProviderClient.constructMagnetUrl(c.hash, c.title);
    return {
      hash: c.hash,
      magnetUrl,
      quality: c.quality,
      size_bytes,
      fileIdx: c.fileIdx,
      title: c.title,
      peers: c.peers,
      codec: c.codec
    };
  });

  const bestTorrent = candidateObjects[0];
  const size_bytes = bestTorrent.size_bytes;

  // Warm metadata cache if missing
  const cached = metadataRepo.getCachedMetadata(mediaId);
  if (!cached) {
    try {
      logger.info(`Cache miss for metadata of ${mediaId} on download. Pre-fetching details...`);
      const fetched = await cinemetaClient.fetchMetadataDetails(mediaId, type);
      if (fetched && fetched.id && Object.keys(fetched).length > 0) {
        const status = ('status' in fetched && fetched.status) ? fetched.status : (isMovie ? 'movie' : 'Continuing');
        metadataRepo.saveCachedMetadata(fetched.id, type, fetched, status);
      }
    } catch (err) {
      logger.error(`Failed to pre-fetch metadata for ${mediaId} on download`, err);
    }
  }

  // Initialize watch progress if missing
  const current = progressRepo.getProgress(fileId);
  if (!current || !current.last_updated) {
    progressRepo.saveProgress(fileId, { timestamp: 0, runtime: 0 });
  }

  // Add job to downloadQueue in BullMQ (jobId: fileId provides atomic O(1) deduplication in Redis)
  await downloadQueue.add(
    'download',
    {
      fileId,
      candidates: candidateObjects,
      magnetUrl: bestTorrent.magnetUrl,
      hash: bestTorrent.hash,
      type,
      fileIdx: bestTorrent.fileIdx,
      quality: bestTorrent.quality,
      size_bytes,
      accumulatedDeadDuration: 0,
      wasStalled: false,
      failedCandidates: []
    },
    {
      jobId: fileId,
      priority: DOWNLOAD_PRIORITIES.NORMAL
    }
  );

  // Publish initial 'queued' status via Redis Pub/Sub
  await publishMediaRequestStatus(fileId, MEDIA_REQUEST_STATUS.QUEUED, '0.00');

  res.status(202).json({
    id: fileId,
    status: MEDIA_REQUEST_STATUS.QUEUED,
    progress: '0.00'
  });
});

export default router;
