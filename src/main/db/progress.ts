import { db } from './index.js';
import { downloadsRepo } from './downloads.js';
import { rebuildMovieMetadata, rebuildShowMetadata, metadataRepo } from './metadata.js';
import { logger } from '../utils/logger.js';
import type {
  MovieMetadataRow,
  ShowMetadataRow,
  EpisodeMetadataRow,
  MovieProgressRow,
  EpisodeProgressRow,
  MovieProgress,
  ShowProgress,
  EpisodeProgressItem,
  EpisodeProgress,
  MovieProgressUpdate,
  ShowProgressUpdate,
  ContinueWatchingResult,
  MovieMetadata,
  ShowMetadata
} from '../types/index.js';

// Pre-compiled prepared statements for progress
const getMovieProgressStmt = db.prepare(`
  SELECT p.movie_id as id, p.timestamp, p.runtime as progress_runtime, p.last_updated,
         m.title, m.year, m.released, m.genres, m.poster, m.background, m.logo, m.imdb_rating, m.runtime,
         m.description, m.awards, m.cast, m.director, m.writer, m.country, m.dvdRelease, m.moviedb_id, m.popularity
  FROM movie_progress p
  JOIN movie_metadata m ON p.movie_id = m.id
`);

const getSingleMovieProgressStmt = db.prepare(`
  SELECT movie_id as id, timestamp, runtime, last_updated
  FROM movie_progress
  WHERE movie_id = ?
`);

const getMovieProgressSingleStmt = db.prepare('SELECT timestamp, runtime FROM movie_progress WHERE movie_id = ?');

const saveMovieProgressStmt = db.prepare(`
  INSERT INTO movie_progress (movie_id, timestamp, runtime, last_updated)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(movie_id) DO UPDATE SET
    timestamp = excluded.timestamp,
    runtime = excluded.runtime,
    last_updated = excluded.last_updated
`);

const getLatestWatchedEpisodeStmt = db.prepare(`
  SELECT e.season, e.episode, p.last_updated
  FROM episode_progress p
  JOIN episode_metadata e ON p.episode_id = e.id
  WHERE e.show_id = ?
  ORDER BY p.last_updated DESC
  LIMIT 1
`);

const getProgressEpisodesForShowStmt = db.prepare(`
  SELECT e.season, e.episode, p.timestamp, p.runtime
  FROM episode_progress p
  JOIN episode_metadata e ON p.episode_id = e.id
  WHERE e.show_id = ?
`);

const getContinueWatchingMoviesStmt = db.prepare(`
  SELECT p.movie_id as id, p.timestamp, p.runtime as progress_runtime, p.last_updated,
         m.title, m.year, m.genres, m.poster, m.background, m.logo, m.imdb_rating, m.runtime,
         m.description, m.awards, m.cast, m.director, m.writer, m.country, m.dvdRelease, m.moviedb_id, m.popularity
  FROM movie_progress p
  JOIN movie_metadata m ON p.movie_id = m.id
  ORDER BY p.last_updated DESC
  LIMIT ?
`);

const getContinueWatchingShowsStmt = db.prepare(`
  SELECT e.show_id as id, e.season as last_season, e.episode as last_episode, MAX(p.last_updated) as last_updated, p.timestamp, p.runtime,
         s.title, s.year, s.genres, s.poster, s.background, s.logo, s.imdb_rating, s.runtime as show_runtime,
         s.description, s.awards, s.cast, s.director, s.writer, s.country, s.status, s.tvdb_id, s.moviedb_id, s.popularity
  FROM episode_progress p
  JOIN episode_metadata e ON p.episode_id = e.id
  JOIN show_metadata s ON e.show_id = s.id
  GROUP BY e.show_id
  ORDER BY last_updated DESC
  LIMIT ?
`);

export class ProgressRepo {
  /**
   * Returns progress details for all watched movies.
   */
  getMovieProgress(): Record<string, MovieProgress> {
    try {
      const rows = getMovieProgressStmt.all() as unknown as (MovieMetadataRow & { progress_runtime: number; timestamp: number; last_updated: number })[];
      const progress: Record<string, MovieProgress> = {};
      for (const row of rows) {
        const metadata = rebuildMovieMetadata(row);
        progress[row.id] = {
          ...metadata,
          id: row.id,
          timestamp: row.timestamp,
          runtime: typeof row.progress_runtime === 'number' ? row.progress_runtime : (row.progress_runtime ? parseInt(String(row.progress_runtime), 10) : 0),
          last_updated: row.last_updated
        };
      }
      return progress;
    } catch (e) {
      logger.error('Error fetching movie progress list', e);
      return {};
    }
  }

