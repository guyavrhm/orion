import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../src/main/db/index.js';
import {
  metadataRepo,
  rebuildMovieMetadata,
  rebuildShowMetadata
} from '../../../src/main/db/metadata.js';
import type { MovieMetadata, ShowMetadata } from '../../../src/main/types/index.js';

describe('db/metadata - MetadataRepo', () => {
  beforeEach(() => {
    // Clear all metadata tables before each test
    db.exec(`
      DELETE FROM streams;
      DELETE FROM progress;
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
      const row = {
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

      const result = rebuildMovieMetadata(row as any);
      expect(result).toEqual({
        id: 'tt0056923',
        type: 'movie',
        title: 'Charade',
        year: '1963',
        released: '1963-12-05',
        genres: ['Comedy', 'Mystery'],
        poster: 'https://image.tmdb.org/poster.jpg',
        background: 'https://image.tmdb.org/backdrop.jpg',
        logo: 'https://image.tmdb.org/logo.png',
        rating: '7.9',
        runtime: 113,
        description: 'A woman is pursued by several men...',
        awards: 'Nominated for 1 Oscar',
        cast: ['Cary Grant', 'Audrey Hepburn', 'Walter Matthau'],
        director: ['Stanley Donen'],
        writer: ['Peter Stone'],
        country: 'United States',
        dvdRelease: '2001-01-01',
        moviedb_id: 4808,
        popularity: 75.5,
        last_fetched: 1700000000000
      });
    });

    it('should handle rows with empty or null string fields', () => {
      const row = {
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

      const result = rebuildMovieMetadata(row as any);
      expect(result).toEqual({
        id: 'tt9999999',
        type: 'movie',
        title: '',
        year: null,
        released: null,
        genres: [],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        dvdRelease: null,
        moviedb_id: null,
        popularity: null,
        last_fetched: null
      });
    });
  });

  describe('rebuildShowMetadata helper', () => {
    it('should return null when show row is null or undefined', () => {
      expect(rebuildShowMetadata(null)).toBeNull();
      expect(rebuildShowMetadata(undefined)).toBeNull();
    });

    it('should correctly rebuild show metadata with nested episode items', () => {
      const showRow = {
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

      const epRows = [
        {
          id: 'tt0032475_s1_e1',
          show_id: 'tt0032475',
          season: 1,
          episode: 1,
          title: 'The Purple Death',
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
          title: 'Freezing Torture',
          description: 'Flash and his crew battle the cold...',
          thumbnail: 'ep2.jpg',
          released: '1940-03-10',
          rating: '7.5',
          tvdb_id: 3436411,
          runtime: 20
        }
      ];

      const result = rebuildShowMetadata(showRow as any, epRows as any);
      expect(result).toEqual({
        id: 'tt0032475',
        type: 'show',
        title: 'Flash Gordon Conquers the Universe',
        year: '1940',
        released: '1940-03-03',
        genres: ['Action', 'Adventure', 'Sci-Fi'],
        poster: 'poster.jpg',
        background: 'bg.jpg',
        logo: 'logo.png',
        rating: '7.4',
        runtime: 20,
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
        episodes: [
          {
            id: 'tt0032475_s1_e1',
            show_id: 'tt0032475',
            title: 'The Purple Death',
            season: 1,
            episode: 1,
            released: '1940-03-03',
            tvdb_id: 3254641,
            rating: '7.8',
            description: 'A mysterious death threatens Earth...',
            thumbnail: 'ep1.jpg',
            runtime: 20
          },
          {
            id: 'tt0032475_s1_e2',
            show_id: 'tt0032475',
            title: 'Freezing Torture',
            season: 1,
            episode: 2,
            released: '1940-03-10',
            tvdb_id: 3436411,
            rating: '7.5',
            description: 'Flash and his crew battle the cold...',
            thumbnail: 'ep2.jpg',
            runtime: 20
          }
        ],
        last_fetched: 1700000000000
      });
    });
  });

  describe('Movie Metadata Caching & Retrieval', () => {
    it('should return null for non-cached movie ID', () => {
      const result = metadataRepo.getCachedMetadata('tt_nonexistent');
      expect(result).toBeNull();
    });

    it('should save and retrieve movie metadata accurately', () => {
      const movieData: MovieMetadata = {
        id: 'tt0063350',
        type: 'movie',
        title: 'Night of the Living Dead',
        year: '1968',
        released: '1968-10-01',
        genres: ['Horror'],
        poster: 'https://example.com/poster.jpg',
        background: 'https://example.com/bg.jpg',
        logo: 'https://example.com/logo.png',
        rating: '7.8',
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

      const cached = metadataRepo.getCachedMovieMetadata('tt0063350');
      expect(cached).not.toBeNull();
      expect(cached?.id).toBe('tt0063350');
      expect(cached?.type).toBe('movie');
      expect(cached?.title).toBe('Night of the Living Dead');
      expect(cached?.runtime).toBe(96);
      expect(cached?.genres).toEqual(['Horror']);
      expect(cached?.cast).toEqual(['Duane Jones', 'Judith ODea']);
      expect(cached?.director).toEqual(['George A. Romero']);
      expect(cached?.moviedb_id).toBe(10331);
    });

    it('should not overwrite existing cached movie (movies never expire)', () => {
      const initialMovie: MovieMetadata = {
        id: 'tt0017136',
        type: 'movie',
        title: 'Metropolis',
        year: '1927',
        released: '1927-01-10',
        genres: ['Sci-Fi'],
        poster: null,
        background: null,
        logo: null,
        rating: '8.3',
        runtime: '153 min',
        description: 'In a futuristic city...',
        awards: null,
        cast: ['Brigitte Helm'],
        director: ['Fritz Lang'],
        writer: ['Thea von Harbou'],
        country: 'Germany',
        dvdRelease: null,
        moviedb_id: 19,
        popularity: 80.0
      };

      metadataRepo.saveCachedMetadata('tt0017136', 'movie', initialMovie);
      const firstCached = metadataRepo.getCachedMovieMetadata('tt0017136');

      // Attempt to save new title
      const updatedMovie: MovieMetadata = {
        ...initialMovie,
        title: 'Metropolis Updated'
      };
      metadataRepo.saveCachedMetadata('tt0017136', 'movie', updatedMovie);

      const secondCached = metadataRepo.getCachedMovieMetadata('tt0017136');
      expect(secondCached?.title).toBe('Metropolis');
    });
  });

  describe('Show & Episode Metadata Caching & Retrieval', () => {
    it('should save and retrieve show metadata and its nested episodes', () => {
      const showData: ShowMetadata = {
        id: 'tt0055662',
        type: 'show',
        title: 'The Beverly Hillbillies',
        year: '1962-1971',
        released: '1962-09-26',
        genres: ['Comedy'],
        poster: 'tbh_poster.jpg',
        background: 'tbh_bg.jpg',
        logo: 'tbh_logo.png',
        rating: '7.2',
        runtime: '25 min',
        description: 'A poor woodsman discovers oil...',
        awards: 'Nominated for 4 Emmys',
        cast: ['Buddy Ebsen', 'Donna Douglas'],
        director: ['Richard Whorf'],
        writer: ['Paul Henning'],
        country: 'United States',
        status: 'Ended',
        tvdb_id: 76092,
        moviedb_id: 2470,
        popularity: 50.5,
        episodes: [
          {
            id: 'tt0055662_s1_e1',
            show_id: 'tt0055662',
            season: 1,
            episode: 1,
            title: 'The Clampetts Strike Oil',
            description: 'Jed Clampett finds oil on his land...',
            thumbnail: 'tbh_s1e1.jpg',
            released: '1962-09-26',
            rating: '7.5',
            tvdb_id: 172901,
            runtime: 25
          },
          {
            id: 'tt0055662_s1_e2',
            show_id: 'tt0055662',
            season: 1,
            episode: 2,
            title: 'Getting Settled',
            description: 'The Clampetts move to Beverly Hills...',
            thumbnail: 'tbh_s1e2.jpg',
            released: '1962-10-03',
            rating: '7.4',
            tvdb_id: 172902,
            runtime: 25
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0055662', 'show', showData, 'Ended');

      const cached = metadataRepo.getCachedShowMetadata('tt0055662');
      expect(cached).not.toBeNull();
      expect(cached?.id).toBe('tt0055662');
      expect(cached?.type).toBe('show');
      expect(cached?.status).toBe('Ended');
      expect(cached?.title).toBe('The Beverly Hillbillies');
      expect(cached?.episodes).toHaveLength(2);
      expect(cached?.episodes[0].title).toBe('The Clampetts Strike Oil');
      expect(cached?.episodes[1].title).toBe('Getting Settled');
    });

    it('should retrieve single episode metadata using getEpisodeMetadataSingle', () => {
      const showData: ShowMetadata = {
        id: 'tt0047706',
        type: 'show',
        title: 'The Adventures of Robin Hood',
        year: '1955-1959',
        released: '1955-09-25',
        genres: ['Adventure'],
        poster: null,
        background: null,
        logo: null,
        rating: '7.8',
        runtime: '26 min',
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: 'United Kingdom',
        status: 'Ended',
        tvdb_id: 12345,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt0047706_s1_e1',
            show_id: 'tt0047706',
            season: 1,
            episode: 1,
            title: 'The Coming of Robin Hood',
            description: 'Robin returns to find his estate seized...',
            thumbnail: 'robin_s1e1.jpg',
            released: '1955-09-25',
            rating: '7.8',
            tvdb_id: 12345,
            runtime: 26
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0047706', 'show', showData, 'Ended');

      const ep = metadataRepo.getEpisodeMetadataSingle('tt0047706', 1, 1);
      expect(ep).not.toBeNull();
      expect(ep?.id).toBe('tt0047706_s1_e1');
      expect(ep?.show_id).toBe('tt0047706');
      expect(ep?.season).toBe(1);
      expect(ep?.episode).toBe(1);
      expect(ep?.title).toBe('The Coming of Robin Hood');
      expect(ep?.runtime).toBe(26);

      const nonExistentEp = metadataRepo.getEpisodeMetadataSingle('tt0047706', 2, 1);
      expect(nonExistentEp).toBeNull();
    });

    it('should ignore episodes with non-positive seasons (e.g. season 0 specials)', () => {
      const showData: ShowMetadata = {
        id: 'tt0046642',
        type: 'show',
        title: 'Sherlock Holmes',
        year: '1954-1955',
        released: '1954-10-18',
        genres: ['Crime'],
        poster: null,
        background: null,
        logo: null,
        rating: '7.9',
        runtime: '30 min',
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: 'United States',
        status: 'Ended',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt0046642_s0_e1',
            show_id: 'tt0046642',
            season: 0,
            episode: 1,
            title: 'Unaired Pilot',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          },
          {
            id: 'tt0046642_s1_e1',
            show_id: 'tt0046642',
            season: 1,
            episode: 1,
            title: 'The Case of the Cunningham Heritage',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0046642', 'show', showData, 'Ended');

      const cached = metadataRepo.getCachedShowMetadata('tt0046642');
      expect(cached?.episodes).toHaveLength(1);
      expect(cached?.episodes[0].title).toBe('The Case of the Cunningham Heritage');
    });
  });

  describe('Show Expiration Logic', () => {
    it('should not expire ended shows', () => {
      const showData: ShowMetadata = {
        id: 'tt0052451',
        type: 'show',
        title: 'Bonanza',
        year: '1959-1973',
        released: '1959-09-12',
        genres: ['Western'],
        poster: null,
        background: null,
        logo: null,
        rating: '7.3',
        runtime: '49 min',
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: 'United States',
        status: 'Ended',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt0052451_s1_e1',
            show_id: 'tt0052451',
            season: 1,
            episode: 1,
            title: 'A Rose for Lotta',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt0052451', 'show', showData, 'Ended');

      // Manually simulate last_fetched 30 days ago
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      db.prepare('UPDATE show_metadata SET last_fetched = ? WHERE id = ?').run(thirtyDaysAgo, 'tt0052451');

      // Attempt to save update
      metadataRepo.saveCachedMetadata('tt0052451', 'show', {
        ...showData,
        title: 'Bonanza (Updated)'
      }, 'Ended');

      const cached = metadataRepo.getCachedShowMetadata('tt0052451');
      expect(cached?.title).toBe('Bonanza'); // Unchanged
    });

    it('should not expire Continuing shows within 24-hour TTL', () => {
      const showData: ShowMetadata = {
        id: 'tt_continuing_fresh',
        type: 'show',
        title: 'Ongoing Show',
        year: '2024-',
        released: '2024-01-01',
        genres: ['Drama'],
        poster: null,
        background: null,
        logo: null,
        rating: '8.0',
        runtime: '45 min',
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: 'United States',
        status: 'Continuing',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt_continuing_fresh_s1_e1',
            show_id: 'tt_continuing_fresh',
            season: 1,
            episode: 1,
            title: 'Pilot',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt_continuing_fresh', 'show', showData, 'Continuing');

      // 12 hours ago
      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
      db.prepare('UPDATE show_metadata SET last_fetched = ? WHERE id = ?').run(twelveHoursAgo, 'tt_continuing_fresh');

      metadataRepo.saveCachedMetadata('tt_continuing_fresh', 'show', {
        ...showData,
        title: 'Ongoing Show (Attempt Update)'
      }, 'Continuing');

      const cached = metadataRepo.getCachedShowMetadata('tt_continuing_fresh');
      expect(cached?.title).toBe('Ongoing Show'); // Still within TTL, not updated
    });

    it('should expire and refresh Continuing shows after 24-hour TTL', () => {
      const showData: ShowMetadata = {
        id: 'tt_continuing_expired',
        type: 'show',
        title: 'Ongoing Show Expired',
        year: '2023-',
        released: '2023-01-01',
        genres: ['Drama'],
        poster: null,
        background: null,
        logo: null,
        rating: '7.5',
        runtime: '45 min',
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: 'United States',
        status: 'Continuing',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt_continuing_expired_s1_e1',
            show_id: 'tt_continuing_expired',
            season: 1,
            episode: 1,
            title: 'Pilot',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt_continuing_expired', 'show', showData, 'Continuing');

      // 25 hours ago (> 24 hour TTL)
      const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
      db.prepare('UPDATE show_metadata SET last_fetched = ? WHERE id = ?').run(twentyFiveHoursAgo, 'tt_continuing_expired');

      const updatedData: ShowMetadata = {
        ...showData,
        title: 'Ongoing Show Refreshed',
        episodes: [
          showData.episodes[0],
          {
            id: 'tt_continuing_expired_s1_e2',
            show_id: 'tt_continuing_expired',
            season: 1,
            episode: 2,
            title: 'New Episode 2',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      };
      metadataRepo.saveCachedMetadata('tt_continuing_expired', 'show', updatedData, 'Continuing');

      const cached = metadataRepo.getCachedShowMetadata('tt_continuing_expired');
      expect(cached?.title).toBe('Ongoing Show Refreshed');
      expect(cached?.episodes).toHaveLength(2);
    });
  });

  describe('Foreign Key Cascade Deletes', () => {
    it('should cascade delete episode_metadata when show_metadata is deleted', () => {
      const showData: ShowMetadata = {
        id: 'tt_cascade_show',
        type: 'show',
        title: 'Show with Cascade',
        year: '2020',
        released: null,
        genres: [],
        poster: null,
        background: null,
        logo: null,
        rating: null,
        runtime: null,
        description: null,
        awards: null,
        cast: [],
        director: [],
        writer: [],
        country: null,
        status: 'Ended',
        tvdb_id: null,
        moviedb_id: null,
        popularity: null,
        episodes: [
          {
            id: 'tt_cascade_show_s1_e1',
            show_id: 'tt_cascade_show',
            season: 1,
            episode: 1,
            title: 'Ep 1',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          },
          {
            id: 'tt_cascade_show_s1_e2',
            show_id: 'tt_cascade_show',
            season: 1,
            episode: 2,
            title: 'Ep 2',
            description: null,
            thumbnail: null,
            released: null,
            rating: null,
            tvdb_id: null,
            runtime: null
          }
        ]
      };

      metadataRepo.saveCachedMetadata('tt_cascade_show', 'show', showData, 'Ended');

      const epsBefore = db.prepare('SELECT id FROM episode_metadata WHERE show_id = ?').all('tt_cascade_show');
      expect(epsBefore).toHaveLength(2);

      // Delete parent show
      db.prepare('DELETE FROM show_metadata WHERE id = ?').run('tt_cascade_show');

      const epsAfter = db.prepare('SELECT id FROM episode_metadata WHERE show_id = ?').all('tt_cascade_show');
      expect(epsAfter).toHaveLength(0);
    });
  });
});
