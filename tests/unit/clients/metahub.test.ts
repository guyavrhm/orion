import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetahubClient, metahubClient } from '../../../src/main/clients/metahub.js';
import { BadGatewayError } from '../../../src/main/utils/errors.js';
import { ErrorCode } from '../../../src/main/types/index.js';

describe('MetahubClient', () => {
  let client: MetahubClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new MetahubClient();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchMetahub', () => {
    it('should search for media and return matched items', async () => {
      const mockResults = [
        {
          id: 'tt0063350',
          imdb_id: 'tt0063350',
          name: 'Night of the Living Dead',
          type: 'movie' as const,
          year: '1968',
          poster: 'https://images.metahub.space/poster/medium/tt0063350/img.jpg',
          background: 'https://images.metahub.space/background/medium/tt0063350/img.jpg',
          logo: 'https://images.metahub.space/logo/medium/tt0063350/img.png',
          description: 'A disparate group of individuals take refuge in an abandoned house...',
          genres: ['Horror']
        },
        {
          id: 'tt0052077',
          imdb_id: 'tt0052077',
          name: 'Plan 9 from Outer Space',
          type: 'movie' as const,
          year: '1957',
          poster: 'https://images.metahub.space/poster/medium/tt0052077/img.jpg',
          genres: ['Horror', 'Sci-Fi']
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResults
      });

      const results = await client.searchMetahub('Night of the Living Dead');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.metahub.space/api/search?q=Night%20of%20the%20Living%20Dead',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(results).toEqual(mockResults);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('tt0063350');
      expect(results[0].type).toBe('movie');
      expect(results[0].year).toBe('1968');
    });

    it('should correctly parse both movie and series types in results', async () => {
      const mockMixedResults = [
        {
          id: 'tt0032475',
          imdb_id: 'tt0032475',
          name: 'Flash Gordon Conquers the Universe',
          type: 'series' as const,
          year: '1940',
          genres: ['Action', 'Adventure', 'Sci-Fi']
        },
        {
          id: 'tt0052077',
          imdb_id: 'tt0052077',
          name: 'Plan 9 from Outer Space',
          type: 'movie' as const,
          year: '1957',
          genres: ['Horror', 'Sci-Fi']
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockMixedResults
      });

      const results = await client.searchMetahub('Flash Gordon');

      expect(results).toHaveLength(2);
      const seriesItem = results.find(item => item.type === 'series');
      const movieItem = results.find(item => item.type === 'movie');

      expect(seriesItem).toBeDefined();
      expect(seriesItem?.name).toBe('Flash Gordon Conquers the Universe');
      expect(seriesItem?.year).toBe('1940');

      expect(movieItem).toBeDefined();
      expect(movieItem?.name).toBe('Plan 9 from Outer Space');
      expect(movieItem?.year).toBe('1957');
    });

    it('should properly encode special characters and query strings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });

      await client.searchMetahub('Sherlock Holmes & Dr. Watson: Part 2? + 100%');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.metahub.space/api/search?q=Sherlock%20Holmes%20%26%20Dr.%20Watson%3A%20Part%202%3F%20%2B%20100%25',
        expect.any(Object)
      );
    });

    it('should return empty array if API responds with non-array payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error: 'not found', results: null })
      });

      const results = await client.searchMetahub('NonExistentTitle98765');
      expect(results).toEqual([]);
    });

    it('should return empty array when API returns null or undefined response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => null
      });

      const results = await client.searchMetahub('Random Query');
      expect(results).toEqual([]);
    });

    it('should throw BadGatewayError when API responds with HTTP 500 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      try {
        await client.searchMetahub('Query');
        expect.unreachable('Should have thrown BadGatewayError');
      } catch (err) {
        expect(err).toBeInstanceOf(BadGatewayError);
        expect((err as BadGatewayError).code).toBe(ErrorCode.SERVICE_ERROR);
      }
    });

    it('should throw BadGatewayError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection reset by peer'));

      await expect(client.searchMetahub('Query')).rejects.toThrow(BadGatewayError);
    });

    it('should throw BadGatewayError on request abort timeout', async () => {
      const abortError = new Error('AbortError: The operation was aborted');
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.searchMetahub('Query')).rejects.toThrow(BadGatewayError);
    });
  });

  describe('singleton export', () => {
    it('metahubClient should be an instance of MetahubClient', () => {
      expect(metahubClient).toBeInstanceOf(MetahubClient);
    });
  });
});
