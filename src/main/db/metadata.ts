import { db } from './index.js';
import { logger } from '../utils/logger.js';
import type {
  MovieMetadata,
  ShowMetadata,
  EpisodeMetadata,
  MediaType
} from '../types/index.js';

const CONTINUING_SHOW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface MovieRow {
  id: string;
  title: string | null;
  year: string | null;
  released: string | null;
  genres: string | null;
  poster: string | null;
  background: string | null;
  logo: string | null;
  imdb_rating: string | null;
  runtime: string | null;
  description: string | null;
  awards: string | null;
  cast: string | null;
  director: string | null;
  writer: string | null;
  country: string | null;
  dvdRelease: string | null;
  moviedb_id: number | null;
  popularity: number | null;
  last_fetched: number | null;
}

interface ShowRow {
  id: string;
  title: string | null;
  year: string | null;
  released: string | null;
  genres: string | null;
  poster: string | null;
  background: string | null;
  logo: string | null;
  imdb_rating: string | null;
  runtime: string | null;
  description: string | null;
  awards: string | null;
  cast: string | null;
  director: string | null;
  writer: string | null;
  country: string | null;
  status: string | null;
  tvdb_id: number | null;
  moviedb_id: number | null;
  popularity: number | null;
  last_fetched: number | null;
}

interface EpisodeRow {
  id: string;
  show_id: string;
  season: number;
  episode: number;
  name?: string | null;
  title?: string | null;
  description: string | null;
  thumbnail: string | null;
  released: string | null;
  rating: string | null;
  tvdb_id: number | null;
  runtime: number | null;
}

// Pre-compiled prepared statements for performance
const getMovieMetadataStmt = db.prepare('SELECT * FROM movie_metadata WHERE id = ?');
const getShowMetadataStmt = db.prepare('SELECT * FROM show_metadata WHERE id = ?');
const getEpisodeMetadataStmt = db.prepare('SELECT * FROM episode_metadata WHERE show_id = ? ORDER BY season, episode');
const getEpisodeMetadataSingleStmt = db.prepare('SELECT * FROM episode_metadata WHERE show_id = ? AND season = ? AND episode = ?');
const getEpisodeMetadataExistingStmt = db.prepare('SELECT id FROM episode_metadata WHERE show_id = ?');

const insertShowMetadataStmt = db.prepare(`
  INSERT INTO show_metadata (id, title, year, released, genres, poster, background, logo, imdb_rating, runtime, description, awards, cast, director, writer, country, status, tvdb_id, moviedb_id, popularity, last_fetched)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    year = excluded.year,
    released = excluded.released,
    genres = excluded.genres,
    poster = excluded.poster,
    background = excluded.background,
    logo = excluded.logo,
    imdb_rating = excluded.imdb_rating,
    runtime = excluded.runtime,
    description = excluded.description,
    awards = excluded.awards,
    cast = excluded.cast,
    director = excluded.director,
    writer = excluded.writer,
    country = excluded.country,
    status = excluded.status,
    tvdb_id = excluded.tvdb_id,
    moviedb_id = excluded.moviedb_id,
    popularity = excluded.popularity,
    last_fetched = excluded.last_fetched
`);

const insertEpisodeMetadataStmt = db.prepare(`
  INSERT INTO episode_metadata (id, show_id, season, episode, name, description, thumbnail, released, rating, tvdb_id, runtime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    thumbnail = excluded.thumbnail,
    released = excluded.released,
    rating = excluded.rating,
    tvdb_id = excluded.tvdb_id,
    runtime = excluded.runtime
`);

const insertMovieMetadataStmt = db.prepare(`
  INSERT INTO movie_metadata (id, title, year, released, genres, poster, background, logo, imdb_rating, runtime, description, awards, cast, director, writer, country, dvdRelease, moviedb_id, popularity, last_fetched)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    year = excluded.year,
    released = excluded.released,
    genres = excluded.genres,
    poster = excluded.poster,
    background = excluded.background,
    logo = excluded.logo,
    imdb_rating = excluded.imdb_rating,
    runtime = excluded.runtime,
    description = excluded.description,
    awards = excluded.awards,
    cast = excluded.cast,
    director = excluded.director,
    writer = excluded.writer,
    country = excluded.country,
    dvdRelease = excluded.dvdRelease,
    moviedb_id = excluded.moviedb_id,
    popularity = excluded.popularity,
    last_fetched = excluded.last_fetched
`);

const getMovieMetadataRuntimeCastStmt = db.prepare('SELECT runtime, "cast", last_fetched FROM movie_metadata WHERE id = ?');

/**
 * Rebuilds metadata object for movies with strict schema guarantees.
 */
