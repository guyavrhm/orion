import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { ErrorCode } from '../types/index.js';
import { BadGatewayError } from '../utils/errors.js';
import type { MovieMetadata, ShowMetadata, MediaType } from '../types/index.js';
import { normalizeRawMovieMetadata, normalizeRawShowMetadata } from './cinemeta.js';

const METAHUB_API = 'https://www.metahub.space/api';

export class MetahubClient {
  /**
   * Searches media using Metahub search.
   * @param query Search query string
   * @returns List of canonical MovieMetadata and ShowMetadata objects
   */
  async searchMetahub(query: string): Promise<(MovieMetadata | ShowMetadata)[]> {
    try {
      const searchUrl = `${METAHUB_API}/search?q=${encodeURIComponent(query)}`;
      logger.info(`Querying search on Metahub: ${searchUrl}`);
      const resp = await fetchWithTimeout(searchUrl);
      if (!resp.ok) {
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as Record<string, unknown>[];
      if (!Array.isArray(data)) return [];
      return data.map((item: Record<string, any>) => {
        const type: MediaType = item.type === 'series' || item.type === 'show' ? 'show' : 'movie';
        return type === 'movie'
          ? normalizeRawMovieMetadata(item)
          : normalizeRawShowMetadata(item);
      });
    } catch (e) {
      if (e instanceof BadGatewayError) throw e;
      logger.error(`Metahub search failed for query "${query}"`, e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }
}

export const metahubClient = new MetahubClient();
export default metahubClient;
