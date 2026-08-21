import { db } from './index.js';
import { logger } from '../utils/logger.js';
import type {
  MovieMetadataRow,
  ShowMetadataRow,
  EpisodeMetadataRow,
  MovieMetadata,
  ShowMetadata,
  CachedMetadataResult,
  CinemetaVideo,
  CinemetaMeta
} from '../types/index.js';

const CONTINUING_SERIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Pre-compiled prepared statements for performance
const getMovieMetadataStmt = db.prepare('SELECT * FROM movie_metadata WHERE id = ?');
const getShowMetadataStmt = db.prepare('SELECT * FROM show_metadata WHERE id = ?');
const getEpisodeMetadataStmt = db.prepare('SELECT * FROM episode_metadata WHERE show_id = ? ORDER BY season, episode');
const getEpisodeMetadataSingleStmt = db.prepare('SELECT * FROM episode_metadata WHERE show_id = ? AND season = ? AND episode = ?');
const getEpisodeMetadataExistingStmt = db.prepare('SELECT id FROM episode_metadata WHERE show_id = ?');

const insertShowMetadataStmt = db.prepare(`
  INSERT INTO show_metadata (id, title, year, genres, poster, background, logo, imdb_rating, runtime, description, awards, cast, director, writer, country, status, tvdb_id, moviedb_id, popularity, last_fetched)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    year = excluded.year,
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
  INSERT INTO movie_metadata (id, title, year, genres, poster, background, logo, imdb_rating, runtime, description, awards, cast, director, writer, country, dvdRelease, moviedb_id, popularity, last_fetched)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    year = excluded.year,
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
 * Rebuilds metadata object for movies.
 */
export function rebuildMovieMetadata(row: MovieMetadataRow | null | undefined): MovieMetadata | null {
  if (!row) return null;
  return {
    id: row.id,
    type: 'movie',
    name: row.title ?? undefined,
    title: row.title ?? undefined,
    year: row.year ?? undefined,
    released: row.released ?? undefined,
    genres: row.genres ? row.genres.split(',') : [],
    poster: row.poster ?? undefined,
    background: row.background ?? undefined,
    logo: row.logo ?? undefined,
    imdbRating: row.imdb_rating ?? undefined,
    runtime: row.runtime ?? undefined,
    description: row.description ?? undefined,
    awards: row.awards ?? undefined,
    cast: row.cast ? row.cast.split(',') : [],
    director: row.director ? row.director.split(',') : [],
    writer: row.writer ? row.writer.split(',') : [],
    country: row.country ?? undefined,
    dvdRelease: row.dvdRelease ?? undefined,
    moviedb_id: row.moviedb_id,
    popularity: row.popularity
  };
}

/**
 * Rebuilds metadata object for shows and their nested episodes.
 */
export function rebuildShowMetadata(row: ShowMetadataRow | null | undefined, epRows: EpisodeMetadataRow[] = []): ShowMetadata | null {
  if (!row) return null;
  const videos: CinemetaVideo[] = epRows.map(ep => ({
    id: `${row.id}:${ep.season}:${ep.episode}`,
    name: ep.name ?? undefined,
    season: ep.season,
    episode: ep.episode,
    number: ep.episode,
    firstAired: ep.released ?? undefined,
    released: ep.released ?? undefined,
    tvdb_id: ep.tvdb_id,
    rating: ep.rating ?? undefined,
    overview: ep.description ?? undefined,
    description: ep.description ?? undefined,
    thumbnail: ep.thumbnail ?? undefined,
    runtime: ep.runtime
  }));
  return {
    id: row.id,
    type: 'series',
    name: row.title ?? undefined,
    title: row.title ?? undefined,
    year: row.year ?? undefined,
    released: row.released ?? undefined,
    genres: row.genres ? row.genres.split(',') : [],
    poster: row.poster ?? undefined,
    background: row.background ?? undefined,
    logo: row.logo ?? undefined,
    imdbRating: row.imdb_rating ?? undefined,
    runtime: row.runtime ?? undefined,
    description: row.description ?? undefined,
    awards: row.awards ?? undefined,
    cast: row.cast ? row.cast.split(',') : [],
    director: row.director ? row.director.split(',') : [],
    writer: row.writer ? row.writer.split(',') : [],
    country: row.country ?? undefined,
    status: row.status ?? undefined,
    tvdb_id: row.tvdb_id,
    moviedb_id: row.moviedb_id,
    popularity: row.popularity,
    videos: videos
  };
}

export class MetadataRepo {
  /**
   * Retrieves metadata from cache.
   * @param id IMDb ID
   */
  getCachedMetadata(id: string): CachedMetadataResult | null {
    try {
      const movie = getMovieMetadataStmt.get(id) as MovieMetadataRow | undefined;
      if (movie) {
        logger.debug(`Metadata cache HIT for movie: ${id}`);
        return {
          id: movie.id,
          type: 'movie',
          metadata: rebuildMovieMetadata(movie),
          status: 'movie',
          last_fetched: movie.last_fetched
        };
      }

      const show = getShowMetadataStmt.get(id) as ShowMetadataRow | undefined;
      if (show) {
        logger.debug(`Metadata cache HIT for series: ${id}`);
        const eps = getEpisodeMetadataStmt.all(id) as unknown as EpisodeMetadataRow[];
        return {
          id: show.id,
          type: 'series',
          metadata: rebuildShowMetadata(show, eps),
          status: show.status,
          last_fetched: show.last_fetched
        };
      }

      logger.debug(`Metadata cache MISS for: ${id}`);
      return null;
    } catch (e) {
      logger.error(`Error reading cached metadata for: ${id}`, e);
      return null;
    }
  }

  /**
   * Saves metadata to the database cache.
   */
  saveCachedMetadata(id: string, type: string, metadata: CinemetaMeta | any, status?: string | null): void {
    try {
      let existingMeta: { hasEps?: boolean; hasRuntime?: boolean; status?: string | null; last_fetched?: number | null } | null = null;
      if (type === 'series' || type === 'show') {
        const existing = getShowMetadataStmt.get(id) as ShowMetadataRow | undefined;
        if (existing) {
          const eps = getEpisodeMetadataExistingStmt.all(id) as unknown as { id: string }[];
          existingMeta = { 
            hasEps: eps.length > 0,
            status: existing.status,
            last_fetched: existing.last_fetched
          };
        }
      } else {
        const existing = getMovieMetadataRuntimeCastStmt.get(id) as Pick<MovieMetadataRow, 'runtime' | 'cast' | 'last_fetched'> | undefined;
        if (existing) {
          existingMeta = { 
            hasRuntime: !!existing.runtime || !!existing.cast,
            last_fetched: existing.last_fetched
          };
        }
      }

      if (existingMeta) {
        if (type === 'series' || type === 'show') {
          const isContinuing = existingMeta.status === 'Continuing';
          const isExpired = isContinuing && existingMeta.last_fetched && (Date.now() - existingMeta.last_fetched > CONTINUING_SERIES_CACHE_TTL_MS);
          if (!isExpired) {
            return; // Cache is still valid
          }
        } else {
          return; // Movies never expire
        }
      }

      const title = metadata.name || metadata.title || '';
      const year = metadata.year || '';
      const genres = Array.isArray(metadata.genres || metadata.genre) ? (metadata.genres || metadata.genre).join(',') : '';
      const poster = metadata.poster || '';
      const background = metadata.background || '';
      const logo = metadata.logo || '';
      const rating = metadata.imdbRating || metadata.rating || '';
      const runtime = metadata.runtime ? String(metadata.runtime) : '';
      const description = metadata.description || metadata.overview || '';
      const awards = metadata.awards || '';
      const cast = Array.isArray(metadata.cast) ? metadata.cast.join(',') : (typeof metadata.cast === 'string' ? metadata.cast : '');
      const director = Array.isArray(metadata.director) ? metadata.director.join(',') : (typeof metadata.director === 'string' ? metadata.director : '');
      const writer = Array.isArray(metadata.writer) ? metadata.writer.join(',') : (typeof metadata.writer === 'string' ? metadata.writer : '');
      const country = metadata.country || '';

      db.exec('BEGIN TRANSACTION');
      if (type === 'series' || type === 'show') {
        const tvdb_id = metadata.tvdb_id ? parseInt(String(metadata.tvdb_id), 10) : null;
        const moviedb_id = metadata.moviedb_id ? parseInt(String(metadata.moviedb_id), 10) : null;
        const popularity = metadata.popularity ? parseFloat(String(metadata.popularity)) : null;

        insertShowMetadataStmt.run(id, title, year, genres, poster, background, logo, rating, runtime, description, awards, cast, director, writer, country, status || null, tvdb_id, moviedb_id, popularity, Date.now());

        if (metadata.videos && Array.isArray(metadata.videos)) {
          for (const ep of metadata.videos) {
            if (ep.season && ep.season > 0) {
              const epNum = ep.episode || ep.number;
              const epId = `${id}_s${ep.season}_e${epNum}`;
              const epTitle = ep.title || ep.name || `Episode ${epNum}`;
              const epDesc = ep.overview || ep.description || '';
              const epThumb = ep.thumbnail || '';
              const epReleased = ep.released || ep.firstAired || '';
              const epRating = ep.rating ? String(ep.rating) : '';
              const epTvdbId = ep.tvdb_id ? parseInt(String(ep.tvdb_id), 10) : null;
              const epRuntime = ep.runtime ? parseInt(String(ep.runtime), 10) : 0;

              insertEpisodeMetadataStmt.run(epId, id, ep.season, epNum, epTitle, epDesc, epThumb, epReleased, epRating, epTvdbId, epRuntime);
            }
          }
        }
      } else {
        const dvdRelease = metadata.dvdRelease || '';
        const moviedb_id = metadata.moviedb_id ? parseInt(String(metadata.moviedb_id), 10) : null;
        const popularity = metadata.popularity ? parseFloat(String(metadata.popularity)) : null;

        insertMovieMetadataStmt.run(id, title, year, genres, poster, background, logo, rating, runtime, description, awards, cast, director, writer, country, dvdRelease, moviedb_id, popularity, Date.now());
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
  getEpisodeMetadataSingle(showId: string, season: number, episode: number): EpisodeMetadataRow | null {
    try {
      return (getEpisodeMetadataSingleStmt.get(showId, season, episode) as EpisodeMetadataRow | undefined) || null;
    } catch (e) {
      logger.error(`Error fetching single episode metadata: ${showId} S${season}E${episode}`, e);
      return null;
    }
  }
}

const metadataInstance = new MetadataRepo();
export { metadataInstance as metadataRepo, metadataInstance as metadataService };
export default metadataInstance;
