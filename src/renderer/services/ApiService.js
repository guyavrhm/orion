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
      if (data.downloads) {
        store.cacheDownloadsBatch(data.downloads);
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
        try {
          const errJson = await resp.json();
          if (errJson && (errJson.error || errJson.code)) {
            errCode = errJson.error || errJson.code;
          }
        } catch {
          // ignore
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
        try {
          const errJson = await response.json();
          if (errJson && (errJson.error || errJson.code)) {
            errCode = errJson.error || errJson.code;
          }
        } catch {
          // ignore
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
    const ids = (data?.metadata || []).map(item => item.id);
    store.updateState({ popularMovies: ids }, 'popular-movies-updated');
    return ids;
  }

  async fetchSeries(limit = 11) {
    const data = await this.get(`/api/shows?limit=${limit}`);
    const ids = (data?.metadata || []).map(item => item.id);
    store.updateState({ popularShows: ids }, 'popular-shows-updated');
    return ids;
  }

  async fetchMovieDetails(movieId) {
    const cached = store.getFullMedia(movieId);
    if (cached) {
      const prog = store.state.progress[movieId];
      const dl = store.state.downloads[movieId];
      return {
        metadata: cached,
        progress: prog ? { [movieId]: prog } : {},
        downloads: dl ? { [movieId]: dl } : {}
      };
    }

    const data = await this.get(`/api/movies/${movieId}`);
    if (data && data.metadata) {
      data.metadata._isFull = true;
      store.cacheMetadata(data.metadata);
    }
    return data;
  }

  async fetchSeriesDetails(seriesId) {
    const cached = store.getFullMedia(seriesId);
    if (cached) {
      const progress = {};
      const downloads = {};
      Object.keys(store.state.progress).forEach(key => {
        if (key === seriesId || key.startsWith(`${seriesId}_s`)) {
          progress[key] = store.state.progress[key];
        }
      });
      Object.keys(store.state.downloads).forEach(key => {
        if (key === seriesId || key.startsWith(`${seriesId}_s`)) {
          downloads[key] = store.state.downloads[key];
        }
      });
      return {
        metadata: cached,
        progress,
        downloads
      };
    }

    const data = await this.get(`/api/shows/${seriesId}`);
    if (data && data.metadata) {
      data.metadata._isFull = true;
      store.cacheMetadata(data.metadata);
    }
    return data;
  }

  async fetchContinueWatching(type, limit = 10) {
    const apiType = (type === 'movies' || type === 'movie') ? 'movie' : 'series';
    const listKey = apiType === 'movie' ? 'continueWatchingMovies' : 'continueWatchingShows';

    const data = await this.get(`/api/continue-watching?type=${apiType}&limit=${limit}`);
    const metadataList = data?.metadata || [];
    const progressMap = data?.progress || {};

    const referenceList = metadataList.map(item => {
      let episodeId = item.id;
      if (apiType === 'series') {
        const activeEp = item.videos && item.videos[0];
        if (activeEp) {
          const epNum = activeEp.episode || activeEp.number;
          episodeId = `${item.id}_s${activeEp.season}_e${epNum}`;
        } else {
          const matchingKey = Object.keys(progressMap).find(k => k.startsWith(`${item.id}_s`));
          if (matchingKey) {
            episodeId = matchingKey;
          }
        }
      }
      const prog = progressMap[episodeId] || {};
      return {
        id: item.id,
        episodeId,
        last_updated: prog.last_updated || Date.now()
      };
    });

    store.updateState({ [listKey]: referenceList }, 'continue-watching-updated');
    return { ...data, references: referenceList };
  }

  async fetchSubtitles(id) {
    return this.get(`/api/media/${id}/subtitles`);
  }

  async performSearch(query) {
    return this.get(`/api/search?q=${encodeURIComponent(query)}`);
  }

  async fetchQueueState() {
    return this.get('/api/queue-state');
  }

  async saveTimestamp(data) {
    const payload = {
      timestamp: data.timestamp,
      metadata: data.metadata
    };
    if (data.movieId) {
      payload.movieId = data.movieId;
    } else if (data.showId) {
      payload.showId = data.showId;
      payload.season = data.metadata ? data.metadata.season : null;
      payload.episode = data.metadata ? data.metadata.episode : null;
    }
    // Update local cache synchronously
    store.updateLocalProgressCache(data);
    return this.post('/api/save-timestamp', payload);
  }

  async getSubtitlePreference(mediaId) {
    try {
      const data = await this.get(`/api/preferences/subtitles/${mediaId}`);
      return data ? data.subtitle_lang : null;
    } catch (e) {
      console.error('[ApiService] Failed to get subtitle preference:', e);
      return null;
    }
  }

  async saveSubtitlePreference(mediaId, lang) {
    return this.post(`/api/preferences/subtitles/${mediaId}`, { subtitle_lang: lang });
  }

  async startStream(payload) {
    return this.post('/api/stream', payload);
  }

  async enqueueDownload(data) {
    const season = data.season !== undefined ? data.season : (data.metadata ? data.metadata.season : null);
    const episode = data.episode !== undefined ? data.episode : (data.metadata ? data.metadata.episode : null);
    const fileId = data.movieId ? data.movieId : `${data.showId}_s${season}_e${episode}`;
    
    // Background fetch full metadata if not already fully cached to hydrate store details
    if (data.movieId) {
      this.fetchMovieDetails(data.movieId).catch(err => {
        console.error('[ApiService] Failed to fetch movie details in background on download:', err);
      });
    }

    // Optimistically set queued state if not already active or downloaded
    if (!store.isDownloadingOrQueued(fileId) && !store.isMovieDownloaded(fileId) && !store.isEpisodeDownloaded(data.showId, season, episode)) {
      store.setActiveDownload(fileId, 'queued', '0.00');
    }
    
    const payload = {
      movieId: data.movieId,
      showId: data.showId,
      season,
      episode
    };
    
    try {
      const res = await this.post('/api/download', payload);
      if (res && res.status === 'completed') {
        store.setDownloadStatus(fileId, true);
      } else {
        // Only initialize watch progress if none exists
        let hasExistingProgress = false;
        if (data.movieId) {
          const config = store.getMovieConfig(data.movieId);
          if (config && config.last_updated) {
            hasExistingProgress = true;
          }
        } else if (data.showId) {
          const config = store.getShowConfig(data.showId);
          if (config && Object.keys(config.episodes || {}).length > 0) {
            hasExistingProgress = true;
          }
        }

        if (!hasExistingProgress) {
          store.updateLocalProgressCache({
            movieId: data.movieId,
            showId: data.showId,
            timestamp: 0,
            metadata: {
              season,
              episode
            }
          });
        }

        store.setActiveDownload(fileId, res?.status || 'queued', res?.progress || '0.00');
        store.notify('download-started', { fileId });
      }
      return res;
    } catch (err) {
      console.error('[ApiService] Failed to enqueue download:', err);
      store.removeActiveDownload(fileId);
      throw err;
    }
  }
}

export const apiService = new ApiService();
