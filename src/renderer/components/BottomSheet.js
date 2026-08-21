import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { buildMetadataHtml, buildEpisodeMetadataHtml, getDownloadErrorMessage } from '../utils/helpers.js';
import { eventBus } from '../utils/EventBus.js';
import { Toast } from '../utils/Toast.js';

class BottomSheet {
  constructor() {
    this.sheet = null;
    this.content = null;
    this.overlay = null;
    this.closeBtn = null;
    
    this.titleEl = null;
    this.bannerEl = null;
    this.metaEl = null;
    this.descEl = null;
    this.extraActionContainer = null;
    this.moreInfoBtn = null;
    this.playBtn = null;
    this.dlBtn = null;
    this.buttonsContainer = null;

    this.currentItem = null;
    this.isContinue = false;
    this.isEpisodeListClick = false;
    this.show = null;
    this.activeOnEpisodeClick = null;
  }

  setTranslate(yPercentOrPx, isPercent = false) {
    if (!this.content) return;
    const suffix = isPercent ? '%' : 'px';
    const requiresCentering = window.matchMedia('(orientation: landscape), (min-width: 48rem)').matches;
    if (requiresCentering) {
      this.content.style.transform = `translate(-50%, ${yPercentOrPx}${suffix})`;
    } else {
      this.content.style.transform = `translateY(${yPercentOrPx}${suffix})`;
    }
  }

  init(onEpisodeClick = null) {
    this.activeOnEpisodeClick = onEpisodeClick;
    this.sheet = document.getElementById('mobile-detail-sheet');
    this.content = document.getElementById('sheet-content');
    this.overlay = document.getElementById('sheet-overlay');
    this.closeBtn = document.getElementById('sheet-close-btn');
    
    this.titleEl = document.getElementById('sheet-title');
    this.bannerEl = document.getElementById('sheet-banner');
    this.metaEl = document.getElementById('sheet-meta');
    this.descEl = document.getElementById('sheet-description');
    this.extraActionContainer = document.getElementById('sheet-extra-action-container');
    this.moreInfoBtn = document.getElementById('sheet-more-info-btn');
    this.playBtn = document.getElementById('sheet-play-btn');
    this.dlBtn = document.getElementById('sheet-download-btn');
    this.buttonsContainer = document.querySelector('.bottom-sheet-buttons');

    if (this.closeBtn) this.closeBtn.onclick = () => this.close();
    if (this.overlay) {
      this.overlay.onclick = () => this.close();
      this.overlay.addEventListener('touchmove', (e) => {
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
    }

    this.setupSwipeGestures();
  }

  setupSwipeGestures() {
    if (!this.content) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    this.content.addEventListener('touchstart', (e) => {
      const body = this.content.querySelector('.bottom-sheet-body');
      const isScrollable = e.target.closest('.bottom-sheet-body') || e.target.closest('.bottom-sheet-description') || e.target.closest('.bottom-sheet-meta');
      if (isScrollable && body && body.scrollTop > 0) {
        isDragging = false;
        return;
      }
      
      startY = e.touches[0].clientY;
      isDragging = true;
      this.content.style.transition = 'none';
    }, { passive: true });

    this.content.addEventListener('touchmove', (e) => {
      const body = this.content.querySelector('.bottom-sheet-body');
      currentY = e.touches[0].clientY;
      const deltaY = currentY - startY;
      
      const scrollableTarget = e.target.closest('.bottom-sheet-body') || e.target.closest('.bottom-sheet-description') || e.target.closest('.bottom-sheet-meta');
      if (scrollableTarget && body) {
        const scrollTop = body.scrollTop;
        const scrollHeight = body.scrollHeight;
        const clientHeight = body.clientHeight;
        
        if (deltaY > 0 && scrollTop <= 0) {
          if (isDragging) {
            if (e.cancelable) e.preventDefault();
            this.setTranslate(deltaY);
          } else {
            if (e.cancelable) e.preventDefault();
          }
        } else if (deltaY < 0 && scrollTop + clientHeight >= scrollHeight) {
          if (e.cancelable) e.preventDefault();
        }
      } else {
        if (e.cancelable) e.preventDefault();
        if (isDragging && deltaY > 0) {
          this.setTranslate(deltaY);
        }
      }
    }, { passive: false });

    this.content.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      const deltaY = currentY - startY;
      if (deltaY > 120) {
        this.close();
      } else {
        this.content.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        this.setTranslate(0, true);
      }
      startY = 0;
      currentY = 0;
    });
  }

