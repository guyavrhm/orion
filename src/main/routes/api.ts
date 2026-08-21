import express, { type Request, type Response, type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { metadataRepo } from '../db/metadata.js';
import { progressRepo } from '../db/progress.js';
import { downloadsRepo } from '../db/downloads.js';
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
  transcodeQueue,
  subtitleQueue,
  finalizeQueue,
  publishDownloadStatus,
  getActiveMediaState,
  getAllActiveMedia,
  deleteActiveMediaState
} from '../queues/index.js';
import { DOWNLOAD_STATUS, ErrorCode } from '../types/index.js';
import { getFileId, getMediaDirs } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import type {
  MovieMetadata,
  ShowMetadata,
  MovieProgress,
  ShowProgress,
  DownloadEntry,
  MovieDownloadRow,
  LocalSubtitleTrack,
  QueueStateResponse,
  ContinueWatchingResult,
  DownloadStatus,
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
  type?: string;
}

export interface MediaIdParam {
  id: string;
}

export interface SubtitlePrefParam {
  mediaId: string;
}

export interface SubtitlePrefBody {
  subtitle_lang?: string | null;
}

export interface SaveTimestampBody {
  movieId?: string;
  showId?: string;
  season?: number;
  episode?: number;
  timestamp?: number;
  metadata?: {
    runtime?: string | number;
    season?: number;
    episode?: number;
  };
}

export interface StreamRequestBody {
  movieId?: string;
  showId?: string;
  season?: number;
  episode?: number;
}

export interface DownloadRequestBody {
  movieId?: string;
  showId?: string;
  season?: number;
  episode?: number;
  metadata?: {
    season?: number;
    episode?: number;
    runtime?: string | number;
    title?: string;
    name?: string;
    [key: string]: unknown;
  };
}

export interface CatalogMoviesResponse {
  metadata: MovieMetadata[];
  progress: Record<string, MovieProgress>;
  downloads: Record<string, DownloadEntry | (MovieDownloadRow & { is_downloaded: boolean })>;
}

export interface CatalogShowsResponse {
  metadata: ShowMetadata[];
  progress: Record<string, ShowProgress>;
  downloads: Record<string, DownloadEntry>;
}

export interface MovieDetailResponse {
  metadata: MovieMetadata | null;
  progress: Record<string, MovieProgress>;
  downloads: Record<string, DownloadEntry | (MovieDownloadRow & { is_downloaded: boolean })>;
}

export interface ShowDetailResponse {
  metadata: ShowMetadata | null;
  progress: Record<string, ShowProgress>;
  downloads: Record<string, DownloadEntry>;
}

export interface SearchResponse {
  metadata: (MovieMetadata | ShowMetadata)[];
  progress: Record<string, MovieProgress | ShowProgress>;
  downloads: Record<string, DownloadEntry | (MovieDownloadRow & { is_downloaded: boolean })>;
}

export interface SubtitlesResponse {
  subtitles: LocalSubtitleTrack[];
}

export interface SubtitlePreferenceResponse {
  subtitle_lang: string | null;
}

export interface SuccessResponse {
  success: boolean;
}

export interface StreamResponse {
  success: boolean;
  url: string;
}

export interface DownloadResponse {
  id: string;
  status: DownloadStatus | string;
  progress: string | number;
}

export interface DeleteDownloadResponse {
  id: string;
  status: DownloadStatus | string;
}

