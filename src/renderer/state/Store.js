/**
 * Centralized state store for Orion PWA Client.
 * Implements a simple reactive publish-subscribe pattern.
 */
class Store {
  constructor() {
    this.state = {
      currentPage: 'movies', // 'movies', 'shows', 'search'
      metadata: {},        // Caches media metadata by ID (IMDb ID)
      progress: {},        // Caches watch progress objects (keyed by movieId or episodeId)
      downloads: {},       // Caches download state objects (keyed by movieId or episodeId)
      activeDownloads: {}, // Maps fileId -> { fileId, status, progress } for all in-flight downloads/processing
      popularMovies: null,           // list of movie IDs: string[]
      popularShows: null,            // list of show IDs: string[]
      continueWatchingMovies: null,  // list of movie reference objects: { id, last_updated }
      continueWatchingShows: null,   // list of show reference objects: { id, episodeId, last_updated }
    };
    this.listeners = new Set();
  }

  /**
   * Subscribe to state change notifications.
   * Returns a cleanup function to unsubscribe.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all subscribers of state changes.
   */
  notify(changeType, detail) {
    for (const listener of this.listeners) {
      try {
        listener(changeType, this.state, detail);
      } catch (err) {
        console.error('[Store] Subscription listener failed:', err);
      }
    }
  }

  /**
   * Partially update the state and notify subscribers.
   */
  updateState(updates, changeType = 'generic', detail = null) {
    this.state = { ...this.state, ...updates };
    this.notify(changeType, detail);
  }

  // --- Cache Helpers ---

  /**
   * Cache media metadata, merging with existing data safely to avoid overwriting complete structures.
   */
  cacheMetadata(item) {
    if (!item || !item.id) return;
    const existing = this.state.metadata[item.id] || {};
    
    const merged = { ...existing };
    if (item._isFull) {
      merged._isFull = true;
    }
    for (const key of Object.keys(item)) {
      const val = item[key];
      // Skip undefined/null values
      if (val === undefined || val === null) {
        continue;
      }
      
      // If merging videos array, merge by episode ID (season & episode) to not overwrite existing episodes
      if (key === 'videos' && Array.isArray(val) && Array.isArray(existing.videos)) {
        const mergedVideos = [...existing.videos];
        val.forEach(newVideo => {
          const epNum = newVideo.episode || newVideo.number;
          const idx = mergedVideos.findIndex(v => v.season === newVideo.season && (v.episode === epNum || v.number === epNum));
          if (idx > -1) {
            mergedVideos[idx] = { ...mergedVideos[idx], ...newVideo };
          } else {
            mergedVideos.push(newVideo);
          }
        });
        merged.videos = mergedVideos;
        continue;
      }

      // Preserve populated arrays if the incoming array is empty
      if (Array.isArray(val) && val.length === 0 && Array.isArray(existing[key]) && existing[key].length > 0) {
        continue;
      }
      
      merged[key] = val;
    }
    
    // Explicitly clean up any temporary inline states
    delete merged.progress;
    delete merged.is_downloaded;
    
    const updatedMetadata = { ...this.state.metadata };
    updatedMetadata[item.id] = merged;

    this.updateState({ metadata: updatedMetadata }, 'metadata-cached', { id: item.id });
  }

  /**
   * Cache a batch of progress records atomically.
   */
  cacheProgressBatch(items) {
    if (!items || typeof items !== 'object') return;
    const entries = Array.isArray(items) ? items : Object.values(items);
    if (entries.length === 0) return;

    const updatedProgress = { ...this.state.progress };
    let hasUpdates = false;

    for (const prog of entries) {
      if (!prog || !prog.id) continue;
      updatedProgress[prog.id] = prog;
      hasUpdates = true;

      // If show progress has nested episodes, index each episode under its canonical key
      if (prog.episodes && typeof prog.episodes === 'object') {
        Object.values(prog.episodes).forEach(ep => {
          if (ep && typeof ep.season === 'number' && typeof ep.episode === 'number') {
            const epId = `${prog.id}_s${ep.season}_e${ep.episode}`;
            updatedProgress[epId] = {
              id: epId,
              show_id: prog.id,
              season: ep.season,
              episode: ep.episode,
              timestamp: ep.timestamp || 0,
              runtime: ep.runtime || 0,
              last_updated: ep.last_updated || prog.last_updated
            };
          }
        });
      }
    }

    if (hasUpdates) {
      this.updateState({ progress: updatedProgress }, 'progress-updated');
    }
  }

  /**
   * Cache a single progress record.
   */
  cacheProgress(prog) {
    if (!prog || !prog.id) return;
    this.cacheProgressBatch([prog]);
  }

  /**
   * Cache a batch of download records atomically.
   */
  cacheDownloadsBatch(items) {
    if (!items || typeof items !== 'object') return;
    const entries = Array.isArray(items) ? items : Object.values(items);
    if (entries.length === 0) return;

    const updatedDownloads = { ...this.state.downloads };
    let hasUpdates = false;

    for (const dl of entries) {
      const id = dl.id || dl.fileId || dl.movie_id || dl.episode_id;
      if (!id) continue;
      updatedDownloads[id] = { id, is_downloaded: true, ...dl };
      hasUpdates = true;
    }

    if (hasUpdates) {
      this.updateState({ downloads: updatedDownloads }, 'downloads-changed');
    }
  }

  /**
   * Cache a single download record.
   */
  cacheDownload(dl) {
    if (!dl) return;
    this.cacheDownloadsBatch([dl]);
  }