  /**
   * Returns progress details for all watched shows.
   */
  getShowProgress(): Record<string, ShowProgress> {
    try {
      const activeShows = db.prepare(`
        SELECT DISTINCT s.id
        FROM episode_progress p
        JOIN episode_metadata e ON p.episode_id = e.id
        JOIN show_metadata s ON e.show_id = s.id
      `).all() as unknown as { id: string }[];

      if (activeShows.length === 0) return {};

      const showIds = activeShows.map(s => s.id);
      const placeHolders = showIds.map(() => '?').join(',');

      // Batch get all progress for these shows
      const progressRows = db.prepare(`
        SELECT e.show_id, e.season, e.episode, p.timestamp, p.runtime, p.last_updated
        FROM episode_progress p
        JOIN episode_metadata e ON p.episode_id = e.id
        WHERE e.show_id IN (${placeHolders})
      `).all(...showIds) as unknown as { show_id: string; season: number; episode: number; timestamp: number; runtime: number; last_updated: number }[];

      // Group progress by show_id
      const progressByShow: Record<string, typeof progressRows> = {};
      for (const row of progressRows) {
        if (!progressByShow[row.show_id]) progressByShow[row.show_id] = [];
        progressByShow[row.show_id].push(row);
      }

      const progress: Record<string, ShowProgress> = {};
      for (const showId of showIds) {
        const showProgressList = progressByShow[showId] || [];
        if (showProgressList.length === 0) continue;

        // Find the latest watched episode
        let latestEp = showProgressList[0];
        for (const ep of showProgressList) {
          if (ep.last_updated > latestEp.last_updated) {
            latestEp = ep;
          }
        }

        const episodes: Record<string, EpisodeProgress> = {};
        for (const ep of showProgressList) {
          const epId = `${showId}_s${ep.season}_e${ep.episode}`;
          episodes[epId] = {
            id: epId,
            show_id: showId,
            season: ep.season,
            episode: ep.episode,
            timestamp: ep.timestamp,
            runtime: ep.runtime,
            last_updated: ep.last_updated
          };
        }

        progress[showId] = {
          id: showId,
          last_season: latestEp.season,
          last_episode: latestEp.episode,
          last_updated: latestEp.last_updated,
          episodes
        };
      }
      return progress;
    } catch (e) {
      logger.error('Error fetching series progress list', e);
      return {};
    }
  }

  /**
   * Retrieves single movie progress.
   */
  getSingleMovieProgress(movieId: string): MovieProgress | null {
    try {
      const row = getSingleMovieProgressStmt.get(movieId) as MovieProgressRow | undefined;
      if (!row) return null;
      return {
        id: row.movie_id || movieId,
        timestamp: row.timestamp,
        runtime: row.runtime,
        last_updated: row.last_updated
      };
    } catch (e) {
      logger.error(`Error fetching single movie progress for ${movieId}`, e);
      return null;
    }
  }

  /**
   * Retrieves single show progress.
   */
  getSingleShowProgress(showId: string): ShowProgress {
    try {
      const latestEp = getLatestWatchedEpisodeStmt.get(showId) as { season: number; episode: number; last_updated: number } | undefined;
      const epRows = getProgressEpisodesForShowStmt.all(showId) as unknown as { season: number; episode: number; timestamp: number; runtime: number }[];
      const episodes: Record<string, EpisodeProgress> = {};
      for (const ep of epRows) {
        const epId = `${showId}_s${ep.season}_e${ep.episode}`;
        episodes[epId] = {
          id: epId,
          show_id: showId,
          season: ep.season,
          episode: ep.episode,
          timestamp: ep.timestamp,
          runtime: ep.runtime
        };
      }

      let last_season = 1;
      let last_episode = 1;
      let last_updated: number | null = null;
      if (latestEp) {
        last_season = latestEp.season;
        last_episode = latestEp.episode;
        last_updated = latestEp.last_updated;
      }

      return {
        id: showId,
        last_season,
        last_episode,
        last_updated,
        episodes
      };
    } catch (e) {
      logger.error(`Error fetching single show progress for ${showId}`, e);
      return { id: showId, last_season: 1, last_episode: 1, last_updated: null, episodes: {} };
    }
  }

  /**
   * Saves progress for a movie, initializing raw metadata dummy row if not exists.
   */
  saveMovieProgress(movieId: string, update: MovieProgressUpdate): void {
    if (!movieId) return;
    try {
      const current = getMovieProgressSingleStmt.get(movieId) as Pick<MovieProgressRow, 'timestamp' | 'runtime'> | undefined;
      const timestamp = update.timestamp !== undefined ? update.timestamp : (current ? current.timestamp : 0);
      const runtime = update.runtime !== undefined ? update.runtime : (current ? current.runtime : 0);
      
      db.prepare(`
        INSERT OR IGNORE INTO movie_metadata (id, title, year, genres, last_fetched)
        VALUES (?, 'Unknown Movie', '', '', ?)
      `).run(movieId, Date.now());

      saveMovieProgressStmt.run(movieId, timestamp, runtime, Date.now());
      logger.debug(`Saved movie watch progress: ${movieId} at timestamp ${timestamp}`);
    } catch (e) {
      logger.error(`Failed to save movie progress for ${movieId}`, e);
    }
  }

