import path from 'node:path';
import fs from 'node:fs';
import { STREAMS_DIR, MOVIES_TEMP, SHOWS_TEMP } from './paths.js';
import { MEDIA_REQUEST_STATUS, type MediaRequestStatus, type UserMediaRequestStatus } from '../types/events.js';
import { logger } from './logger.js';

export interface ParsedFileIdShow {
  type: 'show';
  id: string;
  season: string;
  episode: string;
}

export interface ParsedFileIdMovie {
  type: 'movie';
  id: string;
  season: null;
  episode: null;
}

export type ParsedFileId = ParsedFileIdShow | ParsedFileIdMovie;

export interface MediaDirs {
  baseDir: string;
  subtitlesDir: string;
  hlsDir: string;
}

/**
 * Parses fileId into type, id, season, and episode details.
 * @param fileId Media identifier
 * @returns Parsed object or null if invalid
 */
export function parseFileId(fileId: string): ParsedFileId | null {
  if (!fileId || typeof fileId !== 'string') return null;
  
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return null;
  }

  const match = fileId.match(/^([a-zA-Z0-9_-]+)_s(\d+)_e(\d+)$/);
  if (match) {
    return {
      type: 'show',
      id: match[1],
      season: match[2],
      episode: match[3]
    };
  }

  return {
    type: 'movie',
    id: fileId,
    season: null,
    episode: null
  };
}

/**
 * Returns absolute directories for media content, HLS assets, and subtitles.
 * @param fileId Underscored media id
 * @returns Object with baseDir, subtitlesDir, hlsDir, or null
 */
export function getMediaDirs(fileId: string): MediaDirs | null {
  const parsed = parseFileId(fileId);
  if (!parsed) return null;
  
  const { type, id, season, episode } = parsed;
  let baseDir: string;
  if (type === 'movie') {
    baseDir = path.join(STREAMS_DIR, 'movies', id);
  } else {
    baseDir = path.join(STREAMS_DIR, 'shows', id, season, episode);
  }
  
  return {
    baseDir,
    subtitlesDir: path.join(baseDir, 'subtitles'),
    hlsDir: path.join(baseDir, 'hls')
  };
}

/**
 * Calculates directory size in bytes recursively.
 * @param dirPath Directory path to scan
 * @returns Total size in bytes
 */
export function getDirSize(dirPath: string): number {
  let size = 0;
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const stats = fs.statSync(dirPath);
    if (stats.isFile()) {
      return stats.size;
    }
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      size += getDirSize(path.join(dirPath, file));
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`Error getting size of ${dirPath}: ${message}`);
  }
  return size;
}

/**
 * Executes a fetch request with an abort timeout.
 * @param url Target URL
 * @param options Fetch options
 * @param timeout Timeout in ms (default 8000)
 * @returns Fetch Response
 */
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}


/**
 * Safely removes an isolated temporary job directory.
 * Guards against ever deleting the base root storage directories.
 *
 * @param dirPath Isolated temporary directory path
 */
export function cleanupJobTempDir(dirPath: string | null | undefined): void {
  if (
    dirPath &&
    fs.existsSync(dirPath) &&
    dirPath !== MOVIES_TEMP &&
    dirPath !== SHOWS_TEMP
  ) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Converts backend download & processing phases into user-facing 'preparing' status (80/20 weighted progress).
 */
export function toUserMediaRequestStatus(
  status: MediaRequestStatus,
  progress: string | number = '0.00'
): { status: UserMediaRequestStatus; progress: string } {
  const p = Math.min(100, Math.max(0, parseFloat(String(progress)) || 0));

  if (status === MEDIA_REQUEST_STATUS.DOWNLOADING) {
    return { status: 'preparing', progress: (p * 0.8).toFixed(2) };
  }
  if (status === MEDIA_REQUEST_STATUS.PROCESSING) {
    return { status: 'preparing', progress: (80 + p * 0.2).toFixed(2) };
  }
  if (status === MEDIA_REQUEST_STATUS.READY) {
    return { status: 'ready', progress: '100.00' };
  }
  if (status === MEDIA_REQUEST_STATUS.FAILED) {
    return { status: 'failed', progress: '0.00' };
  }
  if (status === MEDIA_REQUEST_STATUS.REMOVED) {
    return { status: 'removed', progress: '0.00' };
  }
  return {
    status: 'queued',
    progress: '0.00'
  };
}
