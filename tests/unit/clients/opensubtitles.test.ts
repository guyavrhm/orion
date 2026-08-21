import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenSubtitlesClient, openSubtitlesClient } from '../../../src/main/clients/opensubtitles.js';

describe('OpenSubtitlesClient', () => {
  let client: OpenSubtitlesClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new OpenSubtitlesClient();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchSubtitles by hash and size (searchSubtitlesByHash)', () => {
    it('should query subtitles endpoint using videoHash and videoSize for movies', async () => {
      const mockSubtitles = [
        {
          idSubMovieHash: 'sub-1',
          lang: 'eng',
          m: 'hash',
          url: 'https://dl.opensubtitles.org/sub/1.srt',
          format: 'srt',
          fps: 23.976
        },
        {
          idSubImdb: 'sub-2',
          lang: 'spa',
          m: 'hash',
          url: 'https://dl.opensubtitles.org/sub/2.srt',
          format: 'srt'
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ subtitles: mockSubtitles })
      });

      const result = await client.fetchSubtitles(
        'tt0063350',
        'tt0063350',
        'movie',
        null,
        null,
        'Night.of.the.Living.Dead.1080p',
        '8e245d9679d31e12',
        '2147483648'
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://opensubtitles-v3.strem.io/subtitles/movie/tt0063350/videoHash=8e245d9679d31e12&videoSize=2147483648.json',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('sub-1');
      expect(result[0].lang).toBe('eng');
      expect(result[0].matchType).toBe('hash');
      expect(result[0].format).toBe('srt');
      expect(result[1].id).toBe('sub-2');
    });

    it('should format series endpoint with season and episode when searching by hash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          subtitles: [
            {
              id: 'sub-series-1',
              lang: 'eng',
              url: 'https://dl.opensubtitles.org/series1.srt'
            }
          ]
        })
      });

      const result = await client.fetchSubtitles(
        'tt0055662_s1_e1',
        'tt0055662',
        'series',
        1,
        1,
        'The.Beverly.Hillbillies.S01E01.720p',
        'abcdef1234567890',
        '1048576000'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://opensubtitles-v3.strem.io/subtitles/series/tt0055662:1:1/videoHash=abcdef1234567890&videoSize=1048576000.json',
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('sub-series-1');
      expect(result[0].format).toBe('srt'); // default format fallback
    });
  });

  describe('fetchSubtitles by query/title (searchSubtitlesByQuery)', () => {
    it('should format title replacing spaces with dots and URI encoding', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          subtitles: [
            {
              id: 'sub-title-1',
              lang: 'eng',
              url: 'https://dl.opensubtitles.org/sub/title1.srt'
            }
          ]
        })
      });

      await client.fetchSubtitles(
        'tt0013442',
        'tt0013442',
        'movie',
        null,
        null,
        'Nosferatu 1922 1080p BluRay x264'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://opensubtitles-v3.strem.io/subtitles/movie/tt0013442/filename=Nosferatu.1922.1080p.BluRay.x264.json',
        expect.any(Object)
      );
    });

    it('should take first line of multiline torrent title', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ subtitles: [] })
      });

      await client.fetchSubtitles(
        'tt1375666',
        'tt1375666',
        'movie',
        null,
        null,
        'Movie Title Line 1\nSecond Line Ignored\nThird Line'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://opensubtitles-v3.strem.io/subtitles/movie/tt1375666/filename=Movie.Title.Line.1.json',
        expect.any(Object)
      );
    });

    it('should handle undefined or empty torrentTitle gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ subtitles: [] })
      });

      await client.fetchSubtitles(
        'tt1375666',
        'tt1375666',
        'movie'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://opensubtitles-v3.strem.io/subtitles/movie/tt1375666/filename=.json',
        expect.any(Object)
      );
    });
  });

  describe('Response normalization and error / rate limit handling', () => {
    it('should normalize subtitles with ID fallbacks (idSubMovieHash, idSubImdb, id)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          subtitles: [
            { idSubMovieHash: 'hash-id', lang: 'fre', url: 'https://sub.org/1' },
            { idSubImdb: 'imdb-sub-id', lang: 'ger', url: 'https://sub.org/2' },
            { id: 'generic-id', lang: 'ita', url: 'https://sub.org/3' },
            { lang: 'jpn', url: 'https://sub.org/4' } // no id
          ]
        })
      });

      const results = await client.fetchSubtitles('tt1234567', 'tt1234567', 'movie');

      expect(results).toHaveLength(4);
      expect(results[0].id).toBe('hash-id');
      expect(results[1].id).toBe('imdb-sub-id');
      expect(results[2].id).toBe('generic-id');
      expect(results[3].id).toBe('');
    });

    it('should return empty array on 429 Rate Limited response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      });

      const results = await client.fetchSubtitles('tt0111161', 'tt0111161', 'movie');
      expect(results).toEqual([]);
    });

    it('should return empty array on 500 Server Error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      const results = await client.fetchSubtitles('tt0111161', 'tt0111161', 'movie');
      expect(results).toEqual([]);
    });

    it('should return empty array on 404 Not Found response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const results = await client.fetchSubtitles('tt0000000', 'tt0000000', 'movie');
      expect(results).toEqual([]);
    });

    it('should return empty array when API response body does not contain subtitles array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({})
      });

      const results = await client.fetchSubtitles('tt0111161', 'tt0111161', 'movie');
      expect(results).toEqual([]);
    });

    it('should return empty array on network failure without throwing', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

      const results = await client.fetchSubtitles('tt0111161', 'tt0111161', 'movie');
      expect(results).toEqual([]);
    });
  });

  describe('singleton export', () => {
    it('openSubtitlesClient should be an instance of OpenSubtitlesClient', () => {
      expect(openSubtitlesClient).toBeInstanceOf(OpenSubtitlesClient);
    });
  });
});
