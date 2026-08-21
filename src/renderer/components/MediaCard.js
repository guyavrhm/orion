import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { formatRuntime, buildMetadataHtml, isDesktop, getDownloadErrorMessage } from '../utils/helpers.js';
import { eventBus } from '../utils/EventBus.js';
import { Toast } from '../utils/Toast.js';

export class MediaCard {
  
  // --- 1. Shared Media Interaction Handler (DRY Click/Action logic) ---
  static handleMediaClick(item, isContinue = false) {
    if (item.type === 'series' || item.type === 'show') {
      eventBus.emit('open-show-details', item);
    } else {
      const isDownloaded = store.isMovieDownloaded(item.id);
      if (isDownloaded) {
        eventBus.emit('open-player', item);
      } else {
        const activeDl = store.isDownloadingOrQueued(item.id);
        if (!activeDl) {
          apiService.enqueueDownload({ movieId: item.id }).catch((err) => {
            Toast.show(getDownloadErrorMessage(err?.code), 'error');
          });
        }
      }
    }
  }

  // --- 2. Carousel card (Popular Movies / Popular Shows / Continue Watching) ---
  static createCarouselCard(item, isContinue = false, onExpand = null) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card vertical-card';
    cardEl.tabIndex = 0;
    cardEl.setAttribute('data-id', item.id);
    cardEl.setAttribute('data-type', item.type);

    let fileId = item.id;
    if (isContinue && (item.type === 'series' || item.type === 'show')) {
      const season = item.season || item.last_season || 1;
      const episode = item.episode || item.last_episode || 1;
      fileId = `${item.id}_s${season}_e${episode}`;
      cardEl.setAttribute('data-show-id', item.id);
      cardEl.setAttribute('data-season', season);
      cardEl.setAttribute('data-episode', episode);
    }
    cardEl.setAttribute('data-file-id', fileId);

    const backgroundUrl = item.background || '';
    const posterUrl = item.poster ? item.poster.replace('/small/', '/medium/') : (item.background || '');

    cardEl.style.setProperty('--card-background', `url('${backgroundUrl}')`);
    cardEl.style.setProperty('--card-poster', `url('${posterUrl}')`);
    cardEl.style.backgroundImage = `var(--card-image)`;

    let miniTimelineHtml = '';
    if (isContinue && typeof item.timestamp === 'number' && item.timestamp > 0) {
      const defaultMinutes = (item.type === 'series' || item.type === 'show') ? 45 : 120;
      const runtimeMinutes = parseInt(item.runtime, 10) || defaultMinutes;
      const percent = Math.min(100, Math.max(0, (item.timestamp / (runtimeMinutes * 60)) * 100));
      miniTimelineHtml = `
        <div class="card-mini-timeline">
          <div class="card-mini-progress" style="width: ${percent}%"></div>
        </div>
      `;
    }

    const logoHtml = item.logo 
      ? `<img class="card-logo" src="${item.logo}" alt="${item.name}">`
      : `<div class="logo-text">${item.name}</div>`;

    cardEl.innerHTML = `
      <div class="card-content">
        <div class="active-elements">
          <div class="card-logo-container">
            ${logoHtml}
          </div>
        </div>
        <div class="vertical-elements">
          <div class="card-logo-container">
            ${logoHtml}
          </div>
        </div>
      </div>
      ${miniTimelineHtml}
    `;

    this.updateDownloadState(cardEl, fileId, item.type);

    cardEl.addEventListener('mouseenter', () => {
      if (isDesktop() && onExpand) {
        onExpand(cardEl, item, isContinue);
      }
    });

    cardEl.addEventListener('focus', () => {
      if (isDesktop() && onExpand) {
        onExpand(cardEl, item, isContinue);
      }
    });

    cardEl.onclick = (e) => {
      if (!isDesktop()) {
        e.stopPropagation();
        eventBus.emit('open-bottom-sheet', { item, isContinue });
        return;
      }
      this.handleMediaClick(item, isContinue);
    };

