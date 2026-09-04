import { db } from './index.js';
import { streamsRepo } from './streams.js';
import { rebuildMovieMetadata, rebuildShowMetadata, metadataRepo } from './metadata.js';
import { parseFileId, type ParsedFileIdShow } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import type {
  Progress,
  ProgressUpdate,
  MovieMetadata,
  ShowMetadata,
  Stream,
  MediaType
} from '../types/index.js';

const getSingleProgressStmt = db.prepare(`
  SELECT id, show_id, timestamp, runtime, last_updated
  FROM progress
  WHERE id = ?
`);

const saveProgressStmt = db.prepare(`
  INSERT INTO progress (id, show_id, timestamp, runtime, last_updated)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    show_id = excluded.show_id,
    timestamp = excluded.timestamp,
    runtime = excluded.runtime,
    last_updated = excluded.last_updated
`);

const getProgressEpisodesForShowStmt = db.prepare(`
  SELECT id, show_id, timestamp, runtime, last_updated
  FROM progress
  WHERE show_id = ?
  ORDER BY last_updated DESC
`);

const getContinueWatchingMoviesStmt = db.prepare(`
  SELECT p.id as id, p.show_id, p.timestamp, p.runtime as progress_runtime, p.last_updated,
         m.title, m.year, m.released, m.genres, m.poster, m.background, m.logo, m.imdb_rating, m.runtime,
         m.description, m.awards, m.cast, m.director, m.writer, m.country, m.dvdRelease, m.moviedb_id, m.popularity
  FROM progress p
  LEFT JOIN movie_metadata m ON p.id = m.id
  WHERE p.show_id IS NULL
  ORDER BY p.last_updated DESC
  LIMIT ?
`);

const getContinueWatchingShowsStmt = db.prepare(`
  SELECT p.show_id as id, MAX(p.last_updated) as last_updated,
         s.title, s.year, s.released, s.genres, s.poster, s.background, s.logo, s.imdb_rating, s.runtime,
         s.description, s.awards, s.cast, s.director, s.writer, s.country, s.status, s.tvdb_id, s.moviedb_id, s.popularity
  FROM progress p
  LEFT JOIN show_metadata s ON p.show_id = s.id
  WHERE p.show_id IS NOT NULL
  GROUP BY p.show_id
  ORDER BY last_updated DESC
  LIMIT ?
`);

export class ProgressRepo {
  /**
   * Retrieves single progress record for any movie or episode fileId.
   */
  getProgress(fileId: string): Progress | null {
    if (!fileId) return null;
    try {
      const row = getSingleProgressStmt.get(fileId) as Progress | undefined;
      if (!row) return null;
      return {
        id: row.id,
        show_id: row.show_id || null,
        timestamp: row.timestamp || 0,
        runtime: row.runtime || 0,
        last_updated: row.last_updated || 0
      };
    } catch (e) {
      logger.error(`Error fetching single progress for ${fileId}`, e);
      return null;
    }
  }

  /**
   * Saves watch progress for any movie or episode fileId directly (O(1) write).
   */
  saveProgress(fileId: string, update: ProgressUpdate = { timestamp: 0, runtime: 0 }): void {
    if (!fileId) return;
    const parsed = parseFileId(fileId);
    if (!parsed) return;

    try {
      const current = getSingleProgressStmt.get(fileId) as Progress | undefined;
      const timestamp = update.timestamp ?? 0;
      const runtime = update.runtime ?? current?.runtime ?? 0;

      const isMovie = parsed.type === 'movie';
      const showId = isMovie ? null : parsed.id;

      saveProgressStmt.run(fileId, showId, timestamp, runtime, Date.now());
      logger.debug(`Saved watch progress for: ${fileId} at timestamp ${timestamp}`);
    } catch (e) {
      logger.error(`Failed to save progress for ${fileId}`, e);
    }
  }

  /**
   * Retrieves single show progress hierarchy.
   */
  getSingleShowProgress(showId: string): {
    id: string;
    last_season: number;
    last_episode: number;
    last_updated: number | null;
    episodes: Record<string, Progress>;
  } {
    try {
      const epRows = getProgressEpisodesForShowStmt.all(showId) as unknown as Progress[];
      const episodes: Record<string, Progress> = {};
      let last_season = 1;
      let last_episode = 1;
      let last_updated: number | null = null;

      if (epRows.length > 0) {
        const latest = epRows[0]; // Already ordered by last_updated DESC
        last_updated = latest.last_updated;
        const latestParsed = parseFileId(latest.id) as ParsedFileIdShow;
        if (latestParsed) {
          last_season = Number(latestParsed.season);
          last_episode = Number(latestParsed.episode);
        }

        for (const ep of epRows) {
          episodes[ep.id] = {
            id: ep.id,
            show_id: showId,
            timestamp: ep.timestamp || 0,
            runtime: ep.runtime || 0,
            last_updated: ep.last_updated || 0
          };
        }
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
   * Gathers normalized Continue Watching metadata, progress, and ready lists.
   */
  getContinueWatching(type: MediaType, limit = 10): {
    metadata: (MovieMetadata | ShowMetadata)[];
    progress: Record<string, Progress>;
    ready: Record<string, Stream>;
  } {
    try {
      const metadata: (MovieMetadata | ShowMetadata)[] = [];
      const progress: Record<string, Progress> = {};
      const ready: Record<string, Stream> = {};

      if (type === 'movie') {
        const rows = getContinueWatchingMoviesStmt.all(limit) as unknown as any[];

        for (const row of rows) {
          const meta = rebuildMovieMetadata(row);
          if (meta) {
            metadata.push(meta);
          }

          progress[row.id] = {
            id: row.id,
            show_id: null,
            timestamp: row.timestamp || 0,
            runtime: row.progress_runtime || 0,
            last_updated: row.last_updated || 0
          };

          const st = streamsRepo.getMovieStream(row.id);
          if (st) {
            ready[row.id] = {
              id: st.id,
              show_id: st.show_id,
              quality: st.quality,
              size_bytes: st.size_bytes,
              ready_at: st.ready_at
            };
          }
        }
      } else {
        const showRows = getContinueWatchingShowsStmt.all(limit) as unknown as any[];

        for (const showRow of showRows) {
          const epRows = getProgressEpisodesForShowStmt.all(showRow.id) as unknown as Progress[];
          if (epRows.length === 0) continue;

          const latestEp = epRows[0];
          const parsed = parseFileId(latestEp.id) as ParsedFileIdShow;
          if (!parsed) continue;

          const season = Number(parsed.season);
          const episode = Number(parsed.episode);
          const episodeId = latestEp.id;

          const epMeta = metadataRepo.getEpisodeMetadataSingle(showRow.id, season, episode);
          const showMeta = rebuildShowMetadata(showRow, epMeta ? [epMeta] : []);
          if (showMeta) {
            metadata.push(showMeta);
          }

          progress[episodeId] = {
            id: episodeId,
            show_id: showRow.id,
            timestamp: latestEp.timestamp || 0,
            runtime: latestEp.runtime || 0,
            last_updated: latestEp.last_updated || 0
          };

          const st = streamsRepo.getEpisodeStream(episodeId);
          if (st) {
            ready[episodeId] = {
              id: st.id,
              show_id: st.show_id,
              quality: st.quality,
              size_bytes: st.size_bytes,
              ready_at: st.ready_at
            };
          }
        }
      }
      return { metadata, progress, ready };
    } catch (e) {
      logger.error('Error fetching Continue Watching catalog lists', e);
      return { metadata: [], progress: {}, ready: {} };
    }
  }
}

export const progressRepo = new ProgressRepo();
export default progressRepo;
