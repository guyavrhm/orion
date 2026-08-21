import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../src/main/db/index.js';
import {
  metadataRepo,
  rebuildMovieMetadata,
  rebuildShowMetadata
} from '../../../src/main/db/metadata.js';
import type { MovieMetadataRow, ShowMetadataRow, EpisodeMetadataRow } from '../../../src/main/types/index.js';

describe('db/metadata - MetadataRepo', () => {
  beforeEach(() => {
    // Clear all metadata tables before each test
    db.exec(`
      DELETE FROM movie_downloads;
      DELETE FROM episode_downloads;
      DELETE FROM movie_progress;
      DELETE FROM episode_progress;
      DELETE FROM episode_metadata;
      DELETE FROM show_metadata;
      DELETE FROM movie_metadata;
    `);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rebuildMovieMetadata helper', () => {
    it('should return null when row is null or undefined', () => {
      expect(rebuildMovieMetadata(null)).toBeNull();
      expect(rebuildMovieMetadata(undefined)).toBeNull();
    });

    it('should correctly rebuild movie metadata with parsed arrays', () => {
      const row: MovieMetadataRow = {
        id: 'tt0056923',
        title: 'Charade',
        year: '1963',
        released: '1963-12-05',
        genres: 'Comedy,Mystery',
        poster: 'https://image.tmdb.org/poster.jpg',
        background: 'https://image.tmdb.org/backdrop.jpg',
        logo: 'https://image.tmdb.org/logo.png',
        imdb_rating: '7.9',
        runtime: '113 min',
        description: 'A woman is pursued by several men...',
        awards: 'Nominated for 1 Oscar',
        cast: 'Cary Grant,Audrey Hepburn,Walter Matthau',
        director: 'Stanley Donen',
        writer: 'Peter Stone',
        country: 'United States',
        dvdRelease: '2001-01-01',
        moviedb_id: 4808,
        popularity: 75.5,
        last_fetched: 1700000000000
      };

      const result = rebuildMovieMetadata(row);
      expect(result).toEqual({
        id: 'tt0056923',
        type: 'movie',
        name: 'Charade',
        title: 'Charade',
        year: '1963',
        released: '1963-12-05',
        genres: ['Comedy', 'Mystery'],
        poster: 'https://image.tmdb.org/poster.jpg',
        background: 'https://image.tmdb.org/backdrop.jpg',
        logo: 'https://image.tmdb.org/logo.png',
        imdbRating: '7.9',
        runtime: '113 min',
        description: 'A woman is pursued by several men...',
        awards: 'Nominated for 1 Oscar',
        cast: ['Cary Grant', 'Audrey Hepburn', 'Walter Matthau'],
        director: ['Stanley Donen'],
        writer: ['Peter Stone'],
        country: 'United States',
        dvdRelease: '2001-01-01',
        moviedb_id: 4808,
        popularity: 75.5
      });
    });

    it('should handle rows with empty or null string fields', () => {
      const row: MovieMetadataRow = {
        id: 'tt9999999',
        title: null,
        year: null,
        released: null,
        genres: null,
        poster: null,
        background: null,
        logo: null,
        imdb_rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: null,
        director: null,
        writer: null,
        country: null,
        dvdRelease: null,
        moviedb_id: null,
        popularity: null,
        last_fetched: null
      };

      const result = rebuildMovieMetadata(row);
      expect(result).toEqual({
        id: 'tt9999999',
        type: 'movie',
        name: undefined,
        title: undefined,
        year: undefined,
        released: undefined,
        genres: [],
        poster: undefined,
        background: undefined,
        logo: undefined,
        imdbRating: undefined,
        runtime: undefined,
        description: undefined,
        awards: undefined,
        cast: [],
        director: [],
        writer: [],
        country: undefined,
        dvdRelease: undefined,
        moviedb_id: null,
        popularity: null
      });
    });
  });

  describe('rebuildShowMetadata helper', () => {
    it('should return null when show row is null or undefined', () => {
      expect(rebuildShowMetadata(null)).toBeNull();
      expect(rebuildShowMetadata(undefined)).toBeNull();
    });

    it('should correctly rebuild show metadata with nested video episode items', () => {
      const showRow: ShowMetadataRow = {
        id: 'tt0032475',
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        released: '1940-03-03',
        genres: 'Action,Adventure,Sci-Fi',
        poster: 'poster.jpg',
        background: 'bg.jpg',
        logo: 'logo.png',
        imdb_rating: '7.4',
        runtime: '20 min',
        description: 'Flash Gordon travels to the planet Mongo...',
        awards: 'Historic Serial',
        cast: 'Buster Crabbe,Carol Hughes',
        director: 'Ford Beebe,Ray Taylor',
        writer: 'Alex Raymond',
        country: 'United States',
        status: 'Ended',
        tvdb_id: 79123,
        moviedb_id: 1234,
        popularity: 60.0,
        last_fetched: 1700000000000
      };

      const epRows: EpisodeMetadataRow[] = [
        {
          id: 'tt0032475_s1_e1',
          show_id: 'tt0032475',
          season: 1,
          episode: 1,
          name: 'The Purple Death',
          description: 'A mysterious death threatens Earth...',
          thumbnail: 'ep1.jpg',
          released: '1940-03-03',
          rating: '7.8',
          tvdb_id: 3254641,
          runtime: 20
        },
        {
          id: 'tt0032475_s1_e2',
          show_id: 'tt0032475',
          season: 1,
          episode: 2,
          name: 'Freezing Torture',
          description: 'Flash and his crew battle the cold...',
          thumbnail: 'ep2.jpg',
          released: '1940-03-10',
          rating: '7.5',
          tvdb_id: 3436411,
          runtime: 20
        }
      ];

      const result = rebuildShowMetadata(showRow, epRows);
      expect(result).toEqual({
        id: 'tt0032475',
        type: 'series',
        name: 'Flash Gordon Conquers the Universe',
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        released: '1940-03-03',
        genres: ['Action', 'Adventure', 'Sci-Fi'],
        poster: 'poster.jpg',
        background: 'bg.jpg',
        logo: 'logo.png',
        imdbRating: '7.4',
        runtime: '20 min',
        description: 'Flash Gordon travels to the planet Mongo...',
        awards: 'Historic Serial',
        cast: ['Buster Crabbe', 'Carol Hughes'],
        director: ['Ford Beebe', 'Ray Taylor'],
        writer: ['Alex Raymond'],
        country: 'United States',
        status: 'Ended',
        tvdb_id: 79123,
        moviedb_id: 1234,
        popularity: 60.0,
        videos: [
          {
            id: 'tt0032475:1:1',
            name: 'The Purple Death',
            season: 1,
            episode: 1,
            number: 1,
            firstAired: '1940-03-03',
            released: '1940-03-03',
            tvdb_id: 3254641,
            rating: '7.8',
            overview: 'A mysterious death threatens Earth...',
            description: 'A mysterious death threatens Earth...',
            thumbnail: 'ep1.jpg',
            runtime: 20
          },
          {
            id: 'tt0032475:1:2',
            name: 'Freezing Torture',
            season: 1,
            episode: 2,
            number: 2,
            firstAired: '1940-03-10',
            released: '1940-03-10',
            tvdb_id: 3436411,
            rating: '7.5',
            overview: 'Flash and his crew battle the cold...',
            description: 'Flash and his crew battle the cold...',
            thumbnail: 'ep2.jpg',
            runtime: 20
          }
        ]
      });
    });
  });

  describe('Movie Metadata Caching & Retrieval', () => {
    it('should return null for non-cached movie ID', () => {
      const result = metadataRepo.getCachedMetadata('tt_nonexistent');
      expect(result).toBeNull();
    });

    it('should save and retrieve movie metadata accurately', () => {
      const movieData = {
        name: 'Night of the Living Dead',
        year: '1968',
        genres: ['Horror'],
        poster: 'https://example.com/poster.jpg',
        background: 'https://example.com/bg.jpg',
        logo: 'https://example.com/logo.png',
        imdbRating: '7.8',
        runtime: '96 min',
        description: 'A disparate group of individuals take refuge...',
        awards: 'Cult Classic',
        cast: ['Duane Jones', 'Judith ODea'],
        director: ['George A. Romero'],
        writer: ['John A. Russo'],
        country: 'United States',
        dvdRelease: '1997-10-07',
        moviedb_id: 10331,
        popularity: 78.2
      };

      metadataRepo.saveCachedMetadata('tt0063350', 'movie', movieData);

      const cached = metadataRepo.getCachedMetadata('tt0063350');
      expect(cached).not.toBeNull();
      expect(cached?.id).toBe('tt0063350');
      expect(cached?.type).toBe('movie');
      expect(cached?.status).toBe('movie');
      expect(cached?.metadata?.name).toBe('Night of the Living Dead');
      expect(cached?.metadata?.runtime).toBe('96 min');
      expect(cached?.metadata?.genres).toEqual(['Horror']);
      expect(cached?.metadata?.cast).toEqual(['Duane Jones', 'Judith ODea']);
      expect(cached?.metadata?.director).toEqual(['George A. Romero']);
      expect(cached?.metadata?.moviedb_id).toBe(10331);
    });

    it('should not overwrite existing cached movie (movies never expire)', () => {
      const initialMovie = {
        name: 'Metropolis',
        runtime: '153 min',
        cast: ['Brigitte Helm']
      };

      metadataRepo.saveCachedMetadata('tt0017136', 'movie', initialMovie);
      const firstCached = metadataRepo.getCachedMetadata('tt0017136');

      // Attempt to save new title
      const updatedMovie = {
        name: 'Metropolis Updated',
        runtime: '153 min',
        cast: ['Brigitte Helm']
      };
      metadataRepo.saveCachedMetadata('tt0017136', 'movie', updatedMovie);

      const secondCached = metadataRepo.getCachedMetadata('tt0017136');
      expect(secondCached?.metadata?.name).toBe('Metropolis');
      expect(secondCached?.last_fetched).toBe(firstCached?.last_fetched);
    });
  });

  describe('Show & Episode Metadata Caching & Retrieval', () => {
    it('should save and retrieve show metadata and its nested episodes', () => {
      const showData = {
        name: 'The Beverly Hillbillies',
        year: '1962-1971',
        genres: ['Comedy'],
        poster: 'tbh_poster.jpg',
        background: 'tbh_bg.jpg',
        logo: 'tbh_logo.png',
        imdbRating: '7.2',
        runtime: '25 min',
        description: 'A poor woodsman discovers oil...',
        awards: 'Nominated for 4 Emmys',
        cast: ['Buddy Ebsen', 'Donna Douglas'],
        director: ['Richard Whorf'],
        writer: ['Paul Henning'],
        country: 'United States',
        tvdb_id: 76092,
        moviedb_id: 2470,
        popularity: 50.5,
        videos: [
          {
            season: 1,
            episode: 1,
            title: 'The Clampetts Strike Oil',
            overview: 'Jed Clampett finds oil on his land...',
            thumbnail: 'tbh_s1e1.jpg',
            released: '1962-09-26',
            rating: '7.5',
            tvdb_id: 172901,
            runtime: 25
          },
          {
            season: 1,
            episode: 2,
            number: 2, // fallback for episode
            name: 'Getting Settled', // fallback for title
            description: 'The Clampetts move to Beverly Hills...',
            thumbnail: 'tbh_s1e2.jpg',
            firstAired: '1962-10-03',
            rating: '7.4',
            tvdb_id: 172902,
            runtime: 25
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0055662', 'series', showData, 'Ended');

      const cached = metadataRepo.getCachedMetadata('tt0055662');
      expect(cached).not.toBeNull();
      expect(cached?.id).toBe('tt0055662');
      expect(cached?.type).toBe('series');
      expect(cached?.status).toBe('Ended');
      expect(cached?.metadata?.name).toBe('The Beverly Hillbillies');
      expect(cached?.metadata?.videos).toHaveLength(2);
      expect(cached?.metadata?.videos[0].name).toBe('The Clampetts Strike Oil');
      expect(cached?.metadata?.videos[1].name).toBe('Getting Settled');
    });

    it('should retrieve single episode metadata using getEpisodeMetadataSingle', () => {
      const showData = {
        name: 'The Adventures of Robin Hood',
        year: '1955-1959',
        videos: [
          {
            season: 1,
            episode: 1,
            title: 'The Coming of Robin Hood',
            overview: 'Robin returns to find his estate seized...',
            thumbnail: 'robin_s1e1.jpg',
            released: '1955-09-25',
            rating: '7.8',
            tvdb_id: 12345,
            runtime: 26
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0047706', 'series', showData, 'Ended');

      const ep = metadataRepo.getEpisodeMetadataSingle('tt0047706', 1, 1);
      expect(ep).not.toBeNull();
      expect(ep?.id).toBe('tt0047706_s1_e1');
      expect(ep?.show_id).toBe('tt0047706');
      expect(ep?.season).toBe(1);
      expect(ep?.episode).toBe(1);
      expect(ep?.name).toBe('The Coming of Robin Hood');
      expect(ep?.runtime).toBe(26);

      const nonExistentEp = metadataRepo.getEpisodeMetadataSingle('tt0047706', 2, 1);
      expect(nonExistentEp).toBeNull();
    });

    it('should ignore episodes with non-positive seasons (e.g. season 0 specials)', () => {
      const showData = {
        name: 'Sherlock Holmes',
        videos: [
          { season: 0, episode: 1, title: 'Unaired Pilot' },
          { season: 1, episode: 1, title: 'The Case of the Cunningham Heritage' }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0046642', 'series', showData, 'Ended');

      const cached = metadataRepo.getCachedMetadata('tt0046642');
      expect(cached?.metadata?.videos).toHaveLength(1);
      expect(cached?.metadata?.videos[0].name).toBe('The Case of the Cunningham Heritage');
    });
  });

  describe('Series Expiration Logic', () => {
    it('should not expire ended series', () => {
      const showData = {
        name: 'Bonanza',
        videos: [{ season: 1, episode: 1, title: 'A Rose for Lotta' }]
      };

      metadataRepo.saveCachedMetadata('tt0052451', 'series', showData, 'Ended');

      // Manually simulate last_fetched 30 days ago
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      db.prepare('UPDATE show_metadata SET last_fetched = ? WHERE id = ?').run(thirtyDaysAgo, 'tt0052451');

      // Attempt to save update
      metadataRepo.saveCachedMetadata('tt0052451', 'series', {
        name: 'Bonanza (Updated)'
      }, 'Ended');

      const cached = metadataRepo.getCachedMetadata('tt0052451');
      expect(cached?.metadata?.name).toBe('Bonanza'); // Unchanged
    });

    it('should not expire Continuing series within 24-hour TTL', () => {
      const showData = {
        name: 'Ongoing Show',
        videos: [{ season: 1, episode: 1, title: 'Pilot' }]
      };

      metadataRepo.saveCachedMetadata('tt_continuing_fresh', 'series', showData, 'Continuing');

      // 12 hours ago
      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
      db.prepare('UPDATE show_metadata SET last_fetched = ? WHERE id = ?').run(twelveHoursAgo, 'tt_continuing_fresh');

      metadataRepo.saveCachedMetadata('tt_continuing_fresh', 'series', {
        name: 'Ongoing Show (Attempt Update)'
      }, 'Continuing');

      const cached = metadataRepo.getCachedMetadata('tt_continuing_fresh');
      expect(cached?.metadata?.name).toBe('Ongoing Show'); // Still within TTL, not updated
    });

    it('should expire and refresh Continuing series after 24-hour TTL', () => {
      const showData = {
        name: 'Ongoing Show Expired',
        videos: [{ season: 1, episode: 1, title: 'Pilot' }]
      };

      metadataRepo.saveCachedMetadata('tt_continuing_expired', 'series', showData, 'Continuing');

      // 25 hours ago (> 24 hour TTL)
      const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
      db.prepare('UPDATE show_metadata SET last_fetched = ? WHERE id = ?').run(twentyFiveHoursAgo, 'tt_continuing_expired');

      const updatedData = {
        name: 'Ongoing Show Refreshed',
        videos: [
          { season: 1, episode: 1, title: 'Pilot' },
          { season: 1, episode: 2, title: 'New Episode 2' }
        ]
      };
      metadataRepo.saveCachedMetadata('tt_continuing_expired', 'series', updatedData, 'Continuing');

      const cached = metadataRepo.getCachedMetadata('tt_continuing_expired');
      expect(cached?.metadata?.name).toBe('Ongoing Show Refreshed');
      expect(cached?.metadata?.videos).toHaveLength(2);
    });
  });

  describe('Foreign Key Cascade Deletes', () => {
    it('should cascade delete episode_metadata when show_metadata is deleted', () => {
      const showData = {
        name: 'Show with Cascade',
        videos: [
          { season: 1, episode: 1, title: 'Ep 1' },
          { season: 1, episode: 2, title: 'Ep 2' }
        ]
      };

      metadataRepo.saveCachedMetadata('tt_cascade_show', 'series', showData, 'Ended');

      const epsBefore = db.prepare('SELECT id FROM episode_metadata WHERE show_id = ?').all('tt_cascade_show');
      expect(epsBefore).toHaveLength(2);

      // Delete parent show
      db.prepare('DELETE FROM show_metadata WHERE id = ?').run('tt_cascade_show');

      const epsAfter = db.prepare('SELECT id FROM episode_metadata WHERE show_id = ?').all('tt_cascade_show');
      expect(epsAfter).toHaveLength(0);
    });
  });
});