    return cardEl;
  }

  // --- 3. Hero card (Banner overlay setup) ---
  static setupHeroCard(item) {
    const hero = document.querySelector('.hero-container');
    const heroTitle = document.querySelector('.hero-title');
    const heroMeta = document.querySelector('.hero-metadata');
    const heroDesc = document.querySelector('.hero-description');
    const heroPlay = document.querySelector('.hero-btn-play');
    if (!hero) return;

    // Set background image
    const bgImg = item.background || item.poster;
    hero.style.backgroundImage = `linear-gradient(to right, #111 5%, rgba(17,17,17,0.7) 40%, transparent 80%), linear-gradient(to top, #111 0%, transparent 40%), url('${bgImg}')`;

    // Set title
    if (item.logo) {
      heroTitle.innerHTML = `<img src="${item.logo}" alt="${item.name}">`;
    } else {
      heroTitle.innerHTML = `<div class="hero-title-text">${item.name.toUpperCase()}</div>`;
    }

    // Set descriptors
    heroMeta.innerHTML = buildMetadataHtml(item);
    heroDesc.innerText = item.description || '';
    this.updateDownloadState(hero, item.id, item.type);
    hero.classList.remove('active-hero');

    // Set datasets
    hero.setAttribute('data-id', item.id);
    hero.setAttribute('data-type', item.type);
    hero.setAttribute('data-file-id', item.id);

    // Bind gestures
    const gestureState = { isTouchScrolling: false, touchStartX: 0, touchStartY: 0 };
    hero.ontouchstart = (e) => {
      gestureState.isTouchScrolling = false;
      gestureState.touchStartX = e.touches[0].clientX;
      gestureState.touchStartY = e.touches[0].clientY;
    };

    hero.ontouchmove = (e) => {
      const diffX = Math.abs(e.touches[0].clientX - gestureState.touchStartX);
      const diffY = Math.abs(e.touches[0].clientY - gestureState.touchStartY);
      if (diffX > 10 || diffY > 10) {
        gestureState.isTouchScrolling = true;
      }
    };

    // Bind clicks
    hero.onclick = (e) => {
      if (!isDesktop()) {
        if (gestureState.isTouchScrolling) return;
        e.stopPropagation();
        eventBus.emit('open-bottom-sheet', { item, isContinue: false });
      }
    };

    heroPlay.onclick = (e) => {
      e.stopPropagation();
      this.handleMediaClick(item, false);
    };
  }

  // --- 4. Search card (Simplified grid results layout) ---
  static createSearchCard(item) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card search-card';
    cardEl.tabIndex = 0;
    cardEl.style.width = '100%';
    cardEl.setAttribute('data-id', item.id);
    cardEl.setAttribute('data-type', item.type);
    cardEl.setAttribute('data-file-id', item.id);

    const imgSrc = item.poster ? item.poster.replace('/small/', '/medium/') : '';
    cardEl.style.backgroundImage = `url('${imgSrc}')`;

    cardEl.innerHTML = `
      <div class="card-content">
        <div class="vertical-elements">
          <div class="card-title">${item.name}</div>
          <div class="card-meta">${item.year || item.releaseInfo || ''}</div>
        </div>
      </div>
    `;

    this.updateDownloadState(cardEl, item.id, item.type);

    cardEl.onclick = (e) => {
      if (!isDesktop()) {
        e.stopPropagation();
        
        const cached = store.getFullMedia(item.id);
        if (cached) {
          eventBus.emit('open-bottom-sheet', { item: cached, isContinue: false });
          return;
        }

        eventBus.emit('open-bottom-sheet', { item, isContinue: false });

        if (item.type === 'movie' || item.type === 'series' || item.type === 'show') {
          const fetchPromise = item.type === 'movie'
            ? apiService.fetchMovieDetails(item.id)
            : apiService.fetchSeriesDetails(item.id);

          fetchPromise.catch(err => {
            console.error('Failed to load full search metadata:', err);
          });
        }
        return;
      }
      this.handleMediaClick(item, false);
    };

    return cardEl;
  }

  // --- 5. Episode card/row (Wide detail list layout) ---
  static createEpisodeCard(show, ep, config, onEpisodeClick, seasonsList, episodesCarousel) {
    const row = document.createElement('div');
    row.className = 'episode-row';
    row.tabIndex = 0;
    row.dataset.season = ep.season;
    row.setAttribute('data-id', show.id);
    row.setAttribute('data-show-id', show.id);
    row.setAttribute('data-season', ep.season);
    
    const epNum = ep.episode || ep.number;
    row.setAttribute('data-episode', epNum);
    
    const epFileId = `${show.id}_s${ep.season}_e${epNum}`;
    const epTitle = ep.name || ep.title || 'Episode ' + epNum;
    const epDesc = ep.overview || ep.description || '';
    const bgImg = ep.thumbnail || show.background || show.poster;

    row.setAttribute('data-file-id', epFileId);
    row.setAttribute('data-type', 'series');

    let progressHtml = '';
    if (config && config.episodes && config.episodes[epFileId]) {
      const epData = config.episodes[epFileId];
      if (typeof epData.timestamp === 'number' && epData.timestamp > 0) {
        const runtime = parseInt(epData.runtime, 10) || parseInt(ep.runtime, 10) || 45; 
        const percent = Math.min(100, Math.max(0, (epData.timestamp / (runtime * 60)) * 100));
        progressHtml = `<div class="episode-progress-container"><div class="episode-progress" style="width: ${percent}%"></div></div>`;
      }
    }

    row.innerHTML = `
      <div class="episode-card" style="background-image: url('${bgImg}')">
        <div class="episode-card-number">S${ep.season}: E${epNum}</div>
        ${progressHtml}
      </div>
      <div class="episode-info">
        <div class="episode-title">${epTitle}</div>
        <div class="episode-meta">${ep.runtime || ''}</div>
        <div class="episode-description">${epDesc}</div>
      </div>
    `;

    this.updateDownloadState(row, `${show.id}_s${ep.season}_e${epNum}`, 'series');

    const focusCard = () => {
      if (seasonsList) {
        seasonsList.querySelectorAll('.season-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.season == ep.season);
        });
      }
    };

    row.addEventListener('mouseenter', focusCard);
    row.addEventListener('focus', focusCard);

    row.onclick = (e) => {
      if (!isDesktop()) {
        e.stopPropagation();
        eventBus.emit('open-bottom-sheet', { item: ep, isContinue: false, isEpisodeListClick: true, showObj: show });
        return;
      }
      
      const isDownloaded = store.isEpisodeDownloaded(show.id, ep.season, epNum);
      if (isDownloaded) {
        onEpisodeClick(ep);
      } else {
        const fileId = `${show.id}_s${ep.season}_e${epNum}`;
        const activeDl = store.isDownloadingOrQueued(fileId);
        if (!activeDl) {
          apiService.enqueueDownload({
            showId: show.id,
            season: ep.season,
            episode: epNum
          }).catch((err) => {
            Toast.show(getDownloadErrorMessage(err?.code), 'error');
          });
        }
      }
    };

    return row;
  }

  // --- Download State Manager ---
  static updateDownloadState(el, fileId, type) {
    const isHero = el.classList.contains('hero-container') || el.id === 'hero-section';
    if (isHero) {
      const heroBtn = el.querySelector('.hero-btn-play') || document.getElementById('hero-play-btn');
      if (heroBtn) {
        if (type === 'series' || type === 'show') {
          heroBtn.innerText = 'More Info';
        } else {
          const isDownloaded = store.isMovieDownloaded(fileId);
          heroBtn.innerText = isDownloaded ? 'Play' : 'Download';
        }
      }
    }

    if (this.shouldResetSeriesCard(fileId, type)) {
      this.resetDownloadElements(el);
      return;
    }

    const showId = el.dataset.showId || el.dataset.id;
    const season = parseInt(el.dataset.season, 10);
    const episode = parseInt(el.dataset.episode, 10);

    const isDownloaded = (type === 'series' || type === 'show')
      ? store.isEpisodeDownloaded(showId, season, episode)
      : store.isMovieDownloaded(fileId);

    const activeDl = store.isDownloadingOrQueued(fileId);
    
    const targetContainer = el.classList.contains('episode-row') 
      ? el.querySelector('.episode-card') 
      : el;

    if (!targetContainer) return;

    const isEpisodeRow = el.classList.contains('episode-row');

    if (isDownloaded) {
      this.renderDownloaded(targetContainer, isEpisodeRow);
    } else if (activeDl) {
      this.renderActiveDownload(targetContainer, activeDl);
    } else {
      this.renderNotDownloaded(targetContainer, isEpisodeRow);
    }
  }

  static isDirectDownloadItem(targetContainer, isEpisodeRow) {
    if (isEpisodeRow) return true;
    const isHero = targetContainer.classList.contains('hero-container') || targetContainer.id === 'hero-section';
    if (isHero) return false;
    return targetContainer.getAttribute('data-type') === 'movie';
  }

  static shouldResetSeriesCard(fileId, type) {
    return (type === 'series' || type === 'show') && !fileId.includes('_s');
  }

  static resetDownloadElements(el) {
    const selectors = ['.card-download-overlay', '.card-download-badge', '.episode-download-badge', '.download-progress-spinner', '.card-download-label'];
    selectors.forEach(sel => {
      const match = el.querySelector(sel);
      if (match) match.remove();
    });
  }

  static renderDownloaded(targetContainer, isEpisodeRow) {
    const existingOverlay = targetContainer.querySelector('.card-download-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingSpinner = targetContainer.querySelector('.download-progress-spinner');
    if (existingSpinner) existingSpinner.remove();
    const existingLabel = targetContainer.querySelector('.card-download-label');
    if (existingLabel) existingLabel.remove();

    let badge = targetContainer.querySelector('.card-download-badge') || targetContainer.querySelector('.episode-download-badge');
    const badgeClass = isEpisodeRow ? 'episode-download-badge downloaded' : 'card-download-badge downloaded';
    
    if (!badge) {
      badge = document.createElement('div');
      badge.className = badgeClass;
      badge.title = 'Downloaded';
      badge.innerHTML = '<i class="fa-solid fa-circle-down"></i>';
      targetContainer.insertBefore(badge, targetContainer.firstChild);
    } else {
      badge.className = badgeClass;
    }
  }

  static renderActiveDownload(targetContainer, activeDl) {
    const badge = targetContainer.querySelector('.card-download-badge') || targetContainer.querySelector('.episode-download-badge');
    if (badge) badge.remove();
    const existingLabel = targetContainer.querySelector('.card-download-label');
    if (existingLabel) existingLabel.remove();

    let overlay = targetContainer.querySelector('.card-download-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'card-download-overlay';
      targetContainer.appendChild(overlay);
    }

    let mask = overlay.querySelector('.card-download-grey-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'card-download-grey-mask';
      overlay.appendChild(mask);
    }

    const percent = parseFloat(activeDl.progress);
    const isQueued = activeDl.status === 'queued';
    const isProcessing = activeDl.status === 'processing';
    
    // Mask behavior: unmasks during download (0% to 100%), fully unmasked (100%) during processing
    const maskPercent = isProcessing ? 100 : (isNaN(percent) ? 0 : percent);

    requestAnimationFrame(() => {
      mask.style.left = `${maskPercent}%`;
    });

    // Spinner behavior:
    // Downloading -> Green (#2ecc71), fills with download % (0 - 100)
    // Processing  -> Resets to 0% and fills with Orange (#e67e22) based on processing %
    let spinnerPercent = isNaN(percent) ? 0 : percent;
    if (isProcessing && spinnerPercent >= 100) {
      spinnerPercent = 0;
    }
    const strokeColor = isProcessing ? '#e67e22' : '#2ecc71';

    this.updateCircularSpinner(targetContainer, spinnerPercent, strokeColor);
  }

  static updateCircularSpinner(targetContainer, progressPercent, strokeColor = '#2ecc71') {
    let spinner = targetContainer.querySelector('.download-progress-spinner');
    if (!spinner) {
      const svgNamespace = "http://www.w3.org/2000/svg";
      spinner = document.createElementNS(svgNamespace, "svg");
      spinner.setAttribute("class", "download-progress-spinner");
      spinner.setAttribute("viewBox", "0 0 36 36");
      
      const circleBg = document.createElementNS(svgNamespace, "path");
      circleBg.setAttribute("class", "circle-bg");
      circleBg.setAttribute("d", "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831");
      circleBg.setAttribute("fill", "none");
      circleBg.setAttribute("stroke", "rgba(255, 255, 255, 0.15)");
      circleBg.setAttribute("stroke-width", "3.5");
      
      const circleProgress = document.createElementNS(svgNamespace, "path");
      circleProgress.setAttribute("class", "circle-progress");
      circleProgress.setAttribute("d", "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831");
      circleProgress.setAttribute("fill", "none");
      circleProgress.setAttribute("stroke", strokeColor);
      circleProgress.setAttribute("stroke-width", "3.5");
      circleProgress.setAttribute("stroke-linecap", "round");

      spinner.appendChild(circleBg);
      spinner.appendChild(circleProgress);
      targetContainer.insertBefore(spinner, targetContainer.firstChild);
    }

    const pathProgress = spinner.querySelector('.circle-progress');
    if (pathProgress) {
      pathProgress.setAttribute("stroke", strokeColor);
      pathProgress.setAttribute("stroke-dasharray", `${progressPercent}, 100`);
    }
  }

  static renderNotDownloaded(targetContainer, isEpisodeRow) {
    const existingSpinner = targetContainer.querySelector('.download-progress-spinner');
    if (existingSpinner) existingSpinner.remove();

    let overlay = targetContainer.querySelector('.card-download-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'card-download-overlay';
      targetContainer.appendChild(overlay);
    }

    let mask = overlay.querySelector('.card-download-grey-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'card-download-grey-mask';
      overlay.appendChild(mask);
    }
    mask.style.left = '0%';

    if (this.isDirectDownloadItem(targetContainer, isEpisodeRow)) {
      let label = overlay.querySelector('.card-download-label');
      if (!label) {
        label = document.createElement('div');
        label.className = 'card-download-label';
        label.innerText = 'Download';
        overlay.appendChild(label);
      }
    } else {
      const existingLabel = overlay.querySelector('.card-download-label');
      if (existingLabel) existingLabel.remove();
    }

    let badge = targetContainer.querySelector('.card-download-badge') || targetContainer.querySelector('.episode-download-badge');
    const badgeClass = isEpisodeRow ? 'episode-download-badge not-downloaded' : 'card-download-badge not-downloaded';
    
    if (!badge) {
      badge = document.createElement('div');
      badge.className = badgeClass;
      badge.title = 'Download';
      badge.innerHTML = '<i class="fa-solid fa-circle-down"></i>';
      targetContainer.insertBefore(badge, targetContainer.firstChild);
    } else {
      badge.className = badgeClass;
    }
  }
}
export default MediaCard;
