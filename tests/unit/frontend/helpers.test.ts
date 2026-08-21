import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatRuntime,
  extractYear,
  buildMetadataHtml,
  buildEpisodeMetadataHtml,
  getDownloadErrorMessage,
  isDesktop,
  setupScrollHover
} from '../../../src/renderer/utils/helpers.js';
import { ErrorCode } from '../../../src/renderer/utils/constants.js';

describe('Frontend Helpers (renderer/utils/helpers.js)', () => {
  describe('formatTime', () => {
    it('should format 0, NaN, and invalid inputs as 0:00', () => {
      expect(formatTime(0)).toBe('0:00');
      expect(formatTime(NaN)).toBe('0:00');
      expect(formatTime(undefined as any)).toBe('0:00');
      expect(formatTime(null as any)).toBe('0:00');
    });

    it('should format seconds under one minute with padding', () => {
      expect(formatTime(5)).toBe('0:05');
      expect(formatTime(30)).toBe('0:30');
      expect(formatTime(59)).toBe('0:59');
    });

    it('should format minutes and seconds without hours when < 3600s', () => {
      expect(formatTime(60)).toBe('1:00');
      expect(formatTime(65)).toBe('1:05');
      expect(formatTime(750)).toBe('12:30');
      expect(formatTime(3599)).toBe('59:59');
    });

    it('should format hours, minutes, and seconds when >= 3600s', () => {
      expect(formatTime(3600)).toBe('1:00:00');
      expect(formatTime(3665)).toBe('1:01:05');
      expect(formatTime(7322)).toBe('2:02:02');
      expect(formatTime(36000)).toBe('10:00:00');
    });
  });

  describe('formatRuntime', () => {
    it('should return empty string for null, undefined, empty, or 0', () => {
      expect(formatRuntime(null)).toBe('');
      expect(formatRuntime(undefined)).toBe('');
      expect(formatRuntime('')).toBe('');
      expect(formatRuntime(0)).toBe('');
    });

    it('should format minutes under one hour', () => {
      expect(formatRuntime(25)).toBe('25m');
      expect(formatRuntime('45')).toBe('45m');
      expect(formatRuntime(59)).toBe('59m');
    });

    it('should format hours and minutes for durations >= 60 minutes', () => {
      expect(formatRuntime(60)).toBe('1h 0m');
      expect(formatRuntime(90)).toBe('1h 30m');
      expect(formatRuntime(148)).toBe('2h 28m');
      expect(formatRuntime('120 min')).toBe('2h 0m');
    });

    it('should return non-numeric strings as is', () => {
      expect(formatRuntime('Unknown runtime')).toBe('Unknown runtime');
    });
  });

  describe('extractYear', () => {
    it('should return empty string for null, undefined, or empty values', () => {
      expect(extractYear(null)).toBe('');
      expect(extractYear(undefined)).toBe('');
      expect(extractYear('')).toBe('');
    });

    it('should extract 4-digit years from dates or strings', () => {
      expect(extractYear('2023-08-15')).toBe('2023');
      expect(extractYear('1994')).toBe('1994');
      expect(extractYear('Released in 2008')).toBe('2008');
      expect(extractYear(2010)).toBe('2010');
    });

    it('should return empty string if no valid 4-digit year is present', () => {
      expect(extractYear('Season 1')).toBe('');
      expect(extractYear('abc')).toBe('');
    });
  });

  describe('buildMetadataHtml', () => {
    it('should return empty string if item is null or undefined', () => {
      expect(buildMetadataHtml(null)).toBe('');
      expect(buildMetadataHtml(undefined)).toBe('');
    });

    it('should format movie metadata with type, genre, year, runtime, and star rating', () => {
      const movieItem = {
        type: 'movie',
        genres: ['Action', 'Adventure'],
        year: '2010',
        runtime: 148,
        imdbRating: '8.8'
      };

      const html = buildMetadataHtml(movieItem);
      expect(html).toContain('<span>Movie</span>');
      expect(html).toContain('<span>Action</span>');
      expect(html).toContain('<span>2010</span>');
      expect(html).toContain('<span>2h 28m</span>');
      expect(html).toContain('<span>8.8 <i class="fa-solid fa-star"></i></span>');
      expect(html).toContain('<span class="dot">•</span>');
    });

    it('should format series metadata with type Series and genre fallback', () => {
      const showItem = {
        type: 'series',
        genre: ['Drama'],
        year: '2008',
        rating: '9.5'
      };

      const html = buildMetadataHtml(showItem);
      expect(html).toContain('<span>Series</span>');
      expect(html).toContain('<span>Drama</span>');
      expect(html).toContain('<span>2008</span>');
      expect(html).toContain('<span>9.5 <i class="fa-solid fa-star"></i></span>');
    });

    it('should include episode title when options.includeEpisodeTitle is set', () => {
      const showItem = {
        type: 'series',
        season: 1,
        episode: 1,
        episodeTitle: 'Pilot',
        videos: [
          { season: 1, episode: 1, title: 'Pilot', released: '2008-01-20', runtime: 58 }
        ]
      };

      const html = buildMetadataHtml(showItem, { includeEpisodeTitle: true });
      expect(html).toContain('S1 E1:');
      expect(html).toContain('Pilot');
    });
  });

  describe('buildEpisodeMetadataHtml', () => {
    it('should return empty string if episode is null or undefined', () => {
      expect(buildEpisodeMetadataHtml(null)).toBe('');
      expect(buildEpisodeMetadataHtml(undefined)).toBe('');
    });

    it('should format episode metadata with year, runtime, and rating with fallback to show', () => {
      const ep = {
        season: 1,
        episode: 1,
        released: '2008-01-20',
        runtime: 58,
        rating: '9.0'
      };
      const show = {
        year: '2008',
        runtime: 45
      };

      const html = buildEpisodeMetadataHtml(ep, show);
      expect(html).toContain('<span>2008</span>');
      expect(html).toContain('<span>58m</span>');
      expect(html).toContain('<span>9.0 <i class="fa-solid fa-star"></i></span>');
    });

    it('should fallback to show year and runtime if missing from episode', () => {
      const ep = {
        season: 2,
        episode: 1
      };
      const show = {
        year: '2009',
        runtime: 45
      };

      const html = buildEpisodeMetadataHtml(ep, show);
      expect(html).toContain('<span>2009</span>');
      expect(html).toContain('<span>45m</span>');
    });
  });

  describe('getDownloadErrorMessage', () => {
    it('should return custom descriptive error messages for known error codes', () => {
      expect(getDownloadErrorMessage(ErrorCode.PROVIDER_NOT_CONFIGURED))
        .toBe('Torrent provider is not configured. Please check server settings in .env.');

      expect(getDownloadErrorMessage(ErrorCode.PROVIDER_UNAVAILABLE))
        .toBe('Torrent provider is temporarily unavailable or timed out. Please try again later.');

      expect(getDownloadErrorMessage(ErrorCode.NO_STREAMS_FOUND))
        .toBe('No torrent streams found for this title.');

      expect(getDownloadErrorMessage(ErrorCode.MEDIA_NOT_DOWNLOADED))
        .toBe('Media is not downloaded yet.');
    });

    it('should return generic error message for unknown or null error codes', () => {
      expect(getDownloadErrorMessage('UNKNOWN_ERROR_CODE' as any))
        .toBe('Failed to start download. Please try again later.');
      expect(getDownloadErrorMessage(null as any))
        .toBe('Failed to start download. Please try again later.');
    });
  });

  describe('isDesktop and setupScrollHover', () => {
    it('should detect desktop via matchMedia', () => {
      const mockMatchMedia = vi.fn().mockReturnValue({ matches: true });
      vi.stubGlobal('window', { matchMedia: mockMatchMedia });

      expect(isDesktop()).toBe(true);
      expect(mockMatchMedia).toHaveBeenCalledWith('(hover: hover)');

      mockMatchMedia.mockReturnValueOnce({ matches: false });
      expect(isDesktop()).toBe(false);
    });

    it('should attach mousemove and mouseleave event listeners for scroll hover', () => {
      const listeners: Record<string, Function> = {};
      const mockContainer = {
        addEventListener: vi.fn((event, handler) => {
          listeners[event] = handler;
        }),
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 400 }),
        scrollLeft: 0
      };

      const mockDocument = {
        getElementById: vi.fn().mockReturnValue(mockContainer)
      };

      const mockWindow = {
        matchMedia: () => ({ matches: true }),
        getComputedStyle: () => ({ flexDirection: 'row' })
      };

      vi.stubGlobal('document', mockDocument);
      vi.stubGlobal('window', mockWindow);

      setupScrollHover('test-container');

      expect(mockDocument.getElementById).toHaveBeenCalledWith('test-container');
      expect(mockContainer.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(mockContainer.addEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));

      // Trigger mouseleave
      expect(() => listeners['mouseleave']?.()).not.toThrow();
    });

    it('should return early if container element is not found or not desktop', () => {
      const mockDocument = {
        getElementById: vi.fn().mockReturnValue(null)
      };
      vi.stubGlobal('document', mockDocument);

      expect(() => setupScrollHover('non-existent-container')).not.toThrow();
    });
  });
});