// 1. Browsing catalogs
router.get('/api/movies', async (req: Request<unknown, CatalogMoviesResponse, unknown, CatalogQuery>, res: Response<CatalogMoviesResponse>) => {
  const limit = parseInt(req.query.limit || '', 10) || 11;
  const list = await cinemetaClient.fetchPopularMovies();
  const sliced = list.slice(0, limit);

  const progressMap: Record<string, MovieProgress> = {};
  const downloadsMap: Record<string, DownloadEntry | (MovieDownloadRow & { is_downloaded: boolean })> = {};

  const metadata: MovieMetadata[] = sliced.map((item) => {
    const id = item.imdb_id || item.id;

    // Populate watch progress
    const prog = progressRepo.getSingleMovieProgress(id);
    if (prog) {
      progressMap[id] = prog;
    }

    // Populate download status
    if (downloadsRepo.isDownloaded(id)) {
      const dl = downloadsRepo.getMovieDownloadSingle(id);
      downloadsMap[id] = dl
        ? { id, is_downloaded: true, ...dl }
        : {
            id,
            is_downloaded: true,
            movie_id: id,
            fileName: null,
            torrentHash: null,
            fileHash: null,
            fileIdx: null,
            quality: null,
            sizeBytes: null,
            downloadTime: null
          };
    }

    return {
      ...(item as unknown as MovieMetadata),
      id,
      type: 'movie',
      genres: item.genres || item.genre || []
    };
  });

  res.json({ metadata, progress: progressMap, downloads: downloadsMap });
});

router.get('/api/shows', async (req: Request<unknown, CatalogShowsResponse, unknown, CatalogQuery>, res: Response<CatalogShowsResponse>) => {
  const limit = parseInt(req.query.limit || '', 10) || 11;
  const list = await cinemetaClient.fetchPopularShows();
  const sliced = list.slice(0, limit);

  const progressMap: Record<string, ShowProgress> = {};
  const downloadsMap: Record<string, DownloadEntry> = {};

  const metadata: ShowMetadata[] = sliced.map((item) => {
    const id = item.imdb_id || item.id;

    // Populate watch progress
    const prog = progressRepo.getSingleShowProgress(id);
    if (prog && Object.keys(prog.episodes || {}).length > 0) {
      progressMap[id] = prog;
    }

    // Populate download status
    const showDls = downloadsRepo.getShowDownloads(id);
    if (Object.keys(showDls).length > 0) {
      Object.assign(downloadsMap, showDls);
    }

    return {
      ...(item as unknown as ShowMetadata),
      id,
      type: 'series',
      genres: item.genres || item.genre || [],
      videos: item.videos || []
    };
  });

  res.json({ metadata, progress: progressMap, downloads: downloadsMap });
});

// 2. Details
router.get('/api/movies/:id', async (req: Request<MediaIdParam, MovieDetailResponse>, res: Response<MovieDetailResponse>) => {
  const id = req.params.id;
  const cached = metadataRepo.getCachedMetadata(id);
  const singleProg = progressRepo.getSingleMovieProgress(id) || { id, timestamp: 0, runtime: 0 };
  const progress = { [id]: singleProg };
  const dl = downloadsRepo.getMovieDownloadSingle(id);
  const downloads: Record<string, DownloadEntry | (MovieDownloadRow & { is_downloaded: boolean })> = dl
    ? { [id]: { id, is_downloaded: true, ...dl } }
    : {};

  if (cached) {
    const isFull = !!cached.metadata?.runtime || Array.isArray(cached.metadata?.cast);
    if (isFull) {
      logger.debug(`Detail movie Cache HIT: ${id}`);
      return res.json({ metadata: cached.metadata as MovieMetadata, progress, downloads });
    }
    logger.debug(`Detail movie Cache exists but partial for ${id}. Re-fetching.`);
  }

  const normalized = await cinemetaClient.fetchMetadataDetails(id, 'movie');
  if (normalized && normalized.id && Object.keys(normalized).length > 0) {
    const status = normalized.status || 'movie';
    metadataRepo.saveCachedMetadata(normalized.id, 'movie', normalized, status);
  }
  res.json({ metadata: normalized as unknown as MovieMetadata, progress, downloads });
});