  open(item, isContinue = false, isEpisodeListClick = false, show = null) {
    this.currentItem = item;
    this.isContinue = isContinue;
    this.isEpisodeListClick = isEpisodeListClick;
    this.show = show;

    document.body.style.overflow = 'hidden';

    // 1. Setup image banner and sheet title details
    this.setBannerAndTitle(item, isEpisodeListClick, show);

    // 2. Render metadata layouts (skeleton load fallback)
    this.setMetadata(item, isEpisodeListClick, show);

    // 3. Render description overview text
    this.setDescription(item, isEpisodeListClick);

    // 4. Bind extra series actions if TV show
    this.setupExtraActions(item, isContinue, isEpisodeListClick);

    // 5. Update Play / Download button states
    this.updateButtonsState();

    // 6. Animate sheet presentation slider
    this.animateOpen();
  }

  setBannerAndTitle(item, isEpisodeListClick, show) {
    const bgImg = isEpisodeListClick && show 
      ? (item.thumbnail || show.background || show.poster)
      : (item.background || item.poster);
    
    if (this.bannerEl) {
      this.bannerEl.style.backgroundImage = `linear-gradient(to top, #111 0%, transparent 60%), url('${bgImg}')`;
    }

    if (isEpisodeListClick && show) {
      const epNum = item.episode || item.number;
      this.titleEl.innerHTML = `
        <h2 class="sheet-title-text" style="font-size: 1.25rem;">${show.name}</h2>
        <div style="font-size: 0.9rem; color: #E50914; font-weight: 700; margin-top: 0.25rem;">
          S${item.season}:E${epNum} - ${item.name || item.title || 'Episode ' + epNum}
        </div>
      `;
    } else if (item.logo) {
      this.titleEl.innerHTML = `<img src="${item.logo}" alt="${item.name}" class="sheet-title-logo">`;
    } else {
      this.titleEl.innerHTML = `<h2 class="sheet-title-text">${item.name}</h2>`;
    }
  }

  setMetadata(item, isEpisodeListClick, show) {
    if (isEpisodeListClick && show) {
      this.metaEl.innerHTML = buildEpisodeMetadataHtml(item, show);
    } else if (item.genres || item.runtime || item.year || item.episodeYear) {
      this.metaEl.innerHTML = buildMetadataHtml(item);
    } else {
      this.metaEl.innerHTML = `
        <span class="skeleton" style="width: 4.2rem; height: 0.85rem; vertical-align: middle;"></span>
        <span class="skeleton" style="width: 5rem; height: 0.85rem; margin-left: 0.5rem; vertical-align: middle;"></span>
        <span class="skeleton" style="width: 3.8rem; height: 0.85rem; margin-left: 0.5rem; vertical-align: middle;"></span>
      `;
    }
  }

  setDescription(item, isEpisodeListClick) {
    if (isEpisodeListClick) {
      this.descEl.innerText = item.overview || item.description || 'No description available for this episode.';
    } else if (item.currentEpisodeDescription) {
      this.descEl.innerText = item.currentEpisodeDescription;
    } else if (item.description) {
      this.descEl.innerText = item.description;
    } else {
      this.descEl.innerHTML = `
        <div class="skeleton skeleton-text" style="width: 100%; height: 0.85rem;"></div>
        <div class="skeleton skeleton-text" style="width: 96%; height: 0.85rem;"></div>
        <div class="skeleton skeleton-text" style="width: 70%; height: 0.85rem;"></div>
      `;
    }
  }

  setupExtraActions(item, isContinue, isEpisodeListClick) {
    if ((item.type === 'series' || item.type === 'show') && !isEpisodeListClick) {
      this.extraActionContainer.style.display = 'block';
      this.moreInfoBtn.onclick = (e) => {
        e.stopPropagation();
        this.close();
        eventBus.emit('open-show-details', item);
      };

      if (isContinue) {
        const season = item.season || item.last_season || 1;
        const epNum = item.episode || item.last_episode || 1;
        const epTitle = item.episodeTitle || item.last_episode_title || 'Episode ' + epNum;
        this.titleEl.innerHTML += `<div class="sheet-episode-indicator" style="margin-top: 0.4rem; font-size: 0.95rem; color: #E50914; font-weight: 700;">S${season}:E${epNum} - ${epTitle}</div>`;
      }
    } else {
      this.extraActionContainer.style.display = 'none';
    }
  }