export function rebuildMovieMetadata(row: MovieRow | null | undefined): MovieMetadata | null {
  if (!row) return null;
  const genres = row.genres ? row.genres.split(',').filter(Boolean) : [];
  const cast = row.cast ? row.cast.split(',').filter(Boolean) : [];
  const director = row.director ? row.director.split(',').filter(Boolean) : [];
  const writer = row.writer ? row.writer.split(',').filter(Boolean) : [];
  const runtime = row.runtime ? parseInt(row.runtime, 10) || null : null;

  return {
    id: row.id,
    type: 'movie',
    title: row.title || '',
    year: row.year || null,
    released: row.released || null,
    genres,
    poster: row.poster || null,
    background: row.background || null,
    logo: row.logo || null,
    rating: row.imdb_rating || null,
    runtime,
    description: row.description || null,
    awards: row.awards || null,
    cast,
    director,
    writer,
    country: row.country || null,
    dvdRelease: row.dvdRelease || null,
    moviedb_id: row.moviedb_id,
    popularity: row.popularity,
    last_fetched: row.last_fetched
  };
}

/**
 * Rebuilds metadata object for shows and their nested episodes with strict schema guarantees.
 */
export function rebuildShowMetadata(row: ShowRow | null | undefined, epRows: EpisodeRow[] = []): ShowMetadata | null {
  if (!row) return null;
  const genres = row.genres ? row.genres.split(',').filter(Boolean) : [];
  const cast = row.cast ? row.cast.split(',').filter(Boolean) : [];
  const director = row.director ? row.director.split(',').filter(Boolean) : [];
  const writer = row.writer ? row.writer.split(',').filter(Boolean) : [];
  const runtime = row.runtime ? parseInt(row.runtime, 10) || null : null;

  const episodes: EpisodeMetadata[] = epRows.map(ep => ({
    id: ep.id || `${row.id}_s${ep.season}_e${ep.episode}`,
    show_id: row.id,
    season: ep.season,
    episode: ep.episode,
    title: ep.title || ep.name || `Episode ${ep.episode}`,
    description: ep.description || null,
    thumbnail: ep.thumbnail || null,
    released: ep.released || null,
    rating: ep.rating || null,
    tvdb_id: ep.tvdb_id,
    runtime: ep.runtime
  }));

  return {
    id: row.id,
    type: 'show',
    title: row.title || '',
    year: row.year || null,
    released: row.released || null,
    genres,
    poster: row.poster || null,
    background: row.background || null,
    logo: row.logo || null,
    rating: row.imdb_rating || null,
    runtime,
    description: row.description || null,
    awards: row.awards || null,
    cast,
    director,
    writer,
    country: row.country || null,
    status: row.status || null,
    tvdb_id: row.tvdb_id,
    moviedb_id: row.moviedb_id,
    popularity: row.popularity,
    episodes,
    last_fetched: row.last_fetched
  };
}

export class MetadataRepo {
  /**
   * Retrieves cached movie metadata.
   */
  getCachedMovieMetadata(id: string): MovieMetadata | null {
    try {
      const movie = getMovieMetadataStmt.get(id) as MovieRow | undefined;
      if (movie) {
        logger.debug(`Metadata cache HIT for movie: ${id}`);
        return rebuildMovieMetadata(movie);
      }
      return null;
    } catch (e) {
      logger.error(`Error reading cached movie metadata for: ${id}`, e);
      return null;
    }
  }

  /**
   * Retrieves cached show metadata with all nested episodes.
   */
  getCachedShowMetadata(id: string): ShowMetadata | null {
    try {
      const show = getShowMetadataStmt.get(id) as ShowRow | undefined;
      if (show) {
        logger.debug(`Metadata cache HIT for show: ${id}`);
        const eps = getEpisodeMetadataStmt.all(id) as unknown as EpisodeRow[];
        return rebuildShowMetadata(show, eps);
      }
      return null;
    } catch (e) {
      logger.error(`Error reading cached show metadata for: ${id}`, e);
      return null;
    }
  }

  /**
   * Retrieves metadata from cache for any media type.
   */
  getCachedMetadata(id: string): MovieMetadata | ShowMetadata | null {
    const movie = this.getCachedMovieMetadata(id);
    if (movie) return movie;
    return this.getCachedShowMetadata(id);
  }