router.get('/api/shows/:id', async (req: Request<MediaIdParam, ShowDetailResponse>, res: Response<ShowDetailResponse>) => {
  const id = req.params.id;
  const cached = metadataRepo.getCachedMetadata(id);
  const singleProg = progressRepo.getSingleShowProgress(id);
  const progress = { [id]: singleProg };
  const downloads = downloadsRepo.getShowDownloads(id);

  if (cached) {
    const showMeta = cached.metadata as ShowMetadata | null;
    const isFull = Array.isArray(showMeta?.videos) && showMeta.videos.length > 0;
    const isContinuing = cached.status === 'Continuing';
    const isExpired = isContinuing && cached.last_fetched && (Date.now() - cached.last_fetched > 24 * 60 * 60 * 1000);
    if (isFull && !isExpired && showMeta) {
      logger.debug(`Detail series Cache HIT (valid): ${id}`);

      // Hydrate show videos with local download status
      const videosWithDlStatus = (showMeta.videos || []).map((ep) => {
        const epNum = ep.episode || ep.number;
        const fileId = `${id}_s${ep.season}_e${epNum}`;
        return {
          ...ep,
          is_downloaded: downloadsRepo.isDownloaded(fileId)
        };
      });
      showMeta.videos = videosWithDlStatus;

      return res.json({ metadata: showMeta, progress, downloads });
    }
    if (!isFull) {
      logger.debug(`Detail series Cache partial: ${id}. Re-fetching.`);
    } else {
      logger.debug(`Detail series Cache expired (TTL): ${id}. Re-fetching.`);
    }
  }

  const normalized = await cinemetaClient.fetchMetadataDetails(id, 'series');
  if (normalized && normalized.id && Object.keys(normalized).length > 0) {
    const status = normalized.status || 'Continuing';
    metadataRepo.saveCachedMetadata(normalized.id, 'series', normalized, status);
  }

  // Hydrate show videos with local download status
  const videosWithDlStatus = (normalized.videos || []).map((ep) => {
    const epNum = ep.episode || ep.number;
    const fileId = `${id}_s${ep.season}_e${epNum}`;
    return {
      ...ep,
      is_downloaded: downloadsRepo.isDownloaded(fileId)
    };
  });
  normalized.videos = videosWithDlStatus;

  res.json({ metadata: normalized as unknown as ShowMetadata, progress, downloads });
});

// 3. Search
router.get('/api/search', async (req: Request<unknown, SearchResponse, unknown, SearchQuery>, res: Response<SearchResponse>) => {
  const query = req.query.q;
  if (!query) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'Query parameter q is required');
  }
  const list = await metahubClient.searchMetahub(query);

  const progressMap: Record<string, MovieProgress | ShowProgress> = {};
  const downloadsMap: Record<string, DownloadEntry | (MovieDownloadRow & { is_downloaded: boolean })> = {};

  const metadata: (MovieMetadata | ShowMetadata)[] = list.map((item) => {
    const id = item.imdb_id || item.id;
    const isMovie = item.type === 'movie';

    const prog = isMovie ? progressRepo.getSingleMovieProgress(id) : progressRepo.getSingleShowProgress(id);
    if (prog && (isMovie || Object.keys((prog as ShowProgress).episodes || {}).length > 0)) {
      progressMap[id] = prog;
    }

    if (isMovie) {
      if (downloadsRepo.isDownloaded(id)) {
        const dl = downloadsRepo.getMovieDownloadSingle(id);
        downloadsMap[id] = dl
          ? { id, is_downloaded: true, ...dl }
          : {
              id,
              is_downloaded: true,
              movie_id: id,
              fileName: null,
              torrentHash: null,
              fileHash: null,
              fileIdx: null,
              quality: null,
              sizeBytes: null,
              downloadTime: null
            };
      }
    } else {
      const showDls = downloadsRepo.getShowDownloads(id);
      if (Object.keys(showDls).length > 0) {
        Object.assign(downloadsMap, showDls);
      }
    }

    return {
      ...(item as unknown as (MovieMetadata | ShowMetadata)),
      id,
      genres: item.genres || item.genre || []
    };
  });

  res.json({ metadata, progress: progressMap, downloads: downloadsMap });
});

