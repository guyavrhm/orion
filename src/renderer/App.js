import { store } from './state/Store.js';
import { apiService } from './services/ApiService.js';
import { sseService } from './services/SseService.js';
import { navigationService } from './services/NavigationService.js';
import { searchView } from './views/SearchView.js';
import { bottomSheet } from './components/BottomSheet.js';
import { playerView } from './views/PlayerView.js';
import { MediaCard } from './components/MediaCard.js';
import { showDetailsView } from './views/ShowDetailsView.js';
import { browseView } from './views/BrowseView.js';
import { navBar } from './components/NavBar.js';
import { setupScrollHover, buildMetadataHtml } from './utils/helpers.js';
import { eventBus } from './utils/EventBus.js';
import { Toast } from './utils/Toast.js';

const CONTENT_UNAVAILABLE_MSG = "Sorry, this title is currently unavailable to watch. Please try again later.";

class App {
  constructor() {
    this.lastSyncTime = 0;
    this.isInitialized = false;
  }

  async init() {
    console.log('[Orion] Bootstrapping...');
    
    // 1. Initial State Load
    try {
      const data = await apiService.fetchQueueState();
      const activeDownloads = data?.activeDownloads || {};
      store.updateState({ activeDownloads }, 'downloads-changed');
    } catch (e) {
      console.warn('[App] Failed loading initial queue state:', e);
    }

    // 2. Connect Services & Components
    sseService.connect();
    navigationService.init();
    browseView.init();
    navBar.init(store.state.currentPage);
    searchView.init();
    bottomSheet.init((episode, show) => {
      const showId = episode.showId || episode.show_id || (episode.id && (episode.id.includes('_s') ? episode.id.split('_s')[0] : episode.id.split(':')[0]));
      const resolvedShow = show || store.getMedia(showId);
      if (resolvedShow) {
        this.handleOpenEpisode(resolvedShow, episode);
      } else {
        console.warn(`[App] Could not resolve show metadata for episode play:`, episode);
      }
    });
    playerView.init();

    // 3. Register Event Subscriptions & Custom Events
    this.setupEventListeners();
    this.setupStoreObserver();

    // 4. Preload Home Catalog Content
    await this.loadInitialContent();

    // 5. Wire reload
    const reloadBtn = document.getElementById('app-reload-btn');
    if (reloadBtn) reloadBtn.onclick = () => window.location.reload();

    // 6. Dismiss loading spinner
    setTimeout(() => {
      const loader = document.getElementById('app-loader');
      const mainContent = document.getElementById('main-content');
      if (loader) loader.style.display = 'none';
      if (mainContent) mainContent.classList.add('visible');
      this.isInitialized = true;
    }, 500);
  }