  /**
   * Saves progress for a show and inserts corresponding dummy metadata rows first.
   */
  saveShowProgress(showId: string, update: ShowProgressUpdate): void {
    if (!showId) return;
    try {
      db.exec('BEGIN TRANSACTION');
      if (update.episodes) {
        const insertEp = db.prepare(`
          INSERT INTO episode_progress (episode_id, timestamp, runtime, last_updated)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(episode_id) DO UPDATE SET
            timestamp = excluded.timestamp,
            runtime = excluded.runtime,
            last_updated = excluded.last_updated
        `);
        const getEpLastUpdatedStmt = db.prepare('SELECT last_updated FROM episode_progress WHERE episode_id = ?');
        for (const [, ep] of Object.entries(update.episodes)) {
          const season = ep.season || update.last_season || 1;
          const episode = ep.episode || update.last_episode || 1;
          const epId = `${showId}_s${season}_e${episode}`;
          
          db.prepare(`
            INSERT OR IGNORE INTO show_metadata (id, title, year, genres, last_fetched)
            VALUES (?, 'Unknown Show', '', '', ?)
          `).run(showId, Date.now());

          db.prepare(`
            INSERT OR IGNORE INTO episode_metadata (id, show_id, season, episode, name)
            VALUES (?, ?, ?, ?, ?)
          `).run(epId, showId, season, episode, `Episode ${episode}`);

          const isActive = (season === update.last_season && episode === update.last_episode);
          let epLastUpdated = Date.now();
          if (!isActive) {
            const existing = getEpLastUpdatedStmt.get(epId) as { last_updated: number } | undefined;
            if (existing && existing.last_updated) {
              epLastUpdated = existing.last_updated;
            }
          }

          insertEp.run(
            epId,
            ep.timestamp || 0,
            ep.runtime || 0,
            epLastUpdated
          );
        }
      }
      db.exec('COMMIT');
      logger.debug(`Saved show watch progress for: ${showId}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      logger.error(`Failed to save show progress for ${showId}`, e);
    }
  }

  /**
   * Gathers normalized Continue Watching metadata, progress, and download lists.
   */
  getContinueWatching(type: 'movie' | 'series' | string, limit = 10): ContinueWatchingResult {
    try {
      const metadata: (MovieMetadata | ShowMetadata)[] = [];
      const progress: Record<string, MovieProgress | EpisodeProgress> = {};
      const downloads: ContinueWatchingResult['downloads'] = {};

      if (type === 'movie') {
        const rows = getContinueWatchingMoviesStmt.all(limit) as unknown as (MovieMetadataRow & { progress_runtime: number; timestamp: number; last_updated: number })[];

        for (const row of rows) {
          const meta = rebuildMovieMetadata(row);
          if (meta) {
            metadata.push(meta);
          }

          progress[row.id] = {
            id: row.id,
            timestamp: row.timestamp || 0,
            runtime: row.progress_runtime || 0,
            last_updated: row.last_updated
          };

          if (downloadsRepo.isDownloaded(row.id)) {
            const dl = downloadsRepo.getMovieDownloadSingle(row.id);
            downloads[row.id] = dl 
              ? { id: row.id, is_downloaded: true, ...dl, sizeBytes: dl.sizeBytes ?? 0 }
              : { id: row.id, is_downloaded: true, sizeBytes: 0, fileName: null, torrentHash: null, fileHash: null, fileIdx: null, quality: null };
          }
        }
      } else {
        const rows = getContinueWatchingShowsStmt.all(limit) as unknown as (ShowMetadataRow & { last_season: number; last_episode: number; last_updated: number; timestamp: number; runtime: number })[];

        for (const row of rows) {
          const episodeId = `${row.id}_s${row.last_season}_e${row.last_episode}`;
          
          const epMeta = metadataRepo.getEpisodeMetadataSingle(row.id, row.last_season, row.last_episode);
          const showMeta = rebuildShowMetadata(row, epMeta ? [epMeta] : []);
          if (showMeta) {
            metadata.push(showMeta);
          }

          progress[episodeId] = {
            id: episodeId,
            show_id: row.id,
            season: row.last_season,
            episode: row.last_episode,
            timestamp: row.timestamp || 0,
            runtime: row.runtime || 0,
            last_updated: row.last_updated
          };

          if (downloadsRepo.isDownloaded(episodeId)) {
            const dl = downloadsRepo.getEpisodeDownloadSingle(episodeId);
            downloads[episodeId] = dl 
              ? { id: episodeId, is_downloaded: true, ...dl, sizeBytes: dl.sizeBytes ?? 0 }
              : { id: episodeId, is_downloaded: true, sizeBytes: 0, fileName: null, torrentHash: null, fileHash: null, fileIdx: null, quality: null };
          }
        }
      }
      return { metadata, progress, downloads };
    } catch (e) {
      logger.error('Error fetching Continue Watching catalog lists', e);
      return { metadata: [], progress: {}, downloads: {} };
    }
  }
}

const progressInstance = new ProgressRepo();
export { progressInstance as progressRepo, progressInstance as progressService };
export default progressInstance;