  // Backward compatibility alias for metadata lookup
  getMedia(id) {
    return this.state.metadata[id] || null;
  }

  getFullMedia(id) {
    const cached = this.state.metadata[id];
    return (cached && cached._isFull) ? cached : null;
  }

  hasFullMedia(id) {
    const cached = this.state.metadata[id];
    return !!(cached && cached._isFull);
  }

  getMovieConfig(movieId) {
    const progress = this.state.progress[movieId] || { timestamp: 0 };
    const isDownloaded = this.isMovieDownloaded(movieId);
    return {
      ...progress,
      is_downloaded: isDownloaded
    };
  }

  getShowConfig(showId) {
    const episodes = {};
    let last_season = 1;
    let last_episode = 1;
    let latestTime = 0;

    // Collect episode progress records
    Object.keys(this.state.progress).forEach(key => {
      if (key.startsWith(`${showId}_s`)) {
        const match = key.match(/^(.+)_s(\d+)_e(\d+)$/);
        if (match) {
          const season = parseInt(match[2], 10);
          const episode = parseInt(match[3], 10);
          const p = this.state.progress[key];
          episodes[key] = {
            id: key,
            show_id: showId,
            season,
            episode,
            timestamp: p.timestamp,
            runtime: p.runtime || 0,
            is_downloaded: this.isEpisodeDownloaded(showId, season, episode)
          };
          
          if (p.last_updated && p.last_updated > latestTime) {
            latestTime = p.last_updated;
            last_season = season;
            last_episode = episode;
          }
        }
      }
    });

    return {
      last_season,
      last_episode,
      episodes
    };
  }

  // --- Download State Getters/Setters ---

  isMovieDownloaded(movieId) {
    const dl = this.state.downloads[movieId];
    return !!(dl && (dl.is_downloaded || dl.isDownloaded));
  }

  isEpisodeDownloaded(showId, season, episode) {
    const episodeId = `${showId}_s${season}_e${episode}`;
    const dl = this.state.downloads[episodeId];
    return !!(dl && (dl.is_downloaded || dl.isDownloaded));
  }

  getActiveDownload(fileId) {
    return this.state.activeDownloads[fileId] || null;
  }

  isDownloadingOrQueued(fileId) {
    return this.getActiveDownload(fileId);
  }

  setActiveDownload(fileId, status, progress = '0.00') {
    const updatedActive = {
      ...this.state.activeDownloads,
      [fileId]: { fileId, status, progress: String(progress) }
    };
    this.updateState(
      { activeDownloads: updatedActive },
      'download-progress-updated',
      { fileId, status, progress: String(progress) }
    );
  }

  removeActiveDownload(fileId) {
    if (!this.state.activeDownloads[fileId]) return;
    const updatedActive = { ...this.state.activeDownloads };
    delete updatedActive[fileId];
    this.updateState({ activeDownloads: updatedActive }, 'downloads-changed', { fileId });
  }

  setDownloadStatus(fileId, isDownloaded) {
    const updatedDownloads = { ...this.state.downloads };
    const updatedActive = { ...this.state.activeDownloads };

    if (isDownloaded) {
      updatedDownloads[fileId] = {
        id: fileId,
        is_downloaded: true
      };
      delete updatedActive[fileId];
    } else {
      delete updatedDownloads[fileId];
      delete updatedActive[fileId];
    }

    this.updateState({
      downloads: updatedDownloads,
      activeDownloads: updatedActive
    }, 'downloads-changed', { fileId, isDownloaded });
  }

  updateLocalProgressCache(data) {
    if (data.timestamp === undefined) return;
    const id = data.movieId || data.showId;
    if (!id) return;
    
    const timestamp = Date.now();
    const updatedProgress = { ...this.state.progress };
    
    if (data.movieId) {
      updatedProgress[id] = {
        id,
        timestamp: data.timestamp,
        runtime: data.metadata ? data.metadata.runtime : 0,
        last_updated: timestamp
      };
      this.updateState({ progress: updatedProgress }, 'progress-updated', { id });
      this.addOrUpdateContinueWatching(id, 'movie', { timestamp: data.timestamp });
    } else {
      const season = data.metadata.season;
      const episode = data.metadata.episode;
      const episodeId = `${id}_s${season}_e${episode}`;
      
      updatedProgress[episodeId] = {
        id: episodeId,
        timestamp: data.timestamp,
        runtime: data.metadata.runtime || 0,
        last_updated: timestamp
      };
      this.updateState({ progress: updatedProgress }, 'progress-updated', { id });
      this.addOrUpdateContinueWatching(id, 'series', { 
        season, 
        episode, 
        timestamp: data.timestamp 
      });
    }
  }

  addOrUpdateContinueWatching(id, type, progressData) {
    const listKey = type === 'movie' ? 'continueWatchingMovies' : 'continueWatchingShows';
    let list = [...(this.state[listKey] || [])];
    
    const episodeId = type === 'series' ? `${id}_s${progressData.season}_e${progressData.episode}` : id;
    
    // Remove existing entry
    list = list.filter(item => item.id !== id);
    
    // Unshift new entry
    list.unshift({
      id,
      episodeId,
      last_updated: Date.now()
    });
    
    if (list.length > 10) {
      list = list.slice(0, 10);
    }
    
    this.updateState({ [listKey]: list }, 'continue-watching-updated');
  }
}

export const store = new Store();
