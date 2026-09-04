import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { ErrorCode } from '../types/index.js';
import { BadGatewayError, NotFoundError } from '../utils/errors.js';
import type {
  MovieMetadata,
  ShowMetadata,
  EpisodeMetadata,
  CinemetaCatalogResponse,
  CinemetaDetailResponse,
  MediaType
} from '../types/index.js';

const CINEMETA_CATALOGS_API = 'https://cinemeta-catalogs.strem.io';
const CINEMETA_META_API = 'https://v3-cinemeta.strem.io';

export function normalizeRawMovieMetadata(raw: Record<string, any>, fallbackId?: string): MovieMetadata {
  const id = String(raw.imdb_id || raw.id || fallbackId || '');
  const rawGenres = raw.genres || raw.genre;
  const genres = Array.isArray(rawGenres) ? rawGenres : (typeof rawGenres === 'string' ? [rawGenres] : []);
  const rawCast = raw.cast;
  const cast = Array.isArray(rawCast) ? rawCast : (typeof rawCast === 'string' ? rawCast.split(',').map((s: string) => s.trim()) : []);
  const rawDirector = raw.director;
  const director = Array.isArray(rawDirector) ? rawDirector : (typeof rawDirector === 'string' ? rawDirector.split(',').map((s: string) => s.trim()) : []);
  const rawWriter = raw.writer;
  const writer = Array.isArray(rawWriter) ? rawWriter : (typeof rawWriter === 'string' ? rawWriter.split(',').map((s: string) => s.trim()) : []);

  const rating = raw.imdbRating != null ? String(raw.imdbRating) : (raw.rating != null ? String(raw.rating) : null);
  const runtime = typeof raw.runtime === 'number' ? raw.runtime : (raw.runtime ? parseInt(String(raw.runtime), 10) || null : null);
  const moviedb_id = raw.moviedb_id != null ? parseInt(String(raw.moviedb_id), 10) || null : null;
  const popularity = raw.popularity != null ? parseFloat(String(raw.popularity)) || null : null;

  return {
    id,
    type: 'movie',
    title: String(raw.title || raw.name || ''),
    year: raw.year ? String(raw.year) : null,
    released: raw.released ? String(raw.released) : null,
    genres,
    poster: raw.poster ? String(raw.poster) : null,
    background: raw.background ? String(raw.background) : null,
    logo: raw.logo ? String(raw.logo) : null,
    rating,
    runtime,
    description: raw.description ? String(raw.description) : (raw.overview ? String(raw.overview) : null),
    awards: raw.awards ? String(raw.awards) : null,
    cast,
    director,
    writer,
    country: raw.country ? String(raw.country) : null,
    dvdRelease: raw.dvdRelease ? String(raw.dvdRelease) : null,
    moviedb_id,
    popularity,
    last_fetched: null
  };
}

