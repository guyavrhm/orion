import { store } from '../state/Store.js';

class ApiService {
  constructor() {
    this.apiBaseUrl = '';
  }

  processBackendResponse(path, method, data) {
    console.log(`[ApiService Response] ${method} ${path}`);
    if (data) {
      if (data.metadata) {
        if (Array.isArray(data.metadata)) {
          data.metadata.forEach(item => store.cacheMetadata(item));
        } else {
          store.cacheMetadata(data.metadata);
        }
      }
      if (data.progress) {
        store.cacheProgressBatch(data.progress);
      }
      if (data.ready) {
        store.cacheReadyBatch(data.ready);
      }
    }
  }

  async get(path) {
    const targetUrl = `${this.apiBaseUrl}${path}`;
    console.log(`[ApiService Request] GET ${targetUrl}`);
    try {
      const resp = await fetch(targetUrl);
      if (!resp.ok) {
        let errCode = `HTTP_${resp.status}`;
        const errJson = await resp.json().catch(() => null);
        if (errJson?.error) {
          errCode = errJson.error;
        }
        const error = new Error(errCode);
        error.code = errCode;
        error.status = resp.status;
        throw error;
      }
      const data = await resp.json();
      this.processBackendResponse(path, 'GET', data);
      return data;
    } catch (e) {
      console.error(`[ApiService Error] GET ${path}`, e);
      throw e;
    }
  }

