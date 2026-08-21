import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { EvictionManager } from '../../../src/main/utils/eviction.js';
import { downloadsRepo } from '../../../src/main/db/downloads.js';
import { sseManager } from '../../../src/main/sse/index.js';
import { db } from '../../../src/main/db/index.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import { DOWNLOAD_STATUS } from '../../../src/main/types/index.js';

describe('utils/eviction - EvictionManager', () => {
  let evictionManager: EvictionManager;

  beforeEach(() => {
    evictionManager = new EvictionManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not evict any items if total size plus incoming size is within limit', () => {
    vi.spyOn(downloadsRepo, 'scanDownloads').mockImplementation(() => {});
    vi.spyOn(downloadsRepo, 'getDownloads').mockReturnValue({
      'tt0137523': {
        fileId: 'tt0137523',
        sizeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
        downloadTime: 1000
      }
    });

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeDownloadSpy = vi.spyOn(downloadsRepo, 'removeDownloadEntry').mockImplementation(() => {});
    const sseSpy = vi.spyOn(sseManager, 'broadcastDownloadStatus').mockImplementation(() => {});

    // Incoming 5 GB, total 15 GB <= 100 GB default limit
    evictionManager.ensureFreeSpace(5 * 1024 * 1024 * 1024);

    expect(rmSyncSpy).not.toHaveBeenCalled();
    expect(removeDownloadSpy).not.toHaveBeenCalled();
    expect(sseSpy).not.toHaveBeenCalled();
  });

  it('should do nothing if download list is empty even if incoming size exceeds limit', () => {
    vi.spyOn(downloadsRepo, 'scanDownloads').mockImplementation(() => {});
    vi.spyOn(downloadsRepo, 'getDownloads').mockReturnValue({});

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeDownloadSpy = vi.spyOn(downloadsRepo, 'removeDownloadEntry').mockImplementation(() => {});

    // Incoming 150 GB > 100 GB limit
    evictionManager.ensureFreeSpace(150 * 1024 * 1024 * 1024);

    expect(rmSyncSpy).not.toHaveBeenCalled();
    expect(removeDownloadSpy).not.toHaveBeenCalled();
  });

  it('should evict least recently watched items first (LRU) when limit is exceeded', () => {
    vi.spyOn(downloadsRepo, 'scanDownloads').mockImplementation(() => {});
    
    // Total existing = 90 GB. Incoming = 20 GB. Total = 110 GB (> 100 GB limit).
    vi.spyOn(downloadsRepo, 'getDownloads').mockReturnValue({
      'tt_movie_watched_recent': {
        fileId: 'tt_movie_watched_recent',
        sizeBytes: 30 * 1024 * 1024 * 1024, // 30 GB
        downloadTime: 1000
      },
      'tt_movie_watched_old': {
        fileId: 'tt_movie_watched_old',
        sizeBytes: 30 * 1024 * 1024 * 1024, // 30 GB
        downloadTime: 2000
      },
      'tt_movie_unwatched': {
        fileId: 'tt_movie_unwatched',
        sizeBytes: 30 * 1024 * 1024 * 1024, // 30 GB
        downloadTime: 500 // Oldest download time, never watched
      }
    });

    // Mock DB queries for watch progress
    const dbPrepareSpy = vi.spyOn(db, 'prepare').mockReturnValue({
      all: vi.fn().mockImplementation((...ids: string[]) => {
        // Return watch progress
        const rows = [];
        if (ids.includes('tt_movie_watched_recent')) {
          rows.push({ id: 'tt_movie_watched_recent', last_updated: 9000 });
        }
        if (ids.includes('tt_movie_watched_old')) {
          rows.push({ id: 'tt_movie_watched_old', last_updated: 2000 });
        }
        // tt_movie_unwatched has no progress (returns null)
        return rows;
      })
    } as any);

    // Mock getMediaDirs and fs.existsSync
    vi.spyOn(helpers, 'getMediaDirs').mockImplementation((fileId: string) => ({
      baseDir: `/mock/downloads/movies/${fileId}`,
      subtitlesDir: `/mock/downloads/movies/${fileId}/subtitles`,
      hlsDir: `/mock/downloads/movies/${fileId}/hls`
    }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeDownloadSpy = vi.spyOn(downloadsRepo, 'removeDownloadEntry').mockImplementation(() => {});
    const sseSpy = vi.spyOn(sseManager, 'broadcastDownloadStatus').mockImplementation(() => {});

    // Need to free at least 10 GB (110 - 100). Evicting the first 30GB item will bring total to 60 + 20 = 80 GB <= 100 GB.
    // Order of sortKey:
    // 1. tt_movie_unwatched (sortKey = downloadTime = 500)
    // 2. tt_movie_watched_old (sortKey = last_updated = 2000)
    // 3. tt_movie_watched_recent (sortKey = last_updated = 9000)
    evictionManager.ensureFreeSpace(20 * 1024 * 1024 * 1024);

    // Only 1 item should be evicted because 30 GB freed is enough
    expect(rmSyncSpy).toHaveBeenCalledTimes(1);
    expect(rmSyncSpy).toHaveBeenCalledWith('/mock/downloads/movies/tt_movie_unwatched', { recursive: true, force: true });
    expect(removeDownloadSpy).toHaveBeenCalledWith('tt_movie_unwatched');
    expect(sseSpy).toHaveBeenCalledWith('tt_movie_unwatched', DOWNLOAD_STATUS.REMOVED);

    expect(dbPrepareSpy).toHaveBeenCalled();
  });

  it('should evict multiple items in order until enough space is reclaimed', () => {
    vi.spyOn(downloadsRepo, 'scanDownloads').mockImplementation(() => {});

    // Existing: 4 items of 25 GB each = 100 GB. Incoming: 60 GB.
    // Need to free 60 GB -> evict 3 items (75 GB).
    vi.spyOn(downloadsRepo, 'getDownloads').mockReturnValue({
      'item_1': { fileId: 'item_1', sizeBytes: 25 * 1024 * 1024 * 1024, downloadTime: 100 },
      'item_2': { fileId: 'item_2', sizeBytes: 25 * 1024 * 1024 * 1024, downloadTime: 200 },
      'item_3': { fileId: 'item_3', sizeBytes: 25 * 1024 * 1024 * 1024, downloadTime: 300 },
      'item_4': { fileId: 'item_4', sizeBytes: 25 * 1024 * 1024 * 1024, downloadTime: 400 }
    });

    vi.spyOn(db, 'prepare').mockReturnValue({
      all: vi.fn().mockReturnValue([]) // none watched, sort by downloadTime
    } as any);

    vi.spyOn(helpers, 'getMediaDirs').mockImplementation((fileId: string) => ({
      baseDir: `/mock/downloads/movies/${fileId}`,
      subtitlesDir: `/mock/downloads/movies/${fileId}/subtitles`,
      hlsDir: `/mock/downloads/movies/${fileId}/hls`
    }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeDownloadSpy = vi.spyOn(downloadsRepo, 'removeDownloadEntry').mockImplementation(() => {});
    const sseSpy = vi.spyOn(sseManager, 'broadcastDownloadStatus').mockImplementation(() => {});

    evictionManager.ensureFreeSpace(60 * 1024 * 1024 * 1024);

    expect(rmSyncSpy).toHaveBeenCalledTimes(3);
    expect(removeDownloadSpy).toHaveBeenNthCalledWith(1, 'item_1');
    expect(removeDownloadSpy).toHaveBeenNthCalledWith(2, 'item_2');
    expect(removeDownloadSpy).toHaveBeenNthCalledWith(3, 'item_3');
    expect(sseSpy).toHaveBeenCalledWith('item_1', DOWNLOAD_STATUS.REMOVED);
    expect(sseSpy).toHaveBeenCalledWith('item_2', DOWNLOAD_STATUS.REMOVED);
    expect(sseSpy).toHaveBeenCalledWith('item_3', DOWNLOAD_STATUS.REMOVED);
  });

  it('should query episode_progress for series episodes and movie_progress for movies', () => {
    vi.spyOn(downloadsRepo, 'scanDownloads').mockImplementation(() => {});

    vi.spyOn(downloadsRepo, 'getDownloads').mockReturnValue({
      'tt0137523': { fileId: 'tt0137523', sizeBytes: 60 * 1024 * 1024 * 1024, downloadTime: 100 },
      'tt0944947_s1_e1': { fileId: 'tt0944947_s1_e1', sizeBytes: 60 * 1024 * 1024 * 1024, downloadTime: 200 }
    });

    const prepareAllSpy = vi.fn().mockImplementation((id: string) => {
      if (id === 'tt0137523') return [{ id: 'tt0137523', last_updated: 5000 }];
      if (id === 'tt0944947_s1_e1') return [{ id: 'tt0944947_s1_e1', last_updated: 1000 }];
      return [];
    });

    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      return {
        all: prepareAllSpy
      } as any;
    });

    vi.spyOn(helpers, 'getMediaDirs').mockImplementation((fileId: string) => ({
      baseDir: `/mock/downloads/${fileId}`,
      subtitlesDir: `/mock/downloads/${fileId}/subtitles`,
      hlsDir: `/mock/downloads/${fileId}/hls`
    }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    vi.spyOn(downloadsRepo, 'removeDownloadEntry').mockImplementation(() => {});
    vi.spyOn(sseManager, 'broadcastDownloadStatus').mockImplementation(() => {});

    // 120 GB existing + 0 GB incoming > 100 GB limit.
    // Episode was watched at 1000, Movie was watched at 5000.
    // Episode should be evicted first.
    evictionManager.ensureFreeSpace(0);

    expect(downloadsRepo.removeDownloadEntry).toHaveBeenCalledWith('tt0944947_s1_e1');
  });

  it('should handle filesystem deletion failure gracefully without throwing', () => {
    vi.spyOn(downloadsRepo, 'scanDownloads').mockImplementation(() => {});
    vi.spyOn(downloadsRepo, 'getDownloads').mockReturnValue({
      'tt_fail': { fileId: 'tt_fail', sizeBytes: 150 * 1024 * 1024 * 1024, downloadTime: 100 }
    });

    vi.spyOn(db, 'prepare').mockReturnValue({
      all: vi.fn().mockReturnValue([])
    } as any);

    vi.spyOn(helpers, 'getMediaDirs').mockReturnValue({
      baseDir: '/mock/fail/dir',
      subtitlesDir: '/mock/fail/dir/subtitles',
      hlsDir: '/mock/fail/dir/hls'
    });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => evictionManager.ensureFreeSpace(0)).not.toThrow();
  });
});