  setupEventListeners() {
    // Global click dismiss handler
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.card')) {
        document.querySelectorAll('.active-card').forEach(c => {
          c.classList.remove('active-card');
          c.classList.add('vertical-card');
        });
        document.querySelectorAll('.focused-info').forEach(info => {
          info.classList.add('empty');
        });
      }
      if (!e.target.closest('.hero-container')) {
        document.querySelectorAll('.hero-container').forEach(h => {
          h.classList.remove('active-hero');
        });
      }
    });

    // Register local EventBus subscriptions
    eventBus.on('open-player', async (movie) => {
      await this.handleOpenPlayer(movie);
    });

    eventBus.on('open-show-details', async (show) => {
      await this.handleOpenShowDetails(show, true);
    });

    eventBus.on('start-last-episode', async (item) => {
      const config = !item.episodeTitle ? store.getShowConfig(item.id) : null;
      
      const season = item.season || item.last_season || (config ? config.last_season : 1);
      const episodeNum = item.episode || item.last_episode || (config ? config.last_episode : 1);
      const epTitle = item.episodeTitle || (config ? config.last_episode_title : `Episode ${episodeNum}`);
      const episodeId = `${item.id}_s${season}_e${episodeNum}`;
      const startTime = item.timestamp || (config && config.episodes && config.episodes[episodeId] ? config.episodes[episodeId].timestamp : 0);
      
      playerView.open({
        name: `${item.name} - S${season}E${episodeNum}: ${epTitle}`,
        runtime: item.runtime
      }, startTime, false, null);

      const fullShow = await this.handleOpenShowDetails(item, false);
      const episode = fullShow.videos.find(v => v.season === season && (v.episode === episodeNum || v.number === episodeNum));
      
      if (episode) {
        this.handleOpenEpisode(fullShow, episode);
      } else {
        this.handleStartFirstEpisode(fullShow);
      }
    });

    eventBus.on('start-first-episode', async (show) => {
      playerView.open({
        name: show.name,
        runtime: show.runtime
      }, 0, false, null);

      const fullShow = await this.handleOpenShowDetails(show, false);
      this.handleStartFirstEpisode(fullShow);
    });

    eventBus.on('start-next-episode', () => {
      if (playerView.playerState.currentShow && playerView.playerState.currentEpisode) {
        this.handleStartNextEpisode(playerView.playerState.currentShow, playerView.playerState.currentEpisode);
      }
    });

    eventBus.on('player-closed', () => {
      const showToRefresh = playerView.playerState.currentShow;
      playerView.playerState.currentMovie = null;
      playerView.playerState.currentShow = null;
      playerView.playerState.currentEpisode = null;

      if (showToRefresh) {
        showDetailsView.render(showToRefresh, (episode) => {
          this.handleOpenEpisode(showToRefresh, episode);
        }, false);
      }
    });


    eventBus.on('open-bottom-sheet', ({ item, isContinue, isEpisodeListClick, showObj }) => {
      bottomSheet.open(item, isContinue, isEpisodeListClick, showObj);
    });

    eventBus.on('sse-connected', () => {
      this.syncState();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.syncState();
      }
    });
  }

  setupStoreObserver() {
    store.subscribe((changeType, state, detail) => {
      if (changeType === 'page-changed') {
        if (state.currentPage !== 'search') {
          browseView.loadPageContent(state.currentPage);
        }
      }
      if (changeType === 'download-progress-updated' && detail && detail.fileId) {
        document.querySelectorAll(`[data-file-id="${detail.fileId}"]`).forEach(el => {
          const type = el.getAttribute('data-type');
          MediaCard.updateDownloadState(el, detail.fileId, type);
        });
        if (bottomSheet.currentItem) {
          bottomSheet.updateButtonsState();
        }
      } else if (['downloads-changed', 'queue-changed', 'downloads-completed', 'downloads-removed'].includes(changeType)) {
        document.querySelectorAll('[data-file-id]').forEach(el => {
          const fileId = el.getAttribute('data-file-id');
          const type = el.getAttribute('data-type');
          MediaCard.updateDownloadState(el, fileId, type);
        });

        if (bottomSheet.currentItem) {
          bottomSheet.updateButtonsState();
        }
      }

      if (changeType === 'continue-watching-updated') {
        if (state.currentPage !== 'search') {
          browseView.loadContinueWatching(state.currentPage);
        }
      }

      if (changeType === 'metadata-cached' && detail && detail.id) {
        const cached = store.getMedia(detail.id);
        if (cached) {
          bottomSheet.updateDetailsIfOpen(detail.id, cached);
        }
      }
    });
  }

  async syncState() {
    if (!this.isInitialized) return;
    if (playerView.playerState.currentMovie || playerView.playerState.currentShow) return;

    const now = Date.now();
    if (now - this.lastSyncTime < 5000) return;
    this.lastSyncTime = now;

    console.log('[App] Synchronizing download and queue state with server...');
    try {
      const data = await apiService.fetchQueueState();
      const activeDownloads = data?.activeDownloads || {};
      store.updateState({ activeDownloads }, 'downloads-changed');

      // Emit wake event for future subscribers
      eventBus.emit('app-wake');
    } catch (e) {
      console.warn('[App] State synchronization failed:', e);
    }
  }

  async loadInitialContent() {
    try {
      await Promise.all([
        apiService.fetchMovies(),
        apiService.fetchSeries(),
        apiService.fetchContinueWatching('movie', 10),
        apiService.fetchContinueWatching('series', 10)
      ]);
    } catch (e) {
      console.error('[App] Initial catalog fetch failed:', e);
    }
    await browseView.loadPageContent(store.state.currentPage);
  }

  async handleOpenPlayer(movie) {
    const config = store.getMovieConfig(movie.id);
    const startTime = config ? (config.timestamp || 0) : 0;
    
    playerView.open(movie, startTime, false, null);

    let fullMovie;
    try {
      const response = await apiService.fetchMovieDetails(movie.id);
      if (!playerView.isOpen) return;
      fullMovie = response.metadata;
      if (!fullMovie || !fullMovie.id) throw new Error('Invalid movie metadata');
      
      const title = document.getElementById('video-movie-title');
      if (title) title.innerText = fullMovie.name;
    } catch (e) {
      if (!playerView.isOpen) return;
      console.error(e);
      Toast.show(CONTENT_UNAVAILABLE_MSG, 'error');
      playerView.close();
      return;
    }

    if (!playerView.isOpen) return;

    playerView.playerState.currentMovie = fullMovie;
    playerView.playerState.currentShow = null;
    playerView.playerState.currentEpisode = null;

    const subsPromise = apiService.fetchSubtitles(fullMovie.id);
    playerView.open(fullMovie, startTime, false, subsPromise);

    playerView.startStream({ movieId: fullMovie.id }, startTime);
  }

  async handleOpenShowDetails(show, shouldShow = true) {
    const onEpisodeClick = (ep) => {
      this.handleOpenEpisode(store.getMedia(show.id) || show, ep);
    };

    if (shouldShow) {
      showDetailsView.render(show, onEpisodeClick, true);
    }



    try {
      const response = await apiService.fetchSeriesDetails(show.id);
      const fullShow = response.metadata;
      if (!fullShow || !fullShow.id) throw new Error('Invalid show metadata');
      showDetailsView.render(fullShow, onEpisodeClick, false);
      return fullShow;
    } catch (e) {
      console.error(e);
      if (shouldShow) {
        Toast.show(CONTENT_UNAVAILABLE_MSG, 'error');
        navigationService.closeShowDetails();
      }
      return show;
    }
  }

  handleStartFirstEpisode(show) {
    const s1 = (show.videos || []).filter(v => parseInt(v.season, 10) === 1);
    if (s1.length > 0) {
      s1.sort((a, b) => (a.episode || a.number) - (b.episode || b.number));
      this.handleOpenEpisode(show, s1[0]);
    } else if (show.videos && show.videos.length > 0) {
      const all = show.videos.filter(v => parseInt(v.season, 10) > 0).sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return (a.episode || a.number) - (b.episode || b.number);
      });
      if (all.length > 0) this.handleOpenEpisode(show, all[0]);
    }
  }

  async handleOpenEpisode(show, episode) {
    const epNum = episode.episode || episode.number;
    const epTitle = episode.name || episode.title || 'Episode ' + epNum;
    
    const config = store.getShowConfig(show.id);
    const episodeId = `${show.id}_s${episode.season}_e${epNum}`;
    const startTime = (config && config.episodes && config.episodes[episodeId]) ? (config.episodes[episodeId].timestamp || 0) : 0;
    
    let hasNext = false;
    if (show.videos) {
      const currentIndex = show.videos.findIndex(v => 
        v === episode || (v.season === episode.season && (v.episode === epNum || v.number === epNum))
      );
      if (currentIndex !== -1 && currentIndex < show.videos.length - 1) {
        const next = show.videos[currentIndex + 1];
        if (parseInt(next.season, 10) > 0) {
          hasNext = true;
        }
      }
    }

    playerView.playerState.currentMovie = null;
    playerView.playerState.currentShow = show;
    playerView.playerState.currentEpisode = episode;

    const subsPromise = apiService.fetchSubtitles(`${show.id}:${episode.season}:${epNum}`);
    playerView.open({
      name: `${show.name} - S${episode.season}E${epNum}: ${epTitle}`,
      runtime: episode.runtime || show.runtime
    }, startTime, hasNext, subsPromise);

    apiService.fetchSeriesDetails(show.id).catch(e => console.error('Background details fetch failed:', e));

    playerView.startStream({
      showId: show.id,
      season: episode.season,
      episode: epNum
    }, startTime);
  }

  handleStartNextEpisode(show, currentEpisode) {
    if (!show.videos) return;

    const epNum = currentEpisode.episode || currentEpisode.number;
    const currentIndex = show.videos.findIndex(v => 
      v.season === currentEpisode.season && (v.episode === epNum || v.number === epNum)
    );

    if (currentIndex !== -1 && currentIndex < show.videos.length - 1) {
      const nextEpisode = show.videos[currentIndex + 1];
      if (parseInt(nextEpisode.season, 10) > 0) {
        const nextEpNum = nextEpisode.episode || nextEpisode.number;
        const isReady = store.isEpisodeDownloaded(show.id, nextEpisode.season, nextEpNum);

        const timeToSave = playerView.player ? playerView.player.currentTime : 0;
        playerView.saveProgress(timeToSave);

        if (isReady) {
          this.handleOpenEpisode(show, nextEpisode);
        } else {
          playerView.close();
          this.handleOpenShowDetails(show, true);
        }
      }
    }
  }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
export default app;