  async post(path, body) {
    const targetUrl = `${this.apiBaseUrl}${path}`;
    console.log(`[ApiService Request] POST ${targetUrl}`);
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        let errCode = `HTTP_${response.status}`;
        const errJson = await response.json().catch(() => null);
        if (errJson?.error) {
          errCode = errJson.error;
        }
        const error = new Error(errCode);
        error.code = errCode;
        error.status = response.status;
        throw error;
      }
      const data = await response.json().catch(() => ({}));
      this.processBackendResponse(path, 'POST', data);
      return data;
    } catch (e) {
      console.error(`[ApiService Error] POST ${path}`, e);
      throw e;
    }
  }

  async fetchMovies(limit = 11) {
    const data = await this.get(`/api/movies?limit=${limit}`);
    const ids = data.metadata.map(item => item.id);
    store.updateState({ popularMovies: ids }, 'popular-movies-updated');
    return ids;
  }

  async fetchShows(limit = 11) {
    const data = await this.get(`/api/shows?limit=${limit}`);
    const ids = data.metadata.map(item => item.id);
    store.updateState({ popularShows: ids }, 'popular-shows-updated');
    return ids;
  }

  async fetchMovieDetails(movieId) {
    const cached = store.getFullMedia(movieId);
    if (cached) {
      const prog = store.state.progress[movieId];
      const r = store.state.ready ? store.state.ready[movieId] : null;
      return {
        metadata: cached,
        progress: prog ? { [movieId]: prog } : {},
        ready: r ? { [movieId]: r } : {}
      };
    }

    const data = await this.get(`/api/movies/${movieId}`);
    if (data && data.metadata) {
      data.metadata._isFull = true;
      store.cacheMetadata(data.metadata);
    }
    return data;
  }

  async fetchShowDetails(showId) {
    const cached = store.getFullMedia(showId);
    if (cached) {
      const progress = {};
      const ready = {};
      Object.keys(store.state.progress).forEach(key => {
        if (key.startsWith(`${showId}_s`)) {
          progress[key] = store.state.progress[key];
        }
      });
      Object.keys(store.state.ready).forEach(key => {
        if (key.startsWith(`${showId}_s`)) {
          ready[key] = store.state.ready[key];
        }
      });
      return {
        metadata: cached,
        progress,
        ready
      };
    }

    const data = await this.get(`/api/shows/${showId}`);
    if (data && data.metadata) {
      data.metadata._isFull = true;
      store.cacheMetadata(data.metadata);
    }
    return data;
  }

  async fetchContinueWatching(type, limit = 10) {
    const listKey = type === 'movie' ? 'continueWatchingMovies' : 'continueWatchingShows';

    const data = await this.get(`/api/continue-watching?type=${type}&limit=${limit}`);
    const metadataList = data.metadata ?? [];
    const progressMap = data.progress ?? {};

    const referenceList = metadataList.map(item => {
      let episodeId = item.id;
      if (type === 'show') {
        const activeEp = item.episodes && item.episodes[0];
        if (activeEp) {
          const epNum = activeEp.episode;
          episodeId = `${item.id}_s${activeEp.season}_e${epNum}`;
        } else {
          const matchingKey = Object.keys(progressMap).find(k => k.startsWith(`${item.id}_s`));
          if (matchingKey) {
            episodeId = matchingKey;
          }
        }
      }
      const prog = progressMap[episodeId] ?? {};
      return {
        id: item.id,
        episodeId,
        last_updated: prog.last_updated ?? Date.now()
      };
    });

    store.updateState({ [listKey]: referenceList }, 'continue-watching-updated');
    return { ...data, references: referenceList };
  }

  async performSearch(query) {
    return this.get(`/api/search?q=${encodeURIComponent(query)}`);
  }

  async fetchQueueState() {
    return this.get('/api/queue');
  }

  async saveTimestamp(data) {
    const isShow = !!data.showId;
    const season = data.season ?? data.metadata?.season;
    const episode = data.episode ?? data.metadata?.episode;
    const fileId = isShow ? `${data.showId}_s${season}_e${episode}` : data.movieId;
    const payload = {
      timestamp: data.timestamp,
      runtime: data.metadata?.runtime !== undefined ? Number(data.metadata.runtime) : undefined
    };
    // Update local cache synchronously
    store.updateLocalProgressCache(data);
    return this.post(`/api/media/${encodeURIComponent(fileId)}/progress`, payload);
  }

  async getSubtitlePreference(mediaId) {
    try {
      const data = await this.get(`/api/media/${encodeURIComponent(mediaId)}/subtitles/preference`);
      return data ? data.subtitle_lang : null;
    } catch (e) {
      console.error('[ApiService] Failed to get subtitle preference:', e);
      return null;
    }
  }

  async saveSubtitlePreference(mediaId, lang) {
    return this.post(`/api/media/${encodeURIComponent(mediaId)}/subtitles/preference`, { subtitle_lang: lang });
  }

  async startStream(payload) {
    const fileId = typeof payload === 'string'
      ? payload
      : (payload.movieId ?? `${payload.showId}_s${payload.season}_e${payload.episode}`);
    return this.get(`/api/media/${encodeURIComponent(fileId)}/stream`);
  }

  async enqueueMediaRequest({ movieId, showId, season, episode }) {
    const fileId = movieId ?? `${showId}_s${season}_e${episode}`;
    
    // Background fetch full metadata if not already fully cached to hydrate store details
    if (movieId) {
      this.fetchMovieDetails(movieId).catch(err => {
        console.error('[ApiService] Failed to fetch movie details in background on request:', err);
      });
    }

    // Optimistically set queued state if not already active or ready
    if (!store.isPreparingOrQueued(fileId) && !store.isMovieReady(fileId) && !store.isEpisodeReady(showId, season, episode)) {
      store.setActiveMediaRequest(fileId, 'queued', '0.00');
    }
    
    try {
      const res = await this.post(`/api/media/${encodeURIComponent(fileId)}/request`, {});
      if (res && (res.status === 'ready' || res.status === 'completed')) {
        store.setMediaRequestStatus(fileId, true);
      } else {
        // Only initialize watch progress if none exists for this specific fileId
        const existingProg = store.state.progress[fileId];
        const hasExistingProgress = Boolean(existingProg && existingProg.last_updated != null);

        if (!hasExistingProgress) {
          store.updateLocalProgressCache({
            movieId,
            showId,
            timestamp: 0,
            metadata: {
              season,
              episode
            }
          });
        }
        store.setActiveMediaRequest(fileId, res?.status ?? 'queued', res?.progress ?? '0.00');
        store.notify('request-started', { fileId });
      }
      return res;
    } catch (err) {
      console.error('[ApiService] Failed to enqueue media request:', err);
      store.removeActiveMediaRequest(fileId);
      throw err;
    }
  }
}

export const apiService = new ApiService();
