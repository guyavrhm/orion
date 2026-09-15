import { describe, it, expect } from 'vitest';
import { getNextEpisode, getShowTargetEpisode } from '../../../src/client/utils/formatters.js';
import type { EpisodeMetadata, Progress } from '../../../src/main/types/index.js';

describe('client/utils/formatters -> getNextEpisode', () => {
  const createMockEpisode = (season: number, episode: number, title?: string): EpisodeMetadata => ({
    id: `tt0944947_s${season}_e${episode}`,
    show_id: 'tt0944947',
    season,
    episode,
    title: title || `Episode ${episode}`,
    description: 'Test description',
    thumbnail: `https://example.com/thumb_s${season}_e${episode}.jpg`,
    released: '2021-01-01',
    rating: '8.5',
    tvdb_id: 1234,
    runtime: 50,
  });

  const mockEpisodes: EpisodeMetadata[] = [
    createMockEpisode(1, 1, 'Winter Is Coming'),
    createMockEpisode(1, 2, 'The Kingsroad'),
    createMockEpisode(1, 3, 'Lord Snow'),
    createMockEpisode(2, 1, 'The North Remembers'),
    createMockEpisode(2, 2, 'The Night Lands'),
    createMockEpisode(3, 1, 'Valar Dohaeris'),
  ];

  it('should return null when invalid arguments or empty episode list are passed', () => {
    expect(getNextEpisode([], 1, 1)).toBeNull();
    expect(getNextEpisode(mockEpisodes, undefined, 1)).toBeNull();
    expect(getNextEpisode(mockEpisodes, 1, undefined)).toBeNull();
  });

  it('should return the next episode in the same season', () => {
    const next = getNextEpisode(mockEpisodes, 1, 1);
    expect(next).not.toBeNull();
    expect(next?.season).toBe(1);
    expect(next?.episode).toBe(2);
    expect(next?.title).toBe('The Kingsroad');
    expect(next?.id).toBe('tt0944947_s1_e2');
  });

  it('should return the first episode of the next season when at the season finale', () => {
    const next = getNextEpisode(mockEpisodes, 1, 3);
    expect(next).not.toBeNull();
    expect(next?.season).toBe(2);
    expect(next?.episode).toBe(1);
    expect(next?.title).toBe('The North Remembers');
    expect(next?.id).toBe('tt0944947_s2_e1');
  });

  it('should return null when at the series finale (no more episodes)', () => {
    const next = getNextEpisode(mockEpisodes, 3, 1);
    expect(next).toBeNull();
  });

  it('should correctly handle unordered episode lists', () => {
    const shuffled = [...mockEpisodes].reverse();
    const nextInSeason = getNextEpisode(shuffled, 1, 2);
    expect(nextInSeason?.season).toBe(1);
    expect(nextInSeason?.episode).toBe(3);

    const nextSeason = getNextEpisode(shuffled, 1, 3);
    expect(nextSeason?.season).toBe(2);
    expect(nextSeason?.episode).toBe(1);
  });

  it('should correctly handle non-consecutive episode numbers in the same season', () => {
    const nonConsecutiveEpisodes: EpisodeMetadata[] = [
      createMockEpisode(1, 1, 'Episode 1'),
      createMockEpisode(1, 2, 'Episode 2'),
      createMockEpisode(1, 5, 'Episode 5'), // Gap: 3 and 4 missing
      createMockEpisode(2, 1, 'Season 2 Episode 1'),
    ];

    const next = getNextEpisode(nonConsecutiveEpisodes, 1, 2);
    expect(next).not.toBeNull();
    expect(next?.season).toBe(1);
    expect(next?.episode).toBe(5);
    expect(next?.title).toBe('Episode 5');
  });
});

describe('client/utils/formatters -> getShowTargetEpisode', () => {
  const createMockEpisode = (season: number, episode: number, title?: string): EpisodeMetadata => ({
    id: `tt0944947_s${season}_e${episode}`,
    show_id: 'tt0944947',
    season,
    episode,
    title: title || `Episode ${episode}`,
    description: 'Test description',
    thumbnail: `https://example.com/thumb_s${season}_e${episode}.jpg`,
    released: '2021-01-01',
    rating: '8.5',
    tvdb_id: 1234,
    runtime: 50,
  });

  const mockEpisodes: EpisodeMetadata[] = [
    createMockEpisode(1, 1, 'Winter Is Coming'),
    createMockEpisode(1, 2, 'The Kingsroad'),
    createMockEpisode(1, 3, 'Lord Snow'),
  ];

  it('resumes the most recently watched episode', () => {
    const progressMap: Record<string, Progress> = {
      'tt0944947_s1_e1': {
        id: 'tt0944947_s1_e1',
        show_id: 'tt0944947',
        timestamp: 1200,
        runtime: 3000,
        last_updated: Date.now(),
      },
    };

    const target = getShowTargetEpisode('tt0944947', mockEpisodes, progressMap);
    expect(target.season).toBe(1);
    expect(target.episode).toBe(1);
    expect(target.fileId).toBe('tt0944947_s1_e1');
  });

  it('picks the lowest unwatched episode if no watched episodes exist', () => {
    const target = getShowTargetEpisode('tt0944947', mockEpisodes, {});
    expect(target.season).toBe(1);
    expect(target.episode).toBe(1);
    expect(target.fileId).toBe('tt0944947_s1_e1');
  });

  it('picks the oldest requested episode among multiple unwatched requests', () => {
    const progressMap: Record<string, Progress> = {
      'tt0944947_s1_e3': {
        id: 'tt0944947_s1_e3',
        show_id: 'tt0944947',
        timestamp: 0,
        runtime: 3000,
        last_updated: 2000,
      },
      'tt0944947_s1_e2': {
        id: 'tt0944947_s1_e2',
        show_id: 'tt0944947',
        timestamp: 0,
        runtime: 3000,
        last_updated: 1000, // Older request time
      },
    };

    const target = getShowTargetEpisode('tt0944947', mockEpisodes, progressMap);
    expect(target.season).toBe(1);
    expect(target.episode).toBe(2);
    expect(target.fileId).toBe('tt0944947_s1_e2');
  });
});
