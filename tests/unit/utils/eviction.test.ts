import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { EvictionManager } from '../../../src/main/utils/eviction.js';
import { streamsRepo } from '../../../src/main/db/streams.js';
import { sseManager } from '../../../src/main/sse/index.js';
import { db } from '../../../src/main/db/index.js';
import * as helpers from '../../../src/main/utils/helpers.js';
import { MEDIA_REQUEST_STATUS } from '../../../src/main/types/index.js';

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
    vi.spyOn(streamsRepo, 'scanStreams').mockImplementation(() => {});
    vi.spyOn(streamsRepo, 'getStreams').mockReturnValue({
      'tt0137523': {
        fileId: 'tt0137523',
        size_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
        ready_at: 1000
      }
    });

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeStreamSpy = vi.spyOn(streamsRepo, 'removeStream').mockImplementation(() => {});
    const sseSpy = vi.spyOn(sseManager, 'broadcastMediaRequestStatus').mockImplementation(() => Promise.resolve(1));

    // Incoming 5 GB, total 15 GB <= 100 GB default limit
    evictionManager.ensureFreeSpace(5 * 1024 * 1024 * 1024);

    expect(rmSyncSpy).not.toHaveBeenCalled();
    expect(removeStreamSpy).not.toHaveBeenCalled();
    expect(sseSpy).not.toHaveBeenCalled();
  });

  it('should do nothing if stream list is empty even if incoming size exceeds limit', () => {
    vi.spyOn(streamsRepo, 'scanStreams').mockImplementation(() => {});
    vi.spyOn(streamsRepo, 'getStreams').mockReturnValue({});

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeStreamSpy = vi.spyOn(streamsRepo, 'removeStream').mockImplementation(() => {});

    // Incoming 150 GB > 100 GB limit
    evictionManager.ensureFreeSpace(150 * 1024 * 1024 * 1024);

    expect(rmSyncSpy).not.toHaveBeenCalled();
    expect(removeStreamSpy).not.toHaveBeenCalled();
  });

  it('should evict least recently watched items first (LRU) when limit is exceeded', () => {
    vi.spyOn(streamsRepo, 'scanStreams').mockImplementation(() => {});
    
    // Total existing = 90 GB. Incoming = 20 GB. Total = 110 GB (> 100 GB limit).
    vi.spyOn(streamsRepo, 'getStreams').mockReturnValue({
      'tt_movie_watched_recent': {
        fileId: 'tt_movie_watched_recent',
        size_bytes: 30 * 1024 * 1024 * 1024, // 30 GB
        ready_at: 1000
      },
      'tt_movie_watched_old': {
        fileId: 'tt_movie_watched_old',
        size_bytes: 30 * 1024 * 1024 * 1024, // 30 GB
        ready_at: 2000
      },
      'tt_movie_unwatched': {
        fileId: 'tt_movie_unwatched',
        size_bytes: 30 * 1024 * 1024 * 1024, // 30 GB
        ready_at: 500 // Oldest ready time, never watched
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
      baseDir: `/mock/streams/movies/${fileId}`,
      subtitlesDir: `/mock/streams/movies/${fileId}/subtitles`,
      hlsDir: `/mock/streams/movies/${fileId}/hls`
    }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeStreamSpy = vi.spyOn(streamsRepo, 'removeStream').mockImplementation(() => {});
    const sseSpy = vi.spyOn(sseManager, 'broadcastMediaRequestStatus').mockImplementation(() => Promise.resolve(1));

    // Need to free at least 10 GB (110 - 100). Evicting the first 30GB item will bring total to 60 + 20 = 80 GB <= 100 GB.
    // Order of sortKey:
    // 1. tt_movie_unwatched (sortKey = ready_at = 500)
    // 2. tt_movie_watched_old (sortKey = last_updated = 2000)
    // 3. tt_movie_watched_recent (sortKey = last_updated = 9000)
    evictionManager.ensureFreeSpace(20 * 1024 * 1024 * 1024);

    // Only 1 item should be evicted because 30 GB freed is enough
    expect(rmSyncSpy).toHaveBeenCalledTimes(1);
    expect(rmSyncSpy).toHaveBeenCalledWith('/mock/streams/movies/tt_movie_unwatched', { recursive: true, force: true });
    expect(removeStreamSpy).toHaveBeenCalledWith('tt_movie_unwatched');
    expect(sseSpy).toHaveBeenCalledWith('tt_movie_unwatched', MEDIA_REQUEST_STATUS.REMOVED);

    expect(dbPrepareSpy).toHaveBeenCalled();
  });

  it('should evict multiple items in order until enough space is reclaimed', () => {
    vi.spyOn(streamsRepo, 'scanStreams').mockImplementation(() => {});

    // Existing: 4 items of 25 GB each = 100 GB. Incoming: 60 GB.
    // Need to free 60 GB -> evict 3 items (75 GB).
    vi.spyOn(streamsRepo, 'getStreams').mockReturnValue({
      'item_1': { fileId: 'item_1', size_bytes: 25 * 1024 * 1024 * 1024, ready_at: 100 },
      'item_2': { fileId: 'item_2', size_bytes: 25 * 1024 * 1024 * 1024, ready_at: 200 },
      'item_3': { fileId: 'item_3', size_bytes: 25 * 1024 * 1024 * 1024, ready_at: 300 },
      'item_4': { fileId: 'item_4', size_bytes: 25 * 1024 * 1024 * 1024, ready_at: 400 }
    });

    vi.spyOn(db, 'prepare').mockReturnValue({
      all: vi.fn().mockReturnValue([]) // none watched, sort by ready_at
    } as any);

    vi.spyOn(helpers, 'getMediaDirs').mockImplementation((fileId: string) => ({
      baseDir: `/mock/streams/movies/${fileId}`,
      subtitlesDir: `/mock/streams/movies/${fileId}/subtitles`,
      hlsDir: `/mock/streams/movies/${fileId}/hls`
    }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    const removeStreamSpy = vi.spyOn(streamsRepo, 'removeStream').mockImplementation(() => {});
    const sseSpy = vi.spyOn(sseManager, 'broadcastMediaRequestStatus').mockImplementation(() => Promise.resolve(1));

    evictionManager.ensureFreeSpace(60 * 1024 * 1024 * 1024);

    expect(rmSyncSpy).toHaveBeenCalledTimes(3);
    expect(removeStreamSpy).toHaveBeenNthCalledWith(1, 'item_1');
    expect(removeStreamSpy).toHaveBeenNthCalledWith(2, 'item_2');
    expect(removeStreamSpy).toHaveBeenNthCalledWith(3, 'item_3');
    expect(sseSpy).toHaveBeenCalledWith('item_1', MEDIA_REQUEST_STATUS.REMOVED);
    expect(sseSpy).toHaveBeenCalledWith('item_2', MEDIA_REQUEST_STATUS.REMOVED);
    expect(sseSpy).toHaveBeenCalledWith('item_3', MEDIA_REQUEST_STATUS.REMOVED);
  });

  it('should query progress for items and evict oldest watched first', () => {
    vi.spyOn(streamsRepo, 'scanStreams').mockImplementation(() => {});

    vi.spyOn(streamsRepo, 'getStreams').mockReturnValue({
      'tt0137523': { fileId: 'tt0137523', size_bytes: 60 * 1024 * 1024 * 1024, ready_at: 100 },
      'tt0944947_s1_e1': { fileId: 'tt0944947_s1_e1', size_bytes: 60 * 1024 * 1024 * 1024, ready_at: 200 }
    });

    const prepareAllSpy = vi.fn().mockImplementation((...ids: string[]) => {
      const rows = [];
      if (ids.includes('tt0137523')) rows.push({ id: 'tt0137523', last_updated: 5000 });
      if (ids.includes('tt0944947_s1_e1')) rows.push({ id: 'tt0944947_s1_e1', last_updated: 1000 });
      return rows;
    });

    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      return {
        all: prepareAllSpy
      } as any;
    });

    vi.spyOn(helpers, 'getMediaDirs').mockImplementation((fileId: string) => ({
      baseDir: `/mock/streams/${fileId}`,
      subtitlesDir: `/mock/streams/${fileId}/subtitles`,
      hlsDir: `/mock/streams/${fileId}/hls`
    }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    vi.spyOn(streamsRepo, 'removeStream').mockImplementation(() => {});
    vi.spyOn(sseManager, 'broadcastMediaRequestStatus').mockImplementation(() => Promise.resolve(1));

    // 120 GB existing + 0 GB incoming > 100 GB limit.
    // Episode was watched at 1000, Movie was watched at 5000.
    // Episode should be evicted first.
    evictionManager.ensureFreeSpace(0);

    expect(streamsRepo.removeStream).toHaveBeenCalledWith('tt0944947_s1_e1');
  });

  it('should handle filesystem deletion failure gracefully without throwing', () => {
    vi.spyOn(streamsRepo, 'scanStreams').mockImplementation(() => {});
    vi.spyOn(streamsRepo, 'getStreams').mockReturnValue({
      'tt_fail': { fileId: 'tt_fail', size_bytes: 150 * 1024 * 1024 * 1024, ready_at: 100 }
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
