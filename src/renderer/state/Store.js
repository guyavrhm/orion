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
      ready: {},           // Caches ready media state objects (keyed by movieId or episodeId)
      activeMediaRequests: {}, // Maps fileId -> { fileId, status, progress } for all in-flight media requests
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
      
      // If merging episodes array, merge by episode ID (season & episode) to not overwrite existing episodes
      if (key === 'episodes' && Array.isArray(val) && Array.isArray(existing.episodes)) {
        const mergedEpisodes = [...existing.episodes];
        val.forEach(newEp => {
          const epNum = newEp.episode;
          const idx = mergedEpisodes.findIndex(v => v.season === newEp.season && v.episode === epNum);
          if (idx > -1) {
            mergedEpisodes[idx] = { ...mergedEpisodes[idx], ...newEp };
          } else {
            mergedEpisodes.push(newEp);
          }
        });
        merged.episodes = mergedEpisodes;
        continue;
      }

      // Preserve populated arrays if the incoming array is empty
      if (Array.isArray(val) && val.length === 0 && Array.isArray(existing[key]) && existing[key].length > 0) {
        continue;
      }
      
      merged[key] = val;
    }
    
    // Clean up temporary inline states
    delete merged.progress;
    delete merged.is_ready;
    
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
   * Cache a batch of ready media records atomically.
   */
  cacheReadyBatch(items) {
    if (!items || typeof items !== 'object') return;
    const entries = Array.isArray(items) ? items : Object.values(items);
    if (entries.length === 0) return;

    const updatedReady = { ...this.state.ready };
    let hasUpdates = false;

    for (const item of entries) {
      const id = item.id;
      if (!id) continue;
      updatedReady[id] = item;
      hasUpdates = true;
    }

    if (hasUpdates) {
      this.updateState({ ready: updatedReady }, 'requests-changed');
    }
  }

  /**
   * Cache a single ready media record.
   */
  cacheReady(item) {
    if (!item) return;
    this.cacheReadyBatch([item]);
  }

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
    const prog = this.state.progress[movieId];
    return {
      id: movieId,
      timestamp: prog?.timestamp ?? 0,
      runtime: prog?.runtime ?? 0,
      last_updated: prog?.last_updated ?? null,
      is_ready: this.isMovieReady(movieId)
    };
  }

  getShowConfig(showId) {
    const episodes = {};
    let last_season = 1;
    let last_episode = 1;
    let last_updated = null;
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
            timestamp: p.timestamp ?? 0,
            runtime: p.runtime ?? 0,
            last_updated: p.last_updated ?? null,
            is_ready: this.isEpisodeReady(showId, season, episode)
          };
          
          if (p.last_updated && p.last_updated > latestTime) {
            latestTime = p.last_updated;
            last_updated = p.last_updated;
            last_season = season;
            last_episode = episode;
          }
        }
      }
    });

    return {
      id: showId,
      last_season,
      last_episode,
      last_updated,
      episodes
    };
  }

  // --- Ready / Request State Getters/Setters ---

  isMovieReady(movieId) {
    return Boolean(this.state.ready[movieId]);
  }

  isEpisodeReady(showId, season, episode) {
    const episodeId = `${showId}_s${season}_e${episode}`;
    return Boolean(this.state.ready[episodeId]);
  }

  getActiveMediaRequest(fileId) {
    return this.state.activeMediaRequests[fileId] ?? null;
  }

  isPreparingOrQueued(fileId) {
    return this.getActiveMediaRequest(fileId);
  }

  setActiveMediaRequest(fileId, status, progress = '0.00') {
    const activeObj = { fileId, status, progress: String(progress) };
    const updatedActive = {
      ...this.state.activeMediaRequests,
      [fileId]: activeObj
    };
    this.updateState(
      { activeMediaRequests: updatedActive },
      'request-progress-updated',
      activeObj
    );
  }

  removeActiveMediaRequest(fileId) {
    if (!this.state.activeMediaRequests || !this.state.activeMediaRequests[fileId]) return;
    const updatedActive = { ...this.state.activeMediaRequests };
    delete updatedActive[fileId];
    this.updateState({ activeMediaRequests: updatedActive }, 'requests-changed', { fileId });
  }

  setMediaRequestStatus(fileId, isReady) {
    const updatedReady = { ...this.state.ready };
    const updatedActive = { ...this.state.activeMediaRequests };

    if (isReady) {
      updatedReady[fileId] = {
        id: fileId,
        show_id: null,
        quality: 'unknown',
        size_bytes: 0,
        ready_at: Date.now()
      };
      delete updatedActive[fileId];
    } else {
      delete updatedReady[fileId];
      delete updatedActive[fileId];
    }

    this.updateState({
      ready: updatedReady,
      activeMediaRequests: updatedActive
    }, 'requests-changed', { fileId, isReady });
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
      this.addOrUpdateContinueWatching(id, 'show', { 
        season, 
        episode, 
        timestamp: data.timestamp 
      });
    }
  }

  addOrUpdateContinueWatching(id, type, progressData) {
    const listKey = type === 'movie' ? 'continueWatchingMovies' : 'continueWatchingShows';
    let list = [...(this.state[listKey] || [])];
    
    const episodeId = type === 'show' ? `${id}_s${progressData.season}_e${progressData.episode}` : id;
    
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