// 4. Subtitles list
router.get('/api/media/:id/subtitles', (req: Request<MediaIdParam, SubtitlesResponse>, res: Response<SubtitlesResponse>) => {
  const fileId = getFileId(req.params.id);
  const subtitles = getLocalSubtitles(fileId);
  res.json({ subtitles });
});

// 5. Subtitle preference settings
router.get('/api/preferences/subtitles/:mediaId', (req: Request<SubtitlePrefParam, SubtitlePreferenceResponse>, res: Response<SubtitlePreferenceResponse>) => {
  const { mediaId } = req.params;
  const lang = getSubtitlePreference(mediaId);
  res.json({ subtitle_lang: lang });
});

router.post('/api/preferences/subtitles/:mediaId', (req: Request<SubtitlePrefParam, SuccessResponse, SubtitlePrefBody>, res: Response<SuccessResponse>) => {
  const { mediaId } = req.params;
  const { subtitle_lang } = req.body;
  saveSubtitlePreference(mediaId, subtitle_lang ?? null);
  res.json({ success: true });
});

// 6. Queue State
router.get('/api/queue-state', async (_req: Request, res: Response<QueueStateResponse>) => {
  const activeMediaMap = await getAllActiveMedia();
  const activeList = Object.values(activeMediaMap);
  const active = activeList.find((item) => item.status === 'downloading' || item.status === 'processing') || activeList[0] || null;
  const queue = activeList.filter((item) => item.status === 'queued');

  res.json({
    activeDownloads: activeMediaMap,
    active,
    current: active,
    queue
  });
});

// 7. Continue watching carousel lists
router.get('/api/continue-watching', (req: Request<unknown, ContinueWatchingResult, unknown, ContinueWatchingQuery>, res: Response<ContinueWatchingResult>) => {
  const limit = parseInt(req.query.limit || '', 10) || 10;
  const type = req.query.type || 'movie';
  res.json(progressRepo.getContinueWatching(type, limit));
});

// 8. Progress reports update
router.post('/api/save-timestamp', (req: Request<unknown, SuccessResponse, SaveTimestampBody>, res: Response<SuccessResponse>) => {
  const { movieId, showId, season, episode, timestamp, metadata } = req.body;
  if (!movieId && !showId) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'movieId or showId is required');
  }
  if (showId && (season === undefined || episode === undefined)) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'season and episode are required for show progress');
  }

  if (movieId) {
    const runtime = metadata?.runtime ? parseInt(String(metadata.runtime), 10) : undefined;
    progressRepo.saveMovieProgress(movieId, { timestamp, runtime });
  } else if (showId && season !== undefined && episode !== undefined) {
    const episodeId = `${showId}_s${season}_e${episode}`;
    const currentShowData = progressRepo.getSingleShowProgress(showId);
    const episodes = { ...currentShowData.episodes };

    const epRuntime = metadata?.runtime ? parseInt(String(metadata.runtime), 10) : undefined;
    episodes[episodeId] = {
      ...(episodes[episodeId] || {}),
      id: episodeId,
      show_id: showId,
      timestamp: timestamp || 0,
      season,
      episode,
      runtime: epRuntime !== undefined ? epRuntime : (episodes[episodeId] ? episodes[episodeId].runtime : 0)
    };

    progressRepo.saveShowProgress(showId, {
      timestamp: timestamp || 0,
      last_season: season,
      last_episode: episode,
      episodes
    });
  }
  res.json({ success: true });
});