  /**
   * Saves metadata directly to the database cache.
   */
  saveCachedMetadata(id: string, type: MediaType, metadata: any, status?: string | null): void {
    try {
      let existingMeta: { hasEps?: boolean; hasRuntime?: boolean; status?: string | null; last_fetched?: number | null } | null = null;
      if (type === 'show') {
        const existing = getShowMetadataStmt.get(id) as ShowRow | undefined;
        if (existing) {
          const eps = getEpisodeMetadataExistingStmt.all(id) as unknown as { id: string }[];
          existingMeta = { 
            hasEps: eps.length > 0,
            status: existing.status,
            last_fetched: existing.last_fetched
          };
        }
      } else {
        const existing = getMovieMetadataRuntimeCastStmt.get(id) as Pick<MovieRow, 'runtime' | 'cast' | 'last_fetched'> | undefined;
        if (existing) {
          existingMeta = { 
            hasRuntime: !!existing.runtime || !!existing.cast,
            last_fetched: existing.last_fetched
          };
        }
      }

      if (existingMeta) {
        if (type === 'show') {
          const isContinuing = existingMeta.status === 'Continuing';
          const isExpired = isContinuing && existingMeta.last_fetched && (Date.now() - existingMeta.last_fetched > CONTINUING_SHOW_CACHE_TTL_MS);
          if (!isExpired) {
            return; // Cache is still valid
          }
        } else {
          return; // Movies never expire
        }
      }

      const title = metadata.title || '';
      const year = metadata.year || null;
      const released = metadata.released || null;
      const genres = Array.isArray(metadata.genres) ? metadata.genres.join(',') : (metadata.genres || '');
      const poster = metadata.poster || null;
      const background = metadata.background || null;
      const logo = metadata.logo || null;
      const rating = metadata.rating != null ? String(metadata.rating) : null;
      const runtime = metadata.runtime != null ? String(metadata.runtime) : null;
      const description = metadata.description || null;
      const awards = metadata.awards || null;
      const cast = Array.isArray(metadata.cast) ? metadata.cast.join(',') : (metadata.cast || '');
      const director = Array.isArray(metadata.director) ? metadata.director.join(',') : (metadata.director || '');
      const writer = Array.isArray(metadata.writer) ? metadata.writer.join(',') : (metadata.writer || '');
      const country = metadata.country || null;

      db.exec('BEGIN TRANSACTION');
      if (type === 'show') {
        const tvdb_id = metadata.tvdb_id != null ? parseInt(String(metadata.tvdb_id), 10) : null;
        const moviedb_id = metadata.moviedb_id != null ? parseInt(String(metadata.moviedb_id), 10) : null;
        const popularity = metadata.popularity != null ? parseFloat(String(metadata.popularity)) : null;

        insertShowMetadataStmt.run(id, title, year, released, genres, poster, background, logo, rating, runtime, description, awards, cast, director, writer, country, status ?? null, tvdb_id, moviedb_id, popularity, Date.now());

        if (Array.isArray(metadata.episodes)) {
          for (const ep of metadata.episodes) {
            const seasonNum = parseInt(String(ep.season), 10);
            if (seasonNum > 0) {
              const epNum = parseInt(String(ep.episode), 10);
              const epId = ep.id || `${id}_s${seasonNum}_e${epNum}`;
              const epTitle = ep.title || ep.name || `Episode ${epNum}`;
              const epDesc = ep.description || null;
              const epThumb = ep.thumbnail || null;
              const epReleased = ep.released || null;
              const epRating = ep.rating != null ? String(ep.rating) : null;
              const epTvdbId = ep.tvdb_id != null ? parseInt(String(ep.tvdb_id), 10) : null;
              const epRuntime = ep.runtime != null ? parseInt(String(ep.runtime), 10) : null;

              insertEpisodeMetadataStmt.run(epId, id, seasonNum, epNum, epTitle, epDesc, epThumb, epReleased, epRating, epTvdbId, epRuntime);
            }
          }
        }
      } else {
        const dvdRelease = metadata.dvdRelease || null;
        const moviedb_id = metadata.moviedb_id != null ? parseInt(String(metadata.moviedb_id), 10) : null;
        const popularity = metadata.popularity != null ? parseFloat(String(metadata.popularity)) : null;

        insertMovieMetadataStmt.run(id, title, year, released, genres, poster, background, logo, rating, runtime, description, awards, cast, director, writer, country, dvdRelease, moviedb_id, popularity, Date.now());
      }
      db.exec('COMMIT');
      logger.debug(`Metadata cache WRITE complete for: ${id} (${type})`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      logger.error(`Error saving metadata to database cache for ${id}`, e);
    }
  }

  /**
   * Gets specific episode metadata.
   */
  getEpisodeMetadataSingle(showId: string, season: number, episode: number): EpisodeMetadata | null {
    try {
      const row = getEpisodeMetadataSingleStmt.get(showId, season, episode) as EpisodeRow | undefined;
      if (!row) return null;
      return {
        id: row.id || `${showId}_s${season}_e${episode}`,
        show_id: showId,
        season,
        episode,
        title: row.name || row.title || `Episode ${episode}`,
        description: row.description || null,
        thumbnail: row.thumbnail || null,
        released: row.released || null,
        rating: row.rating || null,
        tvdb_id: row.tvdb_id,
        runtime: row.runtime
      };
    } catch (e) {
      logger.error(`Error fetching single episode metadata: ${showId} S${season}E${episode}`, e);
      return null;
    }
  }
}

export const metadataRepo = new MetadataRepo();
export default metadataRepo;
