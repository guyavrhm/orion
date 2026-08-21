import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CinemetaClient, cinemetaClient } from '../../../src/main/clients/cinemeta.js';
import { BadGatewayError, NotFoundError } from '../../../src/main/utils/errors.js';
import { ErrorCode } from '../../../src/main/types/index.js';

describe('CinemetaClient', () => {
  let client: CinemetaClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new CinemetaClient();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchPopularMovies (getPopularMovies)', () => {
    it('should fetch and return popular movies from Cinemeta catalogs API', async () => {
      const mockMovies = [
        {
          id: 'tt0063350',
          name: 'Night of the Living Dead',
          type: 'movie' as const,
          year: '1968',
          poster: 'https://images.metahub.space/poster/medium/tt0063350/img.jpg',
          imdbRating: '7.8',
          genres: ['Horror']
        },
        {
          id: 'tt0013442',
          name: 'Nosferatu',
          type: 'movie' as const,
          year: '1922',
          poster: 'https://images.metahub.space/poster/medium/tt0013442/img.jpg',
          imdbRating: '7.9',
          genres: ['Horror', 'Mystery']
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ metas: mockMovies })
      });

      const result = await client.fetchPopularMovies();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result).toEqual(mockMovies);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tt0063350');
    });

    it('should return empty array when metas field is missing or undefined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({})
      });

      const result = await client.fetchPopularMovies();
      expect(result).toEqual([]);
    });

    it('should throw BadGatewayError with SERVICE_ERROR code when response is not ok (e.g. 500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      try {
        await client.fetchPopularMovies();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BadGatewayError);
        expect((err as BadGatewayError).code).toBe(ErrorCode.SERVICE_ERROR);
      }
    });

    it('should throw BadGatewayError on network failure / fetch rejection', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network connection refused'));

      await expect(client.fetchPopularMovies()).rejects.toThrow(BadGatewayError);
    });

    it('should throw BadGatewayError on timeout abort', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(client.fetchPopularMovies()).rejects.toThrow(BadGatewayError);
    });
  });

  describe('fetchPopularShows (getPopularShows)', () => {
    it('should fetch and return popular TV series catalog', async () => {
      const mockShows = [
        {
          id: 'tt0055662',
          name: 'The Beverly Hillbillies',
          type: 'series' as const,
          year: '1962-1971',
          poster: 'https://images.metahub.space/poster/medium/tt0055662/img.jpg',
          imdbRating: '7.2',
          genres: ['Comedy']
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ metas: mockShows })
      });

      const result = await client.fetchPopularShows();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://cinemeta-catalogs.strem.io/top/catalog/series/top.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result).toEqual(mockShows);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('The Beverly Hillbillies');
    });

    it('should return empty array when metas is empty in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ metas: [] })
      });

      const result = await client.fetchPopularShows();
      expect(result).toEqual([]);
    });

    it('should throw BadGatewayError on 502 Bad Gateway response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway'
      });

      await expect(client.fetchPopularShows()).rejects.toThrow(BadGatewayError);
    });

    it('should throw BadGatewayError when network throws', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(client.fetchPopularShows()).rejects.toThrow(BadGatewayError);
    });
  });

  describe('fetchMetadataDetails (getMediaDetails)', () => {
    it('should fetch and normalize movie metadata details correctly', async () => {
      const rawMeta = {
        imdb_id: 'tt0056923',
        id: 'tt0056923',
        type: 'movie',
        name: 'Charade',
        year: '1963',
        genres: ['Comedy', 'Mystery', 'Romance'],
        poster: 'https://images.metahub.space/poster/medium/tt0056923/img.jpg',
        background: 'https://images.metahub.space/background/medium/tt0056923/img.jpg',
        logo: 'https://images.metahub.space/logo/medium/tt0056923/img.png',
        imdbRating: '7.9',
        runtime: '113 min',
        description: 'A woman is pursued by several men who want a fortune her murdered husband had stolen.',
        cast: ['Cary Grant', 'Audrey Hepburn', 'Walter Matthau'],
        director: ['Stanley Donen']
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: rawMeta })
      });

      const result = await client.fetchMetadataDetails('tt0056923', 'movie');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://v3-cinemeta.strem.io/meta/movie/tt0056923.json',
        expect.any(Object)
      );
      expect(result.id).toBe('tt0056923');
      expect(result.type).toBe('movie');
      expect(result.genres).toEqual(['Comedy', 'Mystery', 'Romance']);
      expect(result.name).toBe('Charade');
      expect(result.cast).toHaveLength(3);
    });

    it('should fetch and normalize series metadata details with videos/episodes', async () => {
      const rawMeta = {
        id: 'tt0032475',
        type: 'series',
        name: 'Flash Gordon Conquers the Universe',
        year: '1940',
        genre: ['Action', 'Adventure', 'Sci-Fi'],
        videos: [
          {
            id: 'tt0032475:1:1',
            name: 'The Purple Death',
            season: 1,
            episode: 1,
            thumbnail: 'https://episodes.metahub.space/1/1.jpg'
          },
          {
            id: 'tt0032475:1:2',
            name: 'Freezing Torture',
            season: 1,
            episode: 2,
            thumbnail: 'https://episodes.metahub.space/1/2.jpg'
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: rawMeta })
      });

      const result = await client.fetchMetadataDetails('tt0032475', 'series');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://v3-cinemeta.strem.io/meta/series/tt0032475.json',
        expect.any(Object)
      );
      expect(result.id).toBe('tt0032475');
      expect(result.type).toBe('series');
      // genre normalized to genres
      expect(result.genres).toEqual(['Action', 'Adventure', 'Sci-Fi']);
      expect(result.videos).toHaveLength(2);
      expect(result.videos?.[0].name).toBe('The Purple Death');
    });

    it('should normalize ID from imdb_id, id, or requested parameter fallback', async () => {
      // Missing id in meta payload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: { name: 'No ID Movie' } })
      });

      const result = await client.fetchMetadataDetails('tt9999999', 'movie');
      expect(result.id).toBe('tt9999999');
      expect(result.type).toBe('movie');
      expect(result.genres).toEqual([]);
    });

    it('should handle missing poster, backdrop/background, cast, description without error', async () => {
      const minimalMeta = {
        id: 'tt1234567',
        name: 'Minimal Movie'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: minimalMeta })
      });

      const result = await client.fetchMetadataDetails('tt1234567', 'movie');
      expect(result.id).toBe('tt1234567');
      expect(result.name).toBe('Minimal Movie');
      expect(result.poster).toBeUndefined();
      expect(result.background).toBeUndefined();
      expect(result.cast).toBeUndefined();
      expect(result.genres).toEqual([]);
    });

    it('should handle empty or null meta response object gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ meta: null })
      });

      const result = await client.fetchMetadataDetails('tt7654321', 'movie');
      expect(result.id).toBe('tt7654321');
      expect(result.type).toBe('movie');
      expect(result.genres).toEqual([]);
    });

    it('should throw NotFoundError when API returns 404 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      try {
        await client.fetchMetadataDetails('tt0000000', 'movie');
        expect.unreachable('Should have thrown NotFoundError');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        expect((err as NotFoundError).code).toBe(ErrorCode.MEDIA_NOT_FOUND);
      }
    });

    it('should throw BadGatewayError when API returns 500 error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error'
      });

      try {
        await client.fetchMetadataDetails('tt1234567', 'movie');
        expect.unreachable('Should have thrown BadGatewayError');
      } catch (err) {
        expect(err).toBeInstanceOf(BadGatewayError);
        expect((err as BadGatewayError).code).toBe(ErrorCode.SERVICE_ERROR);
      }
    });

    it('should throw BadGatewayError when fetch rejects with network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('DNS resolution failed'));

      await expect(client.fetchMetadataDetails('tt1234567', 'movie')).rejects.toThrow(BadGatewayError);
    });
  });

  describe('singleton export', () => {
    it('cinemetaClient should be an instance of CinemetaClient', () => {
      expect(cinemetaClient).toBeInstanceOf(CinemetaClient);
    });
  });
});
