import path from 'node:path';
import fs from 'node:fs';
import { db } from './index.js';
import { logger } from '../utils/logger.js';
import { parseFileId, getMediaDirs } from '../utils/helpers.js';
import type {
  MovieDownloadRow,
  EpisodeDownloadRow,
  DownloadEntry,
  MovieDownload,
  EpisodeDownload
} from '../types/index.js';

// Pre-compiled prepared statements for performance tuning
const getMovieDownloadsStmt = db.prepare('SELECT * FROM movie_downloads');
const getEpisodeDownloadsStmt = db.prepare('SELECT * FROM episode_downloads');

const insertMovieDownloadStmt = db.prepare(`
  INSERT OR REPLACE INTO movie_downloads (movie_id, fileName, torrentHash, fileHash, fileIdx, quality, sizeBytes, downloadTime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertEpisodeDownloadStmt = db.prepare(`
  INSERT OR REPLACE INTO episode_downloads (episode_id, fileName, torrentHash, fileHash, fileIdx, quality, sizeBytes, downloadTime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteMovieDownloadStmt = db.prepare('DELETE FROM movie_downloads WHERE movie_id = ?');
const deleteEpisodeDownloadStmt = db.prepare('DELETE FROM episode_downloads WHERE episode_id = ?');

const getMovieDownloadSingleStmt = db.prepare('SELECT * FROM movie_downloads WHERE movie_id = ?');
const getEpisodeDownloadSingleStmt = db.prepare('SELECT * FROM episode_downloads WHERE episode_id = ?');

const ensureMovieMetadataDummyStmt = db.prepare(`
  INSERT OR IGNORE INTO movie_metadata (id, title, year, genres, last_fetched)
  VALUES (?, ?, '', '', ?)
`);

const ensureShowMetadataDummyStmt = db.prepare(`
  INSERT OR IGNORE INTO show_metadata (id, title, year, genres, last_fetched)
  VALUES (?, 'Unknown Show', '', '', ?)
`);

const ensureEpisodeMetadataDummyStmt = db.prepare(`
  INSERT OR IGNORE INTO episode_metadata (id, show_id, season, episode, name)
  VALUES (?, ?, ?, ?, ?)
`);

export class DownloadsRepo {
  constructor() {
    // Scan downloads on startup to reconcile database with disk
    this.scanDownloads();
  }

  /**
   * Retrieves all downloads from the SQLite database.
   * @returns Maps fileId -> download details
   */
  getDownloads(): Record<string, DownloadEntry> {
    try {
      const movieRows = getMovieDownloadsStmt.all() as unknown as MovieDownloadRow[];
      const episodeRows = getEpisodeDownloadsStmt.all() as unknown as EpisodeDownloadRow[];
      const downloads: Record<string, DownloadEntry> = {};
      
      for (const row of movieRows) {
        downloads[row.movie_id] = {
          fileId: row.movie_id,
          fileName: row.fileName,
          torrentHash: row.torrentHash,
          fileHash: row.fileHash,
          fileIdx: row.fileIdx,
          quality: row.quality,
          sizeBytes: row.sizeBytes || 0,
          downloadTime: row.downloadTime
        };
      }
      
      for (const row of episodeRows) {
        downloads[row.episode_id] = {
          fileId: row.episode_id,
          fileName: row.fileName,
          torrentHash: row.torrentHash,
          fileHash: row.fileHash,
          fileIdx: row.fileIdx,
          quality: row.quality,
          sizeBytes: row.sizeBytes || 0,
          downloadTime: row.downloadTime
        };
      }
      return downloads;
    } catch (e) {
      logger.error('Failed to get download entries from database', e);
      return {};
    }
  }

  /**
   * Adds a download entry, preparing dummy metadata rows first to respect foreign keys.
   */
  addDownloadEntry(fileId: string, entry: Partial<DownloadEntry & MovieDownload & EpisodeDownload>): void {
    try {
      const parsed = parseFileId(fileId);
      if (!parsed) return;

      if (parsed.type === 'movie') {
        ensureMovieMetadataDummyStmt.run(fileId, entry.fileName || 'Unknown Movie', Date.now());
        insertMovieDownloadStmt.run(
          fileId,
          entry.fileName || null,
          entry.torrentHash || null,
          entry.fileHash || null,
          entry.fileIdx !== undefined ? entry.fileIdx : null,
          entry.quality || null,
          entry.sizeBytes || 0,
          Date.now()
        );
      } else {
        ensureShowMetadataDummyStmt.run(parsed.imdbId, Date.now());
        ensureEpisodeMetadataDummyStmt.run(fileId, parsed.imdbId, Number(parsed.season), Number(parsed.episode), entry.fileName || `Episode ${parsed.episode}`);
        insertEpisodeDownloadStmt.run(
          fileId,
          entry.fileName || null,
          entry.torrentHash || null,
          entry.fileHash || null,
          entry.fileIdx !== undefined ? entry.fileIdx : null,
          entry.quality || null,
          entry.sizeBytes || 0,
          Date.now()
        );
      }
      logger.debug(`Download entry added/updated in registry for: ${fileId}`);
    } catch (e) {
      logger.error(`Failed to add download entry for ${fileId}`, e);
    }
  }

  /**
   * Deletes a download registry row.
   */
  removeDownloadEntry(fileId: string): void {
    try {
      const parsed = parseFileId(fileId);
      if (!parsed) return;

      if (parsed.type === 'movie') {
        deleteMovieDownloadStmt.run(fileId);
      } else {
        deleteEpisodeDownloadStmt.run(fileId);
      }
      logger.debug(`Download entry removed from registry for: ${fileId}`);
    } catch (e) {
      logger.error(`Failed to remove download entry for ${fileId}`, e);
    }
  }

  /**
   * Scans matching files on disk, updating database and reconciling missing files.
   */
  scanDownloads(): void {
    const downloads = this.getDownloads();
    let validCount = 0;

    for (const fileId of Object.keys(downloads)) {
      const dirs = getMediaDirs(fileId);
      const playlistPath = dirs ? path.join(dirs.hlsDir, 'index.m3u8') : '';
      if (playlistPath && fs.existsSync(playlistPath)) {
        validCount++;
      } else {
        logger.warn(`Disk check failed for downloaded item ${fileId}. Removing reference.`);
        this.removeDownloadEntry(fileId);
      }
    }

    logger.debug(`Disk scan completed. Active completed items: ${validCount}`);
  }

  /**
   * Returns if a fileId is fully downloaded and registered in SQLite database.
   */
  isDownloaded(fileId: string): boolean {
    if (!fileId) return false;
    try {
      const parsed = parseFileId(fileId);
      if (!parsed) return false;

      if (parsed.type === 'movie') {
        return Boolean(getMovieDownloadSingleStmt.get(fileId));
      } else {
        return Boolean(getEpisodeDownloadSingleStmt.get(fileId));
      }
    } catch (e) {
      logger.error(`Failed to check download status for ${fileId}`, e);
      return false;
    }
  }

  /**
   * Retrieves single movie download details.
   */
  getMovieDownloadSingle(movieId: string): MovieDownloadRow | null {
    try {
      return (getMovieDownloadSingleStmt.get(movieId) as MovieDownloadRow | undefined) || null;
    } catch (e) {
      logger.error(`Failed to check movie download status for ${movieId}`, e);
      return null;
    }
  }

  /**
   * Retrieves single episode download details.
   */
  getEpisodeDownloadSingle(episodeId: string): EpisodeDownloadRow | null {
    try {
      return (getEpisodeDownloadSingleStmt.get(episodeId) as EpisodeDownloadRow | undefined) || null;
    } catch (e) {
      logger.error(`Failed to check episode download status for ${episodeId}`, e);
      return null;
    }
  }

  /**
   * Returns all downloaded episodes for a show.
   * @returns Key-value map of episodeId -> download data
   */
  getShowDownloads(showId: string): Record<string, DownloadEntry> {
    try {
      const rows = db.prepare('SELECT * FROM episode_downloads WHERE episode_id LIKE ?').all(`${showId}_%`) as unknown as EpisodeDownloadRow[];
      const downloads: Record<string, DownloadEntry> = {};
      for (const row of rows) {
        downloads[row.episode_id] = {
          fileId: row.episode_id,
          id: row.episode_id,
          fileName: row.fileName,
          torrentHash: row.torrentHash,
          fileHash: row.fileHash,
          fileIdx: row.fileIdx,
          quality: row.quality,
          sizeBytes: row.sizeBytes || 0,
          is_downloaded: true
        };
      }
      return downloads;
    } catch (e) {
      logger.error(`Failed to get show downloads for show: ${showId}`, e);
      return {};
    }
  }
}

const registryInstance = new DownloadsRepo();
export { registryInstance as downloadsRepo };
export default registryInstance;