  animateOpen() {
    if (this.sheet) this.sheet.style.display = 'block';
    this.setTranslate(100, true);
    this.content.style.transition = 'none';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.sheet) this.sheet.classList.add('active');
        this.content.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
        this.setTranslate(0, true);
      });
    });
  }

  updateDetailsIfOpen(itemId, fullItem) {
    if (this.currentItem && this.currentItem.id === itemId) {
      this.currentItem = { ...this.currentItem, ...fullItem };
      if (this.titleEl && !fullItem.logo) {
        this.titleEl.innerHTML = `<h2 class="sheet-title-text">${fullItem.name}</h2>`;
      } else if (this.titleEl && fullItem.logo) {
        this.titleEl.innerHTML = `<img src="${fullItem.logo}" alt="${fullItem.name}" class="sheet-title-logo">`;
      }
      if (this.isContinue && (this.currentItem.type === 'series' || this.currentItem.type === 'show')) {
        const season = this.currentItem.season || this.currentItem.last_season || 1;
        const epNum = this.currentItem.episode || this.currentItem.last_episode || 1;
        const epTitle = this.currentItem.episodeTitle || this.currentItem.last_episode_title || 'Episode ' + epNum;
        this.titleEl.innerHTML += `<div class="sheet-episode-indicator" style="margin-top: 0.4rem; font-size: 0.95rem; color: #E50914; font-weight: 700;">S${season}:E${epNum} - ${epTitle}</div>`;
      }
      if (this.metaEl && !this.isEpisodeListClick) {
        this.metaEl.innerHTML = buildMetadataHtml(this.currentItem);
      }
      if (this.descEl) {
        if (this.isEpisodeListClick) {
          this.descEl.innerText = this.currentItem.overview || this.currentItem.description || 'No description available for this episode.';
        } else if (this.currentItem.currentEpisodeDescription) {
          this.descEl.innerText = this.currentItem.currentEpisodeDescription;
        } else {
          this.descEl.innerText = fullItem.description || '';
        }
      }
      if (this.bannerEl && fullItem.background && !this.isEpisodeListClick) {
        this.bannerEl.style.backgroundImage = `linear-gradient(to top, #111 0%, transparent 60%), url('${fullItem.background}')`;
      }
      this.updateButtonsState();
    }
  }

  updateButtonsState() {
    const item = this.currentItem;
    if (!item) return;

    this.playBtn.onclick = null;
    this.dlBtn.onclick = null;
    this.playBtn.disabled = false;
    this.dlBtn.disabled = false;
    this.dlBtn.style.background = '';

    const setPlayClick = (targetItem, isEpClick = false) => {
      this.playBtn.onclick = (e) => {
        e.stopPropagation();
        this.close();
        if (isEpClick) {
          if (this.activeOnEpisodeClick) {
            this.activeOnEpisodeClick(targetItem, this.show);
          }
        } else if (targetItem.type === 'series' || targetItem.type === 'show') {
          if (this.isContinue) {
            eventBus.emit('start-last-episode', targetItem);
          } else {
            eventBus.emit('start-first-episode', targetItem);
          }
        } else {
          eventBus.emit('open-player', targetItem);
        }
      };
    };

    let isDownloaded = false;
    let activeDl = null;
    let fileId = '';

    if (this.isEpisodeListClick && this.show) {
      const season = item.season;
      const epNum = item.episode || item.number;
      fileId = `${this.show.id}_s${season}_e${epNum}`;
      isDownloaded = store.isEpisodeDownloaded(this.show.id, season, epNum);
      activeDl = store.isDownloadingOrQueued(fileId);
    } else if ((item.type === 'series' || item.type === 'show') && this.isContinue) {
      const season = item.season || item.last_season || 1;
      const epNum = item.episode || item.last_episode || 1;
      fileId = `${item.id}_s${season}_e${epNum}`;
      isDownloaded = store.isEpisodeDownloaded(item.id, season, epNum);
      activeDl = store.isDownloadingOrQueued(fileId);
    } else if (item.type !== 'series' && item.type !== 'show') {
      fileId = item.id;
      isDownloaded = store.isMovieDownloaded(fileId);
      activeDl = store.isDownloadingOrQueued(fileId);
    }

    const isGeneralShow = (item.type === 'series' || item.type === 'show') && !this.isContinue && !this.isEpisodeListClick;

    if (isGeneralShow) {
      this.playBtn.style.display = 'none';
      this.dlBtn.style.display = 'none';
    } else if (isDownloaded) {
      this.playBtn.style.display = 'flex';
      this.dlBtn.style.display = 'none';
      setPlayClick(item, this.isEpisodeListClick);
    } else {
      this.playBtn.style.display = 'none';
      this.dlBtn.style.display = 'flex';
      
      if (activeDl) {
        const percent = parseFloat(activeDl.progress);
        const isQueued = activeDl.status === 'queued';
        const isProcessing = activeDl.status === 'processing';
        const progressPercent = isProcessing ? 100 : percent;
        
        if (isQueued) {
          this.dlBtn.innerHTML = '<i class="fa-solid fa-clock"></i> <span class="btn-text">Queued</span>';
        } else if (isProcessing) {
          const procVal = Math.round(percent);
          const hasProgress = !isNaN(procVal) && procVal > 0 && procVal < 100;
          const label = hasProgress ? `Processing ${procVal}%` : 'Processing...';
          const fillPercent = hasProgress ? procVal : 100;

          let fillEl = this.dlBtn.querySelector('.btn-progress-fill');
          let textEl = this.dlBtn.querySelector('.btn-text');
          if (fillEl && textEl) {
            fillEl.style.width = `${fillPercent}%`;
            textEl.textContent = label;
          } else {
            this.dlBtn.innerHTML = `
              <div class="btn-progress-fill" style="width: ${fillPercent}%;"></div>
              <span class="btn-text">${label}</span>
            `;
          }
        } else {
          let fillEl = this.dlBtn.querySelector('.btn-progress-fill');
          let textEl = this.dlBtn.querySelector('.btn-text');
          if (fillEl && textEl) {
            fillEl.style.width = `${progressPercent}%`;
            textEl.textContent = `Downloading ${Math.round(progressPercent)}%`;
          } else {
            this.dlBtn.innerHTML = `
              <div class="btn-progress-fill" style="width: ${progressPercent}%;"></div>
              <span class="btn-text">Downloading ${Math.round(progressPercent)}%</span>
            `;
          }
        }
        this.dlBtn.disabled = true;
      } else {
        this.dlBtn.innerHTML = '<i class="fa-solid fa-circle-down"></i> <span class="btn-text">Download</span>';
        this.dlBtn.disabled = false;
        
        this.dlBtn.onclick = async (e) => {
          e.stopPropagation();
          this.dlBtn.disabled = true;
          this.dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span class="btn-text">Connecting...</span>';

          try {
            if (this.isEpisodeListClick && this.show) {
              const season = item.season;
              const epNum = item.episode || item.number;
              await apiService.enqueueDownload({
                showId: this.show.id,
                season: season,
                episode: epNum
              });
            } else if ((item.type === 'series' || item.type === 'show') && this.isContinue) {
              const season = item.season || item.last_season || 1;
              const epNum = item.episode || item.last_episode || 1;
              await apiService.enqueueDownload({
                showId: item.id,
                season: season,
                episode: epNum
              });
            } else {
              await apiService.enqueueDownload({ movieId: item.id });
            }
          } catch (err) {
            Toast.show(getDownloadErrorMessage(err?.code), 'error');
          } finally {
            this.updateButtonsState();
          }
        };
      }
    }

    if (this.buttonsContainer) {
      if (this.playBtn.style.display === 'none' && this.dlBtn.style.display === 'none') {
        this.buttonsContainer.style.display = 'none';
      } else {
        this.buttonsContainer.style.display = 'flex';
      }
    }
  }

  close() {
    if (!this.sheet || !this.sheet.classList.contains('active')) return;
    
    document.body.style.overflow = '';
    
    this.content.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    this.setTranslate(100, true);
    this.sheet.classList.remove('active');
    
    setTimeout(() => {
      this.sheet.style.display = 'none';
      this.currentItem = null;
      this.isContinue = false;
      this.isEpisodeListClick = false;
      this.show = null;
    }, 300);
  }
}

export const bottomSheet = new BottomSheet();
export default bottomSheet;
