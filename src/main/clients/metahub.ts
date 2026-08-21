import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { ErrorCode } from '../types/index.js';
import { BadGatewayError } from '../utils/errors.js';
import type { MetahubItem, MetahubResponse } from '../types/index.js';

const METAHUB_API = 'https://www.metahub.space/api';

export class MetahubClient {
  /**
   * Searches media using Metahub search.
   * @param query Search query string
   * @returns List of matching media objects
   */
  async searchMetahub(query: string): Promise<MetahubItem[]> {
    try {
      const searchUrl = `${METAHUB_API}/search?q=${encodeURIComponent(query)}`;
      logger.info(`Querying search on Metahub: ${searchUrl}`);
      const resp = await fetchWithTimeout(searchUrl);
      if (!resp.ok) {
        throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
      }
      const data = (await resp.json()) as MetahubResponse;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e instanceof BadGatewayError) throw e;
      logger.error(`Metahub search failed for query "${query}"`, e);
      throw new BadGatewayError(ErrorCode.SERVICE_ERROR);
    }
  }
}

const metahubInstance = new MetahubClient();
export { metahubInstance as metahubClient };
export default metahubInstance;