export function normalizeRawShowMetadata(raw: Record<string, any>, fallbackId?: string): ShowMetadata {
  const id = String(raw.imdb_id || raw.id || fallbackId || '');
  const rawGenres = raw.genres || raw.genre;
  const genres = Array.isArray(rawGenres) ? rawGenres : (typeof rawGenres === 'string' ? [rawGenres] : []);
  const rawCast = raw.cast;
  const cast = Array.isArray(rawCast) ? rawCast : (typeof rawCast === 'string' ? rawCast.split(',').map((s: string) => s.trim()) : []);
  const rawDirector = raw.director;
  const director = Array.isArray(rawDirector) ? rawDirector : (typeof rawDirector === 'string' ? rawDirector.split(',').map((s: string) => s.trim()) : []);
  const rawWriter = raw.writer;
  const writer = Array.isArray(rawWriter) ? rawWriter : (typeof rawWriter === 'string' ? rawWriter.split(',').map((s: string) => s.trim()) : []);

  const rating = raw.imdbRating != null ? String(raw.imdbRating) : (raw.rating != null ? String(raw.rating) : null);
  const runtime = typeof raw.runtime === 'number' ? raw.runtime : (raw.runtime ? parseInt(String(raw.runtime), 10) || null : null);
  const tvdb_id = raw.tvdb_id != null ? parseInt(String(raw.tvdb_id), 10) || null : null;
  const moviedb_id = raw.moviedb_id != null ? parseInt(String(raw.moviedb_id), 10) || null : null;
  const popularity = raw.popularity != null ? parseFloat(String(raw.popularity)) || null : null;

  const rawVideos = Array.isArray(raw.videos) ? raw.videos : [];
  const episodes: EpisodeMetadata[] = rawVideos
    .filter((v: any) => v && (v.season == null || parseInt(String(v.season), 10) > 0))
    .map((v: any) => {
      const seasonNum = v.season != null ? parseInt(String(v.season), 10) : 1;
      const epNum = v.episode != null ? parseInt(String(v.episode), 10) : (v.number != null ? parseInt(String(v.number), 10) : 1);
      const epRating = v.rating != null ? String(v.rating) : null;
      const epRuntime = typeof v.runtime === 'number' ? v.runtime : (v.runtime ? parseInt(String(v.runtime), 10) || null : null);
      const epTvdbId = v.tvdb_id != null ? parseInt(String(v.tvdb_id), 10) || null : null;

      return {
        id: String(v.id || `${id}_s${seasonNum}_e${epNum}`),
        show_id: id,
        season: seasonNum,
        episode: epNum,
        title: String(v.title || v.name || `Episode ${epNum}`),
        description: v.description ? String(v.description) : (v.overview ? String(v.overview) : null),
        thumbnail: v.thumbnail ? String(v.thumbnail) : null,
        released: v.released ? String(v.released) : (v.firstAired ? String(v.firstAired) : null),
        rating: epRating,
        tvdb_id: epTvdbId,
        runtime: epRuntime
      };
    });

  return {
    id,
    type: 'show',
    title: String(raw.title || raw.name || ''),
    year: raw.year ? String(raw.year) : null,
    released: raw.released ? String(raw.released) : null,
    genres,
    poster: raw.poster ? String(raw.poster) : null,
    background: raw.background ? String(raw.background) : null,
    logo: raw.logo ? String(raw.logo) : null,
    rating,
    runtime,
    description: raw.description ? String(raw.description) : (raw.overview ? String(raw.overview) : null),
    awards: raw.awards ? String(raw.awards) : null,
    cast,
    director,
    writer,
    country: raw.country ? String(raw.country) : null,
    status: raw.status ? String(raw.status) : null,
    tvdb_id,
    moviedb_id,
    popularity,
    episodes,
    last_fetched: null
  };
}

export class CinemetaClient {
  /**
   * Fetches popular movies from Cinemeta.
   */
  async fetchPopularMovies(): Promise<MovieMetadata[]> {
    try {
      const url = `${CINEMETA_CATALOGS_API}/top/catalog/movie/top.json`;
      logger.info(`Fetching popular movies list from Cinemeta: ${url}`);
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) {
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as CinemetaCatalogResponse;
      return (data.metas || []).map((m: any) => normalizeRawMovieMetadata(m));
    } catch (e) {
      if (e instanceof BadGatewayError) throw e;
      logger.error('Failed to fetch popular movies from Cinemeta', e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }

  /**
   * Fetches popular shows from Cinemeta.
   */
  async fetchPopularShows(): Promise<ShowMetadata[]> {
    try {
      const url = `${CINEMETA_CATALOGS_API}/top/catalog/series/top.json`;
      logger.info(`Fetching popular shows list from Cinemeta: ${url}`);
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) {
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as CinemetaCatalogResponse;
      return (data.metas || []).map((m: any) => normalizeRawShowMetadata(m));
    } catch (e) {
      if (e instanceof BadGatewayError) throw e;
      logger.error('Failed to fetch popular shows from Cinemeta', e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }

  /**
   * Fetches metadata details for a movie or show from Cinemeta.
   */
  async fetchMetadataDetails(id: string, type: MediaType): Promise<MovieMetadata | ShowMetadata> {
    try {
      const externalType = type === 'movie' ? 'movie' : 'series';
      const metaUrl = `${CINEMETA_META_API}/meta/${externalType}/${id}.json`;

      logger.info(`Fetching details metadata from Cinemeta: ${metaUrl}`);
      const resp = await fetchWithTimeout(metaUrl);
      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError(ErrorCode.MEDIA_NOT_FOUND);
        }
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as CinemetaDetailResponse;
      const raw = (data.meta || {}) as Record<string, any>;
      return type === 'movie'
        ? normalizeRawMovieMetadata(raw, id)
        : normalizeRawShowMetadata(raw, id);
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof BadGatewayError) throw e;
      logger.error(`Failed to fetch metadata details from Cinemeta for ${id} (${type})`, e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }
}

export const cinemetaClient = new CinemetaClient();
export default cinemetaClient;
