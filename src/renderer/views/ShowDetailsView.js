import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { navigationService } from '../services/NavigationService.js';
import { MediaCard } from '../components/MediaCard.js';
import { eventBus } from '../utils/EventBus.js';

let isProgrammaticScrolling = false;

function preventBounce(el) {
  if (!el) return;
  let startY = 0;
  el.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll > 0) {
      if (el.scrollTop === 0) {
        el.scrollTop = 1;
      } else if (el.scrollTop + el.clientHeight === el.scrollHeight) {
        el.scrollTop = el.scrollTop - 1;
      }
    }
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY;
    const scrollTop = el.scrollTop;
    const maxScroll = el.scrollHeight - el.clientHeight;
    
    if (maxScroll > 0) {
      if (scrollTop <= 0 && y > startY) {
        if (e.cancelable) e.preventDefault();
      }
      if (scrollTop >= maxScroll && y < startY) {
        if (e.cancelable) e.preventDefault();
      }
    }
  }, { passive: false });
}

class ShowDetailsView {
  constructor() {
    this.currentShowId = null;
    this.onEpisodeClickCallback = null;
    this.topVisibleEpisodeId = null;

    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const page = document.getElementById('show-details-page');
        const isVisible = page && page.style.display === 'block';
        if (isVisible) {
          this.recenterScrollPosition();
        }
      }, 150);
    });
  }

  render(show, onEpisodeClick, shouldShow = true) {
    this.currentShowId = show.id;
    if (onEpisodeClick) {
      this.onEpisodeClickCallback = onEpisodeClick;
    }

    const page = document.getElementById('show-details-page');
    const container = page.querySelector('.show-details-container');
    const loader = document.getElementById('show-details-loader');
    
    const logoContainer = document.getElementById('show-detail-logo');
    const yearEl = document.getElementById('show-detail-year');
    const seasonsCountEl = document.getElementById('show-detail-seasons-count');
    const episodesCarousel = document.getElementById('episodes-carousel');
    const seasonsList = document.getElementById('seasons-list');

    if (shouldShow) {
      this.initContainers(logoContainer, yearEl, seasonsCountEl, seasonsList, episodesCarousel, loader, container);
    }

    if (!show.videos || show.videos.length === 0) {
      return;
    }

    loader.style.display = 'none';
    container.style.display = 'flex';

    // 1. Render Header metadata (Logo & Year)
    this.renderShowHeader(show, logoContainer, yearEl);

    // 2. Filter, sort, and map episodes into seasons
    const { allEpisodes, seasons, seasonsMap } = this.getSeasonsData(show);
    seasonsCountEl.innerText = `${seasons.length} Seasons`;

    // 3. Render Season tab buttons
    const seasonToFirstRowMap = {};
    this.renderSeasonButtons(seasons, seasonsMap, seasonToFirstRowMap, seasonsList, episodesCarousel);

    // 4. Render individual Episode items
    const config = store.getShowConfig(show.id);
    const lastWatchedEpisodeId = config ? `${show.id}_s${config.last_season}_e${config.last_episode}` : null;
    const cardToFocus = this.renderEpisodeRows(show, allEpisodes, config, lastWatchedEpisodeId, seasonToFirstRowMap, episodesCarousel, seasonsList, onEpisodeClick);

    // 5. Center and focus the active episode
    const firstEpNum = show.videos[0] ? (show.videos[0].episode || show.videos[0].number) : 1;
    this.topVisibleEpisodeId = lastWatchedEpisodeId || (show.videos[0] ? `${show.id}_s${show.videos[0].season}_e${firstEpNum}` : null);
    this.focusEpisodeRow(cardToFocus, allEpisodes, seasonsList, episodesCarousel);

    // 6. Setup scroll-spy
    this.setupScrollSpy(page, seasonsList, episodesCarousel);
  }

  recenterScrollPosition() {
    const page = document.getElementById('show-details-page');
    if (!page) return;
    
    if (!this.topVisibleEpisodeId) return;

    const anchorCard = page.querySelector(`.episode-row[data-file-id="${this.topVisibleEpisodeId}"]`);
    const seasonsList = document.getElementById('seasons-list');
    const episodesCarousel = document.getElementById('episodes-carousel');
    
    if (anchorCard && seasonsList && episodesCarousel) {
      isProgrammaticScrolling = true;
      this.focusEpisodeRow(anchorCard, [], seasonsList, episodesCarousel);
      setTimeout(() => {
        isProgrammaticScrolling = false;
      }, 500);
    }
  }

  initContainers(logoContainer, yearEl, seasonsCountEl, seasonsList, episodesCarousel, loader, container) {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    
    logoContainer.innerHTML = '';
    yearEl.innerText = '';
    seasonsCountEl.innerText = '';
    seasonsList.innerHTML = '';
    episodesCarousel.innerHTML = '';
    
    loader.style.display = 'block';
    container.style.display = 'none';
    navigationService.openShowDetails();
  }

  renderShowHeader(show, logoContainer, yearEl) {
    if (show.logo) {
      logoContainer.innerHTML = `<img src="${show.logo}" alt="${show.name}">`;
    } else {
      logoContainer.innerHTML = `<h1 style="font-size: 6.25vh; font-weight: 900; text-transform: uppercase;">${show.name}</h1>`;
    }
    yearEl.innerText = show.year || '';
  }

  getSeasonsData(show) {
    const allEpisodes = show.videos
      .filter(v => parseInt(v.season, 10) > 0)
      .sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return (a.episode || a.number) - (b.episode || b.number);
      });

    const seasonsMap = {};
    allEpisodes.forEach(ep => {
      if (!seasonsMap[ep.season]) seasonsMap[ep.season] = [];
      seasonsMap[ep.season].push(ep);
    });

    const seasons = Object.keys(seasonsMap).sort((a, b) => a - b);
    return { allEpisodes, seasons, seasonsMap };
  }

  renderSeasonButtons(seasons, seasonsMap, seasonToFirstRowMap, seasonsList, episodesCarousel) {
    seasonsList.innerHTML = '';
    seasons.forEach(sNum => {
      const btn = document.createElement('div');
      btn.className = 'season-btn';
      btn.tabIndex = 0;
      btn.dataset.season = sNum;
      btn.innerHTML = `
        <span>Season ${sNum}</span>
        <span class="ep-count">${seasonsMap[sNum].length} Episodes</span>
      `;
      btn.onclick = () => {
        const firstRow = seasonToFirstRowMap[sNum];
        if (firstRow) {
          const isMobile = window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
          const detailsLeft = document.querySelector('.show-details-left');
          const contentPane = document.querySelector('.show-details-content');
          const scrollContainer = isMobile ? contentPane : episodesCarousel;
          
          if (scrollContainer) {
            const headerHeight = (isMobile && detailsLeft) ? detailsLeft.offsetHeight : 60;
            const targetScroll = Math.max(0, scrollContainer.scrollTop + (firstRow.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top) - headerHeight);
            
            isProgrammaticScrolling = true;
            scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
            setTimeout(() => { isProgrammaticScrolling = false; }, 800);
          }
          
          seasonsList.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          const btnLeft = btn.offsetLeft;
          const btnWidth = btn.offsetWidth;
          const listWidth = seasonsList.offsetWidth;
          seasonsList.scrollTo({
            left: btnLeft - listWidth / 2 + btnWidth / 2,
            behavior: 'smooth'
          });
        }
      };
      seasonsList.appendChild(btn);
    });
  }

  renderEpisodeRows(show, allEpisodes, config, lastWatchedEpisodeId, seasonToFirstRowMap, episodesCarousel, seasonsList, onEpisodeClick) {
    episodesCarousel.innerHTML = '';
    let cardToFocus = null;

    allEpisodes.forEach(ep => {
      const row = MediaCard.createEpisodeCard(show, ep, config, onEpisodeClick, seasonsList, episodesCarousel);

      if (!seasonToFirstRowMap[ep.season]) {
        seasonToFirstRowMap[ep.season] = row;
      }

      episodesCarousel.appendChild(row);

      const epNum = ep.episode || ep.number;
      const epFileId = `${show.id}_s${ep.season}_e${epNum}`;
      if (lastWatchedEpisodeId === epFileId) {
        cardToFocus = row;
      }
    });

    return cardToFocus;
  }

  focusEpisodeRow(cardToFocus, allEpisodes, seasonsList, episodesCarousel) {
    if (cardToFocus) {
      const sNum = cardToFocus.dataset.season;
      seasonsList.querySelectorAll('.season-btn').forEach(b => {
        const isActive = b.dataset.season == sNum;
        b.classList.toggle('active', isActive);
      });

      // Force a synchronous layout reflow so the browser calculates element positions and dimensions
      // after display changes (display: flex/block) before we measure them.
      const forcedReflow = document.body.offsetHeight;

      const activeBtn = seasonsList.querySelector('.season-btn.active');
      if (activeBtn) {
        const btnLeft = activeBtn.offsetLeft;
        const btnWidth = activeBtn.offsetWidth;
        const listWidth = seasonsList.offsetWidth;
        seasonsList.scrollLeft = btnLeft - listWidth / 2 + btnWidth / 2;
      }

      const isMobile = window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
      if (isMobile) {
        const contentPane = document.querySelector('.show-details-content');
        const detailsLeft = document.querySelector('.show-details-left');
        if (contentPane) {
          const rect = cardToFocus.getBoundingClientRect();
          const contentRect = contentPane.getBoundingClientRect();
          const headerHeight = detailsLeft ? detailsLeft.offsetHeight : 0;
          contentPane.scrollTop = contentPane.scrollTop + (rect.top - contentRect.top) - headerHeight - 10;
        }
      } else {
        const targetScroll = cardToFocus.offsetTop - 60;
        episodesCarousel.scrollTop = targetScroll;
      }
    } else if (allEpisodes.length > 0) {
      const firstSeasonBtn = seasonsList.querySelector('.season-btn');
      if (firstSeasonBtn) firstSeasonBtn.classList.add('active');
      const forcedReflow = document.body.offsetHeight;
      seasonsList.scrollLeft = 0;
      const isMobile = window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
      if (isMobile) {
        const contentPane = document.querySelector('.show-details-content');
        if (contentPane) contentPane.scrollTop = 0;
      } else {
        episodesCarousel.scrollTop = 0;
      }
    }
  }

  setupScrollSpy(page, seasonsList, episodesCarousel) {
    const contentPane = page.querySelector('.show-details-content');
    const detailsLeft = page.querySelector('.show-details-left');
    
    let scrollSpyTimeout;
    const runScrollSpy = () => {
      if (isProgrammaticScrolling) return;
      if (scrollSpyTimeout) return;
      scrollSpyTimeout = setTimeout(() => {
        scrollSpyTimeout = null;
        
        const isMobile = window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
        const activeScrollContainer = isMobile ? contentPane : episodesCarousel;
        if (!activeScrollContainer) return;
        
        const rows = episodesCarousel.querySelectorAll('.episode-row');
        let currentSeason = null;
        const containerRect = activeScrollContainer.getBoundingClientRect();
        let thresholdY = containerRect.top + 80;
        
        if (isMobile && detailsLeft) {
          thresholdY = detailsLeft.getBoundingClientRect().bottom + 10;
        }
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rect = row.getBoundingClientRect();
          if (rect.bottom >= thresholdY) {
            currentSeason = row.dataset.season;
            const fileId = row.dataset.fileId;
            if (fileId) {
              this.topVisibleEpisodeId = fileId;
            }
            break;
          }
        }
        
        if (currentSeason) {
          const activeBtn = seasonsList.querySelector(`.season-btn[data-season="${currentSeason}"]`);
          if (activeBtn && !activeBtn.classList.contains('active')) {
            seasonsList.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
            activeBtn.classList.add('active');
            
            const btnLeft = activeBtn.offsetLeft;
            const btnWidth = activeBtn.offsetWidth;
            const listWidth = seasonsList.offsetWidth;
            seasonsList.scrollTo({
              left: btnLeft - listWidth / 2 + btnWidth / 2,
              behavior: 'smooth'
            });
          }
        }
      }, 80);
    };

    if (contentPane) {
      preventBounce(contentPane);
      if (!contentPane.dataset.hasScrollListener) {
        contentPane.dataset.hasScrollListener = 'true';
        contentPane.addEventListener('scroll', () => {
          const isMobile = window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
          if (isMobile) runScrollSpy();
        });
      }
    }

    if (episodesCarousel) {
      if (!episodesCarousel.dataset.hasScrollListener) {
        episodesCarousel.dataset.hasScrollListener = 'true';
        episodesCarousel.addEventListener('scroll', () => {
          const isMobile = window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
          if (!isMobile) runScrollSpy();
        });
      }
    }

    document.getElementById('show-details-back-btn').onclick = () => {
      navigationService.closeShowDetails();
    };
  }
}

export const showDetailsView = new ShowDetailsView();
export default showDetailsView;
