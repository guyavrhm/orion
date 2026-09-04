import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { MediaCard } from '../components/MediaCard.js';
import { setupScrollHover, buildMetadataHtml, extractYear } from '../utils/helpers.js';

class BrowseView {
  constructor() {
    this.browsePage = null;
    this.continueWatchingSection = null;
    this.continueWatchingContainer = null;
    this.continueWatchingInfo = null;
    this.popularMoviesContainer = null;
    this.popularMoviesInfo = null;
  }

  init() {
    this.browsePage = document.getElementById('browse-page');
    this.continueWatchingSection = document.getElementById('continue-watching-section');
    this.continueWatchingContainer = document.getElementById('continue-watching-container');
    this.continueWatchingInfo = document.getElementById('continue-watching-info');
    this.popularMoviesContainer = document.getElementById('popular-movies-container');
    this.popularMoviesInfo = document.getElementById('popular-movies-info');
  }

  async loadPageContent(tab) {
    const isMovie = tab === 'movies';
    const mediaType = isMovie ? 'movie' : 'show';
    const listKey = isMovie ? 'popularMovies' : 'popularShows';
    const pageTitle = isMovie ? 'Popular Movies' : 'Popular Shows';

    try {
      await this.loadContinueWatching(tab);

      if (store.state[listKey] === null) {
        if (isMovie) {
          await apiService.fetchMovies();
        } else {
          await apiService.fetchShows();
        }
      }

      const ids = store.state[listKey] ?? [];
      const titleEl = document.querySelector('#browse-page .row-title:not(#continue-watching-section .row-title)');
      if (titleEl) {
        titleEl.innerText = pageTitle;
      }

      if (ids.length > 0) {
        const heroMeta = store.getMedia(ids[0]);
        if (heroMeta) {
          MediaCard.setupHeroCard({ ...heroMeta, type: mediaType });
        }

        const carouselItems = ids.slice(1, 11).map(id => {
          const meta = store.getMedia(id);
          return meta ? { ...meta, type: mediaType } : null;
        }).filter(Boolean);

        this.renderRow(this.popularMoviesContainer, this.popularMoviesInfo, carouselItems, tab);
        setupScrollHover('popular-movies-container');
      }
    } catch (error) {
      console.error('[BrowseView] Failed to load tab page contents:', error);
    }
  }

  async loadContinueWatching(tab) {
    const isMovie = tab === 'movies';
    const mediaType = isMovie ? 'movie' : 'show';
    const listKey = isMovie ? 'continueWatchingMovies' : 'continueWatchingShows';

    try {
      if (store.state[listKey] === null) {
        await apiService.fetchContinueWatching(mediaType, 10);
      }

      const items = store.state[listKey] ?? [];

      if (items && items.length > 0) {
        this.continueWatchingSection.style.display = 'block';

        const updated = [];
        for (const ref of items) {
          const meta = store.getMedia(ref.id);
          if (!meta) continue;

          const prog = store.state.progress[ref.episodeId] ?? { timestamp: 0 };

          let episodeTitle = '';
          let episodeDescription = '';
          let episodeYear = '';
          let episodeRuntime = '';
          let season = null;
          let episode = null;

          if (!isMovie) {
            const match = ref.episodeId.match(/^(.+)_s(\d+)_e(\d+)$/);
            if (match) {
              season = parseInt(match[2], 10);
              episode = parseInt(match[3], 10);
              if (meta.episodes) {
                const epObj = meta.episodes.find(v => v.season === season && v.episode === episode);
                if (epObj) {
                  episodeTitle = epObj.title || `Episode ${episode}`;
                  episodeDescription = epObj.description || '';
                  episodeYear = extractYear(epObj.released);
                  if (epObj.runtime) {
                    episodeRuntime = epObj.runtime;
                  }
                }
              }
            }
          }

          const isReady = isMovie 
            ? store.isMovieReady(ref.id) 
            : store.isEpisodeReady(ref.id, season, episode);

          const runtime = episodeRuntime || prog.runtime || meta.runtime;

          updated.push({
            ...meta,
            type: mediaType,
            timestamp: prog.timestamp,
            runtime,
            progress: prog,
            is_ready: isReady,
            season,
            episode,
            episodeTitle,
            episodeYear,
            episodeRuntime: runtime,
            currentEpisodeDescription: episodeDescription
          });
        }

        if (updated.length > 0) {
          this.renderRow(this.continueWatchingContainer, this.continueWatchingInfo, updated, tab, true);
          setupScrollHover('continue-watching-container');
        } else {
          this.continueWatchingSection.style.display = 'none';
        }
      } else {
        this.continueWatchingSection.style.display = 'none';
      }
    } catch (error) {
      console.error('[BrowseView] Failed to load Continue Watching rows:', error);
    }
  }

  renderRow(container, infoArea, items, tabType, isContinue = false) {
    if (!container || !infoArea) return;
    container.innerHTML = '';
    
    const infoMeta = infoArea.querySelector('.metadata');
    const infoDesc = infoArea.querySelector('.description');

    const onExpand = (cardEl, item, isCont) => {
      container.querySelectorAll('.card').forEach(c => {
        c.classList.remove('active-card');
        c.classList.add('vertical-card');
      });
      cardEl.classList.remove('vertical-card');
      cardEl.classList.add('active-card');
      
      infoArea.classList.remove('empty');
      let metaHtml = buildMetadataHtml(item);
      let descText = item.description ?? '';

      if (isCont) {
        const season = item.season;
        if (item.type === 'show' && season) {
          metaHtml = buildMetadataHtml(item, { includeEpisodeTitle: true });
          descText = item.currentEpisodeDescription ?? item.description ?? '';
        }
      }

      if (infoMeta) infoMeta.innerHTML = metaHtml;
      if (infoDesc) infoDesc.innerText = descText;
    };

    items.forEach(item => {
      const card = MediaCard.createCarouselCard(item, isContinue, onExpand);
      container.appendChild(card);
    });

    container.onmouseleave = () => {
      container.querySelectorAll('.card').forEach(c => {
        c.classList.remove('active-card');
        c.classList.add('vertical-card');
      });
      infoArea.classList.add('empty');
    };
  }
}

export const browseView = new BrowseView();
export default browseView;