// 9. Play resolver URL query
router.post('/api/stream', (req: Request<unknown, StreamResponse, StreamRequestBody>, res: Response<StreamResponse>) => {
  const { movieId, showId, season, episode } = req.body;
  const type = movieId ? 'movie' : 'series';

  const fileId = type === 'series' ? `${showId}_s${season}_e${episode}` : (movieId || '');
  const dirs = getMediaDirs(fileId);
  const playlistPath = dirs ? path.join(dirs.hlsDir, 'index.m3u8') : '';

  if (playlistPath && fs.existsSync(playlistPath) && downloadsRepo.isDownloaded(fileId)) {
    logger.info(`Stream start: HLS playlist exists for ${fileId}, playing immediately.`);
    return res.json({
      success: true,
      url: `/stream/hls/${fileId}/index.m3u8`
    });
  }

  throw new BadRequestError(ErrorCode.MEDIA_NOT_DOWNLOADED, 'Media not downloaded. Please download it first.');
});

// 10. Enqueue download request
router.post('/api/download', async (req: Request<unknown, DownloadResponse, DownloadRequestBody>, res: Response<DownloadResponse>) => {
  const { movieId, showId, season: reqSeason, episode: reqEpisode, metadata } = req.body;
  const id = movieId || showId;
  if (!id) {
    throw new BadRequestError(ErrorCode.BAD_REQUEST, 'movieId or showId is required');
  }

  const type = movieId ? 'movie' : 'series';
  const season = reqSeason !== undefined ? reqSeason : (metadata ? metadata.season : undefined);
  const episode = reqEpisode !== undefined ? reqEpisode : (metadata ? metadata.episode : undefined);

  const fileId = type === 'series' ? `${showId}_s${season}_e${episode}` : (movieId || id);
  const dirs = getMediaDirs(fileId);

  // 1. Check if fully downloaded in SQLite
  if (downloadsRepo.isDownloaded(fileId)) {
    return res.json({
      id: fileId,
      status: DOWNLOAD_STATUS.COMPLETED,
      progress: '100.00'
    });
  }

  // 2. Check if already active/in-flight in Redis (O(1) lookup across all stages)
  const activeMedia = await getActiveMediaState(fileId);
  if (activeMedia) {
    return res.json({
      id: fileId,
      status: activeMedia.status,
      progress: activeMedia.progress || '0.00'
    });
  }

  // 3. Clean up partial HLS directory if it exists but is neither downloaded nor active
  if (dirs && dirs.baseDir && fs.existsSync(dirs.baseDir)) {
    logger.warn(`Cleaning up partial/incomplete HLS directory for ${fileId}`);
    fs.rmSync(dirs.baseDir, { recursive: true, force: true });
  }

  const topCandidates = await torrentProviderClient.getTopTorrents(
    id,
    type,
    season,
    episode,
    3,
    metadata?.title || metadata?.name
  );

  if (!topCandidates || topCandidates.length === 0) {
    throw new NotFoundError(ErrorCode.NO_STREAMS_FOUND, 'No torrent streams found matching criteria.');
  }

  const candidateObjects: ParsedTorrentCandidate[] = topCandidates.map((c) => {
    const sizeBytes = Math.round(c.sizeGB * 1024 * 1024 * 1024);
    const magnetUrl = torrentProviderClient.constructMagnetUrl(c.hash, c.title);
    return {
      hash: c.hash,
      magnetUrl,
      quality: c.quality,
      sizeBytes,
      fileIdx: c.fileIdx,
      title: c.title,
      peers: c.peers,
      codec: c.codec
    };
  });

  const bestTorrent = candidateObjects[0];
  const sizeBytes = bestTorrent.sizeBytes;

  // Warm metadata cache if missing
  const cached = metadataRepo.getCachedMetadata(id);
  if (!cached) {
    try {
      logger.info(`Cache miss for metadata of ${id} on download. Pre-fetching details...`);
      const fetched = await cinemetaClient.fetchMetadataDetails(id, type);
      if (fetched && fetched.id && Object.keys(fetched).length > 0) {
        const status = fetched.status || (type === 'movie' ? 'movie' : 'Continuing');
        metadataRepo.saveCachedMetadata(fetched.id, type, fetched, status);
      }
    } catch (err) {
      logger.error(`Failed to pre-fetch metadata for ${id} on download`, err);
    }
  }

  // Initialize watch progress if missing
  if (movieId) {
    const current = progressRepo.getSingleMovieProgress(movieId);
    if (!current || !current.last_updated) {
      const runtime = req.body.metadata?.runtime ? parseInt(String(req.body.metadata.runtime), 10) : undefined;
      progressRepo.saveMovieProgress(movieId, { timestamp: 0, runtime });
    }
  } else if (showId && season !== undefined && episode !== undefined) {
    const current = progressRepo.getSingleShowProgress(showId);
    if (!current || !current.last_updated) {
      const episodeId = `${showId}_s${season}_e${episode}`;
      progressRepo.saveShowProgress(showId, {
        last_season: season,
        last_episode: episode,
        episodes: {
          [episodeId]: { id: episodeId, show_id: showId, season, episode, timestamp: 0, runtime: 0 }
        }
      });
    }
  }

  // Add job to downloadQueue in BullMQ (jobId: fileId provides atomic O(1) deduplication in Redis)
  const job = await downloadQueue.add(
    'download',
    {
      fileId,
      candidates: candidateObjects,
      magnetUrl: bestTorrent.magnetUrl,
      hash: bestTorrent.hash,
      type: movieId ? 'movie' : 'series',
      fileIdx: bestTorrent.fileIdx,
      quality: bestTorrent.quality,
      sizeBytes
    },
    {
      jobId: fileId,
      priority: 1
    }
  );

  // Publish initial 'queued' status via Redis Pub/Sub
  await publishDownloadStatus(fileId, DOWNLOAD_STATUS.QUEUED, '0.00');

  res.status(202).json({
    id: fileId,
    status: DOWNLOAD_STATUS.QUEUED,
    progress: '0.00'
  });
});

