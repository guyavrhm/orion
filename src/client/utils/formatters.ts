/**
 * UI formatters and calculation helpers.
 */

import type { Progress, EpisodeMetadata } from '../../main/types/index.js';

export interface TargetEpisodeResult {
  season: number;
  episode: number;
  epMeta: EpisodeMetadata | null;
  fileId: string;
}

/**
 * Deterministically resolves the active target episode for any show based on normalized progress.
 * If the most recently updated episode has timestamp > 0, it resumes that watched episode.
 * If the most recently updated episode has timestamp === 0 (unwatched request), it picks the oldest
 * requested episode among all unwatched requests (FIFO).
 */
export function getShowTargetEpisode(
  showId: string,
  episodes: EpisodeMetadata[] = [],
  progressMap: Record<string, Progress> = {}
): TargetEpisodeResult {
  const showProgEntries = Object.entries(progressMap)
    .filter(([k, v]) => v && (v.show_id === showId || k.startsWith(`${showId}_s`)))
    .map(([k, v]) => ({
      key: k,
      parsed: parseDisplayFileId(k),
      timestamp: v.timestamp || 0,
      lastUpdated: v.last_updated || 0,
    }))
    .filter((e) => e.parsed.season && e.parsed.episode)
    .sort((a, b) => b.lastUpdated - a.lastUpdated);

  let targetEntry = showProgEntries.length > 0 ? showProgEntries[0] : null;

  if (targetEntry && (targetEntry.timestamp || 0) === 0) {
    const unwatched = showProgEntries.filter((e) => (e.timestamp || 0) === 0);
    unwatched.sort((a, b) => a.lastUpdated - b.lastUpdated);
    targetEntry = unwatched[0];
  }

  const targetSeason = targetEntry ? targetEntry.parsed.season! : (episodes[0]?.season ?? 1);
  const targetEpisode = targetEntry ? targetEntry.parsed.episode! : (episodes[0]?.episode ?? 1);
  const fileId = targetEntry ? targetEntry.key : `${showId}_s${targetSeason}_e${targetEpisode}`;

  const epMeta =
    episodes.find((e) => e.season === targetSeason && e.episode === targetEpisode) ||
    episodes[0] ||
    null;

  return {
    season: targetSeason,
    episode: targetEpisode,
    epMeta,
    fileId,
  };
}

/**
 * Resolves the immediate next episode in chronological sequence for a show.
 * First checks for the next episode in the current season (S{current} E{current+1}).
 * If current episode is the season finale, checks for the first episode of the next season.
 * Returns null if current is the series finale or inputs are invalid.
 */
export function getNextEpisode(
  episodes: EpisodeMetadata[] = [],
  currentSeason?: number,
  currentEpisode?: number
): EpisodeMetadata | null {
  if (currentSeason == null || currentEpisode == null || episodes.length === 0) {
    return null;
  }

  // 1. Next episode in current season (handles non-consecutive numbering)
  const nextInSeason = episodes
    .filter((e) => e.season === currentSeason && e.episode > currentEpisode)
    .sort((a, b) => a.episode - b.episode)[0];

  if (nextInSeason) return nextInSeason;

  // 2. First episode of next season (season finale case)
  const nextSeasons = episodes
    .filter((e) => e.season > currentSeason)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);

  return nextSeasons[0] || null;
}

/**
 * Formats seconds to mm:ss or hh:mm:ss string.
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Calculates progress percentage (0 - 100) from a Progress object or timestamp/duration.
 */
export function calculateProgressPercent(
  prog?: Progress | null,
  fallbackTimestamp?: number,
  fallbackDuration?: number
): number {
  if (prog) {
    if (prog.progressPercent != null && prog.progressPercent > 0) {
      return Math.min(100, prog.progressPercent);
    }
    const duration = prog.duration || prog.runtime || 0;
    if (duration > 0 && prog.timestamp > 0) {
      return Math.min(100, (prog.timestamp / duration) * 100);
    }
  }

  if (fallbackTimestamp && fallbackDuration && fallbackDuration > 0) {
    return Math.min(100, (fallbackTimestamp / fallbackDuration) * 100);
  }

  return 0;
}

/**
 * Parses file IDs into metadata components (e.g. tt1234567_s1_e2 -> show metadata).
 */
export function parseDisplayFileId(fileId: string) {
  const match = fileId.match(/^(.+?)_s(\d+)_e(\d+)$/i);
  if (match) {
    const [, showId, season, episode] = match;
    return {
      isEpisode: true,
      mediaId: showId,
      title: showId,
      subtitle: `S${season}:E${episode}`,
      season: Number(season),
      episode: Number(episode),
    };
  }
  return {
    isEpisode: false,
    mediaId: fileId,
    title: fileId,
    subtitle: undefined,
    season: undefined,
    episode: undefined,
  };
}

/**
 * Maps raw error codes and network exceptions to user-friendly messages.
 * Returns null for errors that should be handled silently without toasts.
 */
export function getFriendlyErrorMessage(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err || '');
  const normalized = message.trim();

  // Errors to ignore silently (do not toast)
  if (
    normalized.includes('SERVICE_ERROR') ||
    normalized.includes('BAD_REQUEST')
  ) {
    return null;
  }

  if (normalized.includes('PROVIDER_NOT_CONFIGURED')) {
    return 'Torrent provider is not configured. Please check server settings in .env.';
  }

  if (normalized.includes('PROVIDER_UNAVAILABLE')) {
    return 'Torrent provider is temporarily unavailable or timed out. Please try again later.';
  }

  if (normalized.includes('NO_STREAMS_FOUND')) {
    return 'No streamable sources found for this title.';
  }

  if (normalized.includes('MEDIA_NOT_READY')) {
    return 'This video is still preparing. Please wait a moment.';
  }

  if (normalized.includes('MEDIA_NOT_FOUND')) {
    return 'Media details could not be found.';
  }

  if (
    normalized.includes('Load failed') ||
    normalized.includes('Failed to fetch') ||
    normalized.includes('NetworkError')
  ) {
    return 'Unable to connect to Orion server. Check your connection.';
  }

  if (normalized.includes('INTERNAL_ERROR')) {
    return 'Server encountered an unexpected error. Please try again.';
  }

  return normalized || 'An unexpected error occurred.';
}

