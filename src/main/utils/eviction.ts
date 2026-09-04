import fs from 'node:fs';
import { db } from '../db/index.js';
import { streamsRepo } from '../db/streams.js';
import { sseManager } from '../sse/index.js';
import { getMediaDirs } from './helpers.js';
import { logger } from './logger.js';
import { MEDIA_REQUEST_STATUS } from '../types/index.js';

const parsedStorage = parseInt(process.env.MAX_STORAGE_GB ?? '100', 10);
const MAX_STORAGE_GB = Number.isNaN(parsedStorage) ? 100 : parsedStorage;
const MAX_STORAGE_BYTES = MAX_STORAGE_GB * 1024 * 1024 * 1024;

export class EvictionManager {
  /**
   * Enforces the cache size limit, evicting items if the new item would exceed it.
   * Uses an LRU strategy: least recently watched items first (falling back to stream ready time).
   * @param incomingTorrentSize Size of the incoming torrent in bytes
   */
  ensureFreeSpace(incomingTorrentSize = 0): void {
    streamsRepo.scanStreams();

    const streams = streamsRepo.getStreams();
    const streamEntries = Object.values(streams);

    let totalSize = 0;
    for (const stream of streamEntries) {
      totalSize += stream.size_bytes;
    }
    logger.info(`Checking disk cache limits. Current: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB, Limit: ${MAX_STORAGE_GB} GB`);

    if (totalSize + incomingTorrentSize <= MAX_STORAGE_BYTES || streamEntries.length === 0) {
      return;
    }

    logger.warn(`Storage limit of ${MAX_STORAGE_GB} GB exceeded. Running LRU eviction...`);

    const progressMap: Record<string, number | null> = {};
    const items = Object.keys(streams);

    const placeholders = items.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, last_updated 
      FROM progress 
      WHERE id IN (${placeholders})
    `).all(...items) as unknown as { id: string; last_updated: number | null }[];
    
    for (const r of rows) {
      progressMap[r.id] = r.last_updated;
    }

    const itemDetails = items.map(id => {
      const stream = streams[id];
      const lastWatched = progressMap[id] ?? null;
      // Sort key: last watched time if available, else ready time (both Unix ms)
      const sortKey = lastWatched !== null ? lastWatched : stream.ready_at;
      return { id, size_bytes: stream.size_bytes, sortKey };
    });

    // Evict least recently watched first
    itemDetails.sort((a, b) => a.sortKey - b.sortKey);

    for (const item of itemDetails) {
      if (totalSize + incomingTorrentSize <= MAX_STORAGE_BYTES) {
        break;
      }

      const dirs = getMediaDirs(item.id);
      if (dirs && dirs.baseDir && fs.existsSync(dirs.baseDir)) {
        try {
          const itemSize = item.size_bytes;
          logger.info(`Evicting item: ${item.id} (Size: ${(itemSize / 1024 / 1024).toFixed(2)} MB)`);
          
          fs.rmSync(dirs.baseDir, { recursive: true, force: true });
          streamsRepo.removeStream(item.id);
          totalSize -= itemSize;

          // Notify client via SSE of the removed media
          sseManager.broadcastMediaRequestStatus(item.id, MEDIA_REQUEST_STATUS.REMOVED);
        } catch (e) {
          logger.error(`Failed to evict item ${item.id} from storage`, e);
        }
      }
    }

    logger.info(`Eviction completed. New total cache size: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
  }
}

const evictionInstance = new EvictionManager();
export { evictionInstance as eviction, evictionInstance as evictionService };
export default evictionInstance;
