import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { buildMetadataHtml, buildEpisodeMetadataHtml, getMediaRequestErrorMessage } from '../utils/helpers.js';
import { eventBus } from '../utils/EventBus.js';
import { Toast } from '../utils/Toast.js';
import { MEDIA_REQUEST_STATUS } from '../utils/constants.js';

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
    this.requestBtn = null;
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
    this.requestBtn = document.getElementById('sheet-request-btn');
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

    // 4. Bind extra show actions if TV show
    this.setupExtraActions(item, isContinue, isEpisodeListClick);

    // 5. Update Play / Request button states
    this.updateButtonsState();

    // 6. Animate sheet presentation slider
    this.animateOpen();
  }

  setBannerAndTitle(item, isEpisodeListClick, show) {
    const bgImg = isEpisodeListClick && show 
      ? (item.thumbnail ?? show.background ?? show.poster)
      : (item.background ?? item.poster);
    
    if (this.bannerEl) {
      this.bannerEl.style.backgroundImage = `linear-gradient(to top, #111 0%, transparent 60%), url('${bgImg}')`;
    }

    if (isEpisodeListClick && show) {
      const epNum = item.episode;
      this.titleEl.innerHTML = `
        <h2 class="sheet-title-text" style="font-size: 1.25rem;">${show.title}</h2>
        <div style="font-size: 0.9rem; color: #E50914; font-weight: 700; margin-top: 0.25rem;">
          S${item.season}:E${epNum} - ${item.title || `Episode ${epNum}`}
        </div>
      `;
    } else if (item.logo) {
      this.titleEl.innerHTML = `<img src="${item.logo}" alt="${item.title}" class="sheet-title-logo">`;
    } else {
      this.titleEl.innerHTML = `<h2 class="sheet-title-text">${item.title}</h2>`;
    }
  }

  setMetadata(item, isEpisodeListClick, show) {
    if (isEpisodeListClick && show) {
      this.metaEl.innerHTML = buildEpisodeMetadataHtml(item, show);
    } else if (item.genres || item.runtime || item.year) {
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
      this.descEl.innerText = item.description || 'No description available for this episode.';
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
    if (item.type === 'show' && !isEpisodeListClick) {
      this.extraActionContainer.style.display = 'block';
      this.moreInfoBtn.onclick = (e) => {
        e.stopPropagation();
        this.close();
        eventBus.emit('open-show-details', item);
      };

      if (isContinue) {
        const { season, episode, episodeTitle } = item;
        this.titleEl.innerHTML += `<div class="sheet-episode-indicator" style="margin-top: 0.4rem; font-size: 0.95rem; color: #E50914; font-weight: 700;">S${season}:E${episode} - ${episodeTitle}</div>`;
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
        this.titleEl.innerHTML = `<h2 class="sheet-title-text">${fullItem.title}</h2>`;
      } else if (this.titleEl && fullItem.logo) {
        this.titleEl.innerHTML = `<img src="${fullItem.logo}" alt="${fullItem.title}" class="sheet-title-logo">`;
      }
      if (this.isContinue && this.currentItem.type === 'show') {
        const { season, episode, episodeTitle } = this.currentItem;
        this.titleEl.innerHTML += `<div class="sheet-episode-indicator" style="margin-top: 0.4rem; font-size: 0.95rem; color: #E50914; font-weight: 700;">S${season}:E${episode} - ${episodeTitle}</div>`;
      }
      if (this.metaEl && !this.isEpisodeListClick) {
        this.metaEl.innerHTML = buildMetadataHtml(this.currentItem);
      }
      if (this.descEl) {
        if (this.isEpisodeListClick) {
          this.descEl.innerText = this.currentItem.description ?? 'No description available for this episode.';
        } else if (this.currentItem.currentEpisodeDescription) {
          this.descEl.innerText = this.currentItem.currentEpisodeDescription;
        } else {
          this.descEl.innerText = fullItem.description ?? '';
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
    this.requestBtn.onclick = null;
    this.playBtn.disabled = false;
    this.requestBtn.disabled = false;
    this.requestBtn.style.background = '';

    const setPlayClick = (targetItem, isEpClick = false) => {
      this.playBtn.onclick = (e) => {
        e.stopPropagation();
        this.close();
        if (isEpClick) {
          if (this.activeOnEpisodeClick) {
            this.activeOnEpisodeClick(targetItem, this.show);
          }
        } else if (targetItem.type === 'show') {
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

    let isReady = false;
    let activeRequest = null;
    let fileId = '';

    if (this.isEpisodeListClick && this.show) {
      fileId = `${this.show.id}_s${item.season}_e${item.episode}`;
      isReady = store.isEpisodeReady(this.show.id, item.season, item.episode);
      activeRequest = store.isPreparingOrQueued(fileId);
    } else if (item.type === 'show' && this.isContinue) {
      fileId = `${item.id}_s${item.season}_e${item.episode}`;
      isReady = store.isEpisodeReady(item.id, item.season, item.episode);
      activeRequest = store.isPreparingOrQueued(fileId);
    } else if (item.type !== 'show') {
      fileId = item.id;
      isReady = store.isMovieReady(fileId);
      activeRequest = store.isPreparingOrQueued(fileId);
    }

    const isGeneralShow = item.type === 'show' && !this.isContinue && !this.isEpisodeListClick;

    if (isGeneralShow) {
      this.playBtn.style.display = 'none';
      this.requestBtn.style.display = 'none';
    } else if (isReady) {
      this.playBtn.style.display = 'flex';
      this.requestBtn.style.display = 'none';
      setPlayClick(item, this.isEpisodeListClick);
    } else {
      this.playBtn.style.display = 'none';
      this.requestBtn.style.display = 'flex';
      
      if (activeRequest) {
        const percent = Math.min(100, Math.max(0, parseFloat(activeRequest.progress) || 0));
        const isQueued = activeRequest.status === MEDIA_REQUEST_STATUS.QUEUED;
        
        if (isQueued) {
          this.requestBtn.innerHTML = '<i class="fa-solid fa-clock"></i> <span class="btn-text">Queued</span>';
        } else {
          const label = `Preparing ${Math.round(percent)}%`;
          let fillEl = this.requestBtn.querySelector('.btn-progress-fill');
          let textEl = this.requestBtn.querySelector('.btn-text');
          if (fillEl && textEl) {
            fillEl.style.width = `${percent}%`;
            textEl.textContent = label;
          } else {
            this.requestBtn.innerHTML = `
              <div class="btn-progress-fill" style="width: ${percent}%;"></div>
              <span class="btn-text">${label}</span>
            `;
          }
        }
        this.requestBtn.disabled = true;
      } else {
        this.requestBtn.innerHTML = '<i class="fa-solid fa-circle-plus"></i> <span class="btn-text">Request</span>';
        this.requestBtn.disabled = false;
        
        this.requestBtn.onclick = async (e) => {
          e.stopPropagation();
          this.requestBtn.disabled = true;
          
          try {
            if (this.isEpisodeListClick && this.show) {
              await apiService.enqueueMediaRequest({
                showId: this.show.id,
                season: item.season,
                episode: item.episode
              });
            } else if (item.type === 'show' && this.isContinue) {
              await apiService.enqueueMediaRequest({
                showId: item.id,
                season: item.season,
                episode: item.episode
              });
            } else {
              await apiService.enqueueMediaRequest({ movieId: item.id });
            }
          } catch (err) {
            Toast.show(getMediaRequestErrorMessage(err?.code), 'error');
          } finally {
            this.updateButtonsState();
          }
        };
      }
    }

    if (this.buttonsContainer) {
      if (this.playBtn.style.display === 'none' && this.requestBtn.style.display === 'none') {
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
