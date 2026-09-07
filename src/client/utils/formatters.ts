/**
 * UI formatters and calculation helpers.
 */

import type { Progress } from '../../main/types/index.js';

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
      subtitle: `Season ${season}, Episode ${episode}`,
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

