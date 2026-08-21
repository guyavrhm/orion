import fs from 'node:fs';
import { db } from '../db/index.js';
import { downloadsRepo } from '../db/downloads.js';
import { sseManager } from '../sse/index.js';
import { parseFileId, getMediaDirs, getDirSize } from './helpers.js';
import { logger } from './logger.js';
import { DOWNLOAD_STATUS } from '../types/index.js';

const MAX_STORAGE_GB = parseInt(process.env.MAX_STORAGE_GB || '100', 10) || 100;
const MAX_STORAGE_BYTES = MAX_STORAGE_GB * 1024 * 1024 * 1024;

export class EvictionManager {
  /**
   * Enforces the cache size limit, evicting items if the new item would exceed it.
   * Uses an LRU strategy: least recently watched items first (falling back to download time).
   * @param incomingTorrentSize Size of the incoming torrent in bytes
   */
  ensureFreeSpace(incomingTorrentSize = 0): void {
    downloadsRepo.scanDownloads();

    const downloads = downloadsRepo.getDownloads();
    const items = Object.keys(downloads);

    let totalSize = 0;
    for (const id of items) {
      totalSize += downloads[id]?.sizeBytes || 0;
    }
    logger.info(`Checking disk cache limits. Current: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB, Limit: ${MAX_STORAGE_GB} GB`);

    if (totalSize + incomingTorrentSize <= MAX_STORAGE_BYTES) {
      return;
    }

    if (items.length === 0) {
      return;
    }

    logger.warn(`Storage limit of ${MAX_STORAGE_GB} GB exceeded. Running LRU eviction...`);

    const movieIds: string[] = [];
    const episodeIds: string[] = [];
    for (const item of items) {
      const parsed = parseFileId(item);
      if (parsed && parsed.type === 'movie') {
        movieIds.push(item);
      } else if (parsed) {
        episodeIds.push(item);
      }
    }

    const progressMap: Record<string, number | null> = {};

    if (movieIds.length > 0) {
      const placeholders = movieIds.map(() => '?').join(',');
      const movieRows = db.prepare(`
        SELECT movie_id as id, last_updated 
        FROM movie_progress 
        WHERE movie_id IN (${placeholders})
      `).all(...movieIds) as unknown as { id: string; last_updated: number | null }[];
      
      for (const r of movieRows) {
        progressMap[r.id] = r.last_updated;
      }
    }

    if (episodeIds.length > 0) {
      const placeholders = episodeIds.map(() => '?').join(',');
      const episodeRows = db.prepare(`
        SELECT episode_id as id, last_updated 
        FROM episode_progress 
        WHERE episode_id IN (${placeholders})
      `).all(...episodeIds) as unknown as { id: string; last_updated: number | null }[];
      
      for (const r of episodeRows) {
        progressMap[r.id] = r.last_updated;
      }
    }

    const itemDetails = items.map(id => {
      const downloadTime = downloads[id]?.downloadTime || 0;
      const lastWatched = progressMap[id] ?? null;
      // Sort key: last watched time if available, else download time (both Unix ms)
      const sortKey = lastWatched !== null ? lastWatched : downloadTime;
      return { id, sortKey };
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
          const itemSize = downloads[item.id]?.sizeBytes || getDirSize(dirs.baseDir);
          logger.info(`Evicting item: ${item.id} (Size: ${(itemSize / 1024 / 1024).toFixed(2)} MB)`);
          
          fs.rmSync(dirs.baseDir, { recursive: true, force: true });
          downloadsRepo.removeDownloadEntry(item.id);
          totalSize -= itemSize;

          // Notify client via SSE of the removed download
          sseManager.broadcastDownloadStatus(item.id, DOWNLOAD_STATUS.REMOVED);
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
