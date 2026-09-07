import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { ErrorCode } from '../types/index.js';
import { BadGatewayError } from '../utils/errors.js';
import type { MovieMetadata, ShowMetadata, MediaType } from '../types/index.js';
import { normalizeRawMovieMetadata, normalizeRawShowMetadata } from './cinemeta.js';

const METAHUB_API = 'https://www.metahub.space/api';

function getMetahubHeaders(): Record<string, string> {
  const randomIp = `${Math.floor(Math.random() * 200) + 10}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'X-Forwarded-For': randomIp
  };
}

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
      const resp = await fetchWithTimeout(searchUrl, {
        headers: getMetahubHeaders()
      });
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
