import path from 'node:path';
import fs from 'node:fs';
import { DOWNLOADS_DIR } from './paths.js';

export interface ParsedFileIdSeries {
  type: 'series';
  imdbId: string;
  season: string;
  episode: string;
}

export interface ParsedFileIdMovie {
  type: 'movie';
  imdbId: string;
  season: null;
  episode: null;
}

export type ParsedFileId = ParsedFileIdSeries | ParsedFileIdMovie;

export interface MediaDirs {
  baseDir: string;
  subtitlesDir: string;
  hlsDir: string;
}

/**
 * Parses fileId into type, imdbId, season, and episode details.
 * @param fileId Media identifier
 * @returns Parsed object or null if invalid
 */
export function parseFileId(fileId: string): ParsedFileId | null {
  if (!fileId || typeof fileId !== 'string') return null;
  
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return null;
  }

  const match = fileId.match(/^([a-zA-Z0-9]+)_s(\d+)_e(\d+)$/);
  if (match) {
    return {
      type: 'series',
      imdbId: match[1],
      season: match[2],
      episode: match[3]
    };
  }
  return {
    type: 'movie',
    imdbId: fileId,
    season: null,
    episode: null
  };
}

/**
 * Converts id format from cinemeta colon-based representation (e.g. tt123:1:1) to underscore representation (e.g. tt123_s1_e1).
 * @param id Colon or underscore formatted media id
 * @returns Standardized underscore file id
 */
export function getFileId(id: string): string {
  const parts = id.split(':');
  if (parts.length === 3) {
    return `${parts[0]}_s${parts[1]}_e${parts[2]}`;
  }
  return id;
}

/**
 * Returns absolute directories for media content, HLS assets, and subtitles.
 * @param fileId Underscored media id
 * @returns Object with baseDir, subtitlesDir, hlsDir, or null
 */
export function getMediaDirs(fileId: string): MediaDirs | null {
  const parsed = parseFileId(fileId);
  if (!parsed) return null;
  
  const { type, imdbId, season, episode } = parsed;
  let baseDir: string;
  if (type === 'movie') {
    baseDir = path.join(DOWNLOADS_DIR, 'movies', imdbId);
  } else {
    baseDir = path.join(DOWNLOADS_DIR, 'series', imdbId, season, episode);
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
    console.error(`[helpers] Error getting size of ${dirPath}:`, message);
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