// 11. Delete / cancel download
router.delete('/api/download/:id', async (req: Request<MediaIdParam, DeleteDownloadResponse>, res: Response<DeleteDownloadResponse>) => {
  const { id } = req.params;
  const fileId = getFileId(id);

  // 1. Remove/cancel any active or queued jobs in BullMQ queues
  const [dlJob, tcJob, subJob, finJob] = await Promise.all([
    downloadQueue.getJob(fileId),
    transcodeQueue.getJob(fileId),
    subtitleQueue.getJob(fileId),
    finalizeQueue.getJob(fileId)
  ]);

  if (dlJob) {
    try { await dlJob.remove(); } catch (err) { logger.debug(`Could not remove download job for ${fileId}: ${err}`); }
  }
  if (tcJob) {
    try { await tcJob.remove(); } catch (err) { logger.debug(`Could not remove transcode job for ${fileId}: ${err}`); }
  }
  if (subJob) {
    try { await subJob.remove(); } catch (err) { logger.debug(`Could not remove subtitle job for ${fileId}: ${err}`); }
  }
  if (finJob) {
    try { await finJob.remove(); } catch (err) { logger.debug(`Could not remove finalize job for ${fileId}: ${err}`); }
  }

  // 2. Remove in-flight active media state from Redis and broadcast REMOVED event
  await deleteActiveMediaState(fileId);
  await publishDownloadStatus(fileId, DOWNLOAD_STATUS.REMOVED, '0.00');

  // 3. Remove from SQLite database registry
  downloadsRepo.removeDownloadEntry(fileId);

  // 4. Remove physical HLS directory and files
  const dirs = getMediaDirs(fileId);
  if (dirs && dirs.baseDir && fs.existsSync(dirs.baseDir)) {
    try {
      fs.rmSync(dirs.baseDir, { recursive: true, force: true });
      logger.info(`Removed media directory for ${fileId} at ${dirs.baseDir}`);
    } catch (err) {
      logger.error(`Failed to remove media directory for ${fileId}:`, err);
    }
  }

  res.json({
    id: fileId,
    status: DOWNLOAD_STATUS.REMOVED
  });
});

export default router;
