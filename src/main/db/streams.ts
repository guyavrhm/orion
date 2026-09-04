import path from 'node:path';
import fs from 'node:fs';
import { db } from './index.js';
import { logger } from '../utils/logger.js';
import { parseFileId, getMediaDirs } from '../utils/helpers.js';
import type { Stream } from '../types/index.js';

// Pre-compiled prepared statements for unified streams
const getAllStreamsStmt = db.prepare('SELECT * FROM streams');
const getStreamSingleStmt = db.prepare('SELECT * FROM streams WHERE id = ?');
const deleteStreamStmt = db.prepare('DELETE FROM streams WHERE id = ?');
const getShowStreamsStmt = db.prepare('SELECT * FROM streams WHERE show_id = ?');

const insertStreamStmt = db.prepare(`
  INSERT INTO streams (id, show_id, size_bytes, quality, ready_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    show_id = excluded.show_id,
    size_bytes = excluded.size_bytes,
    quality = excluded.quality,
    ready_at = excluded.ready_at
`);

export class StreamsRepo {
  constructor() {
    // Scan streams on startup to reconcile database with disk
    this.scanStreams();
  }

  /**
   * Retrieves all ready streams from the SQLite database.
   * @returns Maps fileId -> stream details
   */
  getStreams(): Record<string, Stream> {
    try {
      const rows = getAllStreamsStmt.all() as unknown as Stream[];
      const streams: Record<string, Stream> = {};

      for (const row of rows) {
        streams[row.id] = {
          id: row.id,
          show_id: row.show_id,
          size_bytes: row.size_bytes,
          quality: row.quality,
          ready_at: row.ready_at
        };
      }
      return streams;
    } catch (e) {
      logger.error('Failed to get stream entries from database', e);
      return {};
    }
  }

  /**
   * Registers a finalized stream entry in the unified streams table.
   */
  registerStream(fileId: string, entry: Partial<Stream> = {}): void {
    try {
      const parsed = parseFileId(fileId);
      if (!parsed) return;

      const size_bytes = entry.size_bytes ?? 0;
      const quality = entry.quality ?? 'unknown';
      const ready_at = entry.ready_at ?? Date.now();
      const show_id = parsed.type === 'show' ? parsed.id : null;

      insertStreamStmt.run(fileId, show_id, size_bytes, quality, ready_at);
      logger.debug(`Stream entry registered for: ${fileId}`);
    } catch (e) {
      logger.error(`Failed to register stream entry for ${fileId}`, e);
    }
  }

  /**
   * Deletes a stream registry row.
   */
  removeStream(fileId: string): void {
    try {
      if (!fileId) return;
      deleteStreamStmt.run(fileId);
      logger.debug(`Stream entry removed from registry for: ${fileId}`);
    } catch (e) {
      logger.error(`Failed to remove stream entry for ${fileId}`, e);
    }
  }

  /**
   * Scans matching files on disk, updating database and reconciling missing files.
   */
  scanStreams(): void {
    const streams = this.getStreams();
    let validCount = 0;

    for (const fileId of Object.keys(streams)) {
      const dirs = getMediaDirs(fileId);
      const playlistPath = dirs ? path.join(dirs.hlsDir, 'index.m3u8') : '';
      if (playlistPath && fs.existsSync(playlistPath)) {
        validCount++;
      } else {
        logger.warn(`Disk check failed for stream item ${fileId}. Removing reference.`);
        this.removeStream(fileId);
      }
    }

    logger.debug(`Disk scan completed. Active ready stream items: ${validCount}`);
  }

  /**
   * Returns if a fileId is fully transcoded and registered in SQLite database.
   */
  isReady(fileId: string): boolean {
    if (!fileId) return false;
    try {
      return Boolean(getStreamSingleStmt.get(fileId));
    } catch (e) {
      logger.error(`Failed to check stream status for ${fileId}`, e);
      return false;
    }
  }

  /**
   * Retrieves single stream details.
   */
  getStream(fileId: string): Stream | null {
    if (!fileId) return null;
    try {
      return (getStreamSingleStmt.get(fileId) as Stream | undefined) || null;
    } catch (e) {
      logger.error(`Failed to get stream status for ${fileId}`, e);
      return null;
    }
  }

  /**
   * Retrieves single movie stream details (alias for getStream).
   */
  getMovieStream(movieId: string): Stream | null {
    return this.getStream(movieId);
  }

  /**
   * Retrieves single episode stream details (alias for getStream).
   */
  getEpisodeStream(episodeId: string): Stream | null {
    return this.getStream(episodeId);
  }

  /**
   * Returns all ready episodes for a show.
   * @returns Key-value map of episodeId -> stream data
   */
  getShowStreams(showId: string): Record<string, Stream> {
    try {
      const rows = getShowStreamsStmt.all(showId) as unknown as Stream[];
      const streams: Record<string, Stream> = {};
      for (const row of rows) {
        streams[row.id] = {
          id: row.id,
          show_id: row.show_id,
          size_bytes: row.size_bytes,
          quality: row.quality,
          ready_at: row.ready_at
        };
      }
      return streams;
    } catch (e) {
      logger.error(`Failed to get show streams for show: ${showId}`, e);
      return {};
    }
  }
}

const streamsRepoInstance = new StreamsRepo();
export { streamsRepoInstance as streamsRepo };
export default streamsRepoInstance;
