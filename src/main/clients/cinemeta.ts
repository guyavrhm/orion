import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { ErrorCode } from '../types/index.js';
import { BadGatewayError, NotFoundError } from '../utils/errors.js';
import type {
  CinemetaMeta,
  CinemetaCatalogResponse,
  CinemetaDetailResponse
} from '../types/index.js';

const CINEMETA_CATALOGS_API = 'https://cinemeta-catalogs.strem.io';
const CINEMETA_META_API = 'https://v3-cinemeta.strem.io';

export class CinemetaClient {
  /**
   * Fetches the top popular movies catalog from Cinemeta.
   */
  async fetchPopularMovies(): Promise<CinemetaMeta[]> {
    try {
      const url = `${CINEMETA_CATALOGS_API}/top/catalog/movie/top.json`;
      logger.info(`Fetching popular movies list from Cinemeta: ${url}`);
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) {
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as CinemetaCatalogResponse;
      return data.metas || [];
    } catch (e) {
      if (e instanceof BadGatewayError) throw e;
      logger.error('Failed to fetch popular movies from Cinemeta', e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }

  /**
   * Fetches the top popular series catalog from Cinemeta.
   */
  async fetchPopularShows(): Promise<CinemetaMeta[]> {
    try {
      const url = `${CINEMETA_CATALOGS_API}/top/catalog/series/top.json`;
      logger.info(`Fetching popular shows list from Cinemeta: ${url}`);
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) {
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as CinemetaCatalogResponse;
      return data.metas || [];
    } catch (e) {
      if (e instanceof BadGatewayError) throw e;
      logger.error('Failed to fetch popular shows from Cinemeta', e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }

  /**
   * Fetches metadata details for a movie or series from Cinemeta.
   * @param id IMDb ID
   * @param type Media type
   * @returns Normalized metadata details
   */
  async fetchMetadataDetails(id: string, type: 'movie' | 'series'): Promise<CinemetaMeta> {
    try {
      const metaUrl = type === 'movie'
        ? `${CINEMETA_META_API}/meta/movie/${id}.json`
        : `${CINEMETA_META_API}/meta/series/${id}.json`;

      logger.info(`Fetching details metadata from Cinemeta: ${metaUrl}`);
      const resp = await fetchWithTimeout(metaUrl);
      if (!resp.ok) {
        if (resp.status === 404) {
          throw new NotFoundError(ErrorCode.MEDIA_NOT_FOUND);
        }
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as CinemetaDetailResponse;
      const meta = data.meta || ({} as Partial<CinemetaMeta>);
      const normalized: CinemetaMeta = {
        ...meta,
        id: meta.imdb_id || meta.id || id,
        type: meta.type || type,
        genres: meta.genres || meta.genre || []
      };
      return normalized;
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof BadGatewayError) throw e;
      logger.error(`Failed to fetch metadata details from Cinemeta for ${id} (${type})`, e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }
}

const cinemetaInstance = new CinemetaClient();
export { cinemetaInstance as cinemetaClient };
export default cinemetaInstance;
