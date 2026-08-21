import { store } from '../state/Store.js';
import { apiService } from '../services/ApiService.js';
import { navigationService } from '../services/NavigationService.js';
import { formatTime, isDesktop } from '../utils/helpers.js';
import { eventBus } from '../utils/EventBus.js';
import { LANG_MAP } from '../utils/constants.js';
import { Toast } from '../utils/Toast.js';

const CONTENT_UNAVAILABLE_MSG = "Sorry, this title is currently unavailable to watch. Please try again later.";


class PlayerView {
  constructor() {
    this.isOpen = false;
    this.currentSessionId = 0;
    this.hudTimeout = null;
    this.playerState = {
      currentMovie: null,
      currentShow: null,
      currentEpisode: null,
      lastSavedSecond: -1,
      preferredSubtitleIndexes: {},
      pendingSubtitle: null,
      scrubTime: null,
      scrubTimeout: null,
      wasPlayingBeforeScrub: false,
      scrubStartTime: null
    };
    
    this.player = null;
    this.overlay = null;
    this.movieTitleDisplay = null;
    this.loader = null;
    this.bufferingSpinner = null;
    this.controls = null;
    this.timelineContainer = null;
    this.timelineProgress = null;
    this.timelineBuffered = null;
    this.timelineHandle = null;
    this.videoTime = null;
    this.backBtn = null;
    this.fullscreenBtn = null;
    this.fullscreenIcon = null;
    this.nextEpisodeBtn = null;
    this.subtitlesContainer = null;
    this.subtitlesBtn = document.getElementById('subtitles-btn');
    this.subtitlesDropdown = document.getElementById('subtitles-dropdown');
    this.subtitlesOverlay = document.getElementById('subtitles-container');

    this.centerPlayPauseBtn = null;
    this.centerRewindBtn = null;
    this.centerForwardBtn = null;
    this.centerPlayIcon = null;
    this.centerPauseIcon = null;

    this.playPauseBtn = null;
    this.playIcon = null;
    this.pauseIcon = null;
    this.rewindBtn = null;
    this.forwardBtn = null;

    this.isDragging = false;
  }

  init() {
    this.player = document.getElementById('video-player');
    this.overlay = document.getElementById('video-overlay');
    this.movieTitleDisplay = document.getElementById('video-movie-title');
    this.loader = document.getElementById('video-loader');
    this.bufferingSpinner = document.getElementById('buffering-spinner-wrapper');
    this.controls = document.getElementById('video-controls');
    this.timelineContainer = document.getElementById('timeline-container');
    this.timelineProgress = document.getElementById('timeline-progress');
    this.timelineBuffered = document.getElementById('timeline-buffered');
    this.timelineHandle = document.getElementById('timeline-handle');
    this.videoTime = document.getElementById('video-time');
    this.backBtn = document.getElementById('back-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');
    this.fullscreenIcon = document.getElementById('fullscreen-icon');
    this.nextEpisodeBtn = document.getElementById('next-episode-btn');
    this.subtitlesContainer = document.querySelector('.subtitles-container');
    this.subtitlesBtn = document.getElementById('subtitles-btn');
    this.subtitlesDropdown = document.getElementById('subtitles-dropdown');
    this.subtitlesOverlay = document.getElementById('subtitles-container');

    this.centerPlayPauseBtn = document.getElementById('center-play-pause-btn');
    this.centerRewindBtn = document.getElementById('center-rewind-btn');
    this.centerForwardBtn = document.getElementById('center-forward-btn');
    this.centerPlayIcon = document.getElementById('center-play-icon');
    this.centerPauseIcon = document.getElementById('center-pause-icon');

    this.playPauseBtn = document.getElementById('play-pause-btn');
    this.playIcon = document.getElementById('play-icon');
    this.pauseIcon = document.getElementById('pause-icon');
    this.rewindBtn = document.getElementById('rewind-btn');
    this.forwardBtn = document.getElementById('forward-btn');

    this.bindEvents();
  }

  bindEvents() {
    const togglePlay = () => this.togglePlayState();
    const toggleFullscreen = () => this.toggleFullscreenState();
    const performSeek = (time) => this.seekPlayer(time);

    this.bindKeyboardControls(togglePlay, toggleFullscreen, performSeek);
    this.bindTouchControls();
    this.bindOverlayControls(togglePlay, toggleFullscreen, performSeek);
    this.bindControlBarActions(togglePlay, toggleFullscreen, performSeek);
    this.bindPlayerStateEvents(performSeek);
    this.bindTimelineControls(performSeek);
  }

  togglePlayState() {
    if (this.player.style.display === 'none') return;
    if (this.player.paused) this.player.play().catch(() => {});
    else this.player.pause();
    this.showHUD();
  }

  toggleFullscreenState() {
    if (!document.fullscreenElement) {
      this.overlay.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  seekPlayer(time) {
    if (!this.player) return;
    if (this.playerState.scrubTimeout) {
      clearTimeout(this.playerState.scrubTimeout);
      this.playerState.scrubTimeout = null;
    }
    this.playerState.scrubTime = null;
    this.playerState.wasPlayingBeforeScrub = false;
    this.playerState.scrubStartTime = null;
    this.player.currentTime = time;
    this.showHUD();
  }

  bindKeyboardControls(togglePlay, toggleFullscreen, performSeek) {
    window.addEventListener('keydown', (e) => {
      if (this.overlay.style.display === 'flex' && this.player.style.display !== 'none') {
        if (e.code === 'Space') {
          const active = document.activeElement;
          if (active && (active.tagName === 'BUTTON' || active.getAttribute('role') === 'button')) {
            if (active.id !== 'timeline-container') {
              return;
            }
          }
          e.preventDefault();
          togglePlay();
        } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          const container = document.querySelector('.video-container');
          const isHudActive = container && container.classList.contains('hud-active');
          if (!isHudActive) {
            this.showHUD();
            this.startScrubSession();
          } else {
            this.scrub(e.code === 'ArrowLeft' ? 'left' : 'right');
          }
        } else if (e.code === 'KeyF') {
          toggleFullscreen();
        }
      }
    });
  }

  bindTouchControls() {
    if (this.subtitlesBtn && this.subtitlesContainer) {
      this.subtitlesBtn.onclick = (e) => {
        if (isDesktop()) return;
        e.stopPropagation();
        const isOpen = this.subtitlesContainer.classList.contains('menu-open');
        if (isOpen) {
          this.subtitlesContainer.classList.remove('menu-open');
        } else {
          this.subtitlesContainer.classList.add('menu-open');
          this.showHUD();
        }
      };
    }
  }

  bindOverlayControls(togglePlay, toggleFullscreen, performSeek) {
    this.overlay.addEventListener('click', (e) => {
      const clickedMenu = e.target.closest('.subtitles-container');
      if (!clickedMenu && this.subtitlesContainer) {
        this.subtitlesContainer.classList.remove('menu-open');
      }

      if (e.target === this.overlay || e.target === this.player || e.target.classList.contains('video-container')) {
        if (isDesktop()) {
          togglePlay();
        } else {
          const container = document.querySelector('.video-container');
          const isHudActive = container && container.classList.contains('hud-active');
          if (isHudActive) {
            this.hideHUD();
          } else {
            this.showHUD();
          }
        }
      }
    });

    if (this.centerPlayPauseBtn) this.centerPlayPauseBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
    if (this.centerRewindBtn) this.centerRewindBtn.onclick = (e) => { e.stopPropagation(); performSeek(Math.max(0, this.player.currentTime - 10)); };
    if (this.centerForwardBtn) this.centerForwardBtn.onclick = (e) => { e.stopPropagation(); performSeek(Math.min(this.getDuration(), this.player.currentTime + 10)); };

    this.overlay.addEventListener('dblclick', (e) => {
      if (e.target === this.overlay || e.target === this.player || e.target.classList.contains('video-container')) {
        toggleFullscreen();
      }
    });

    this.overlay.addEventListener('mousemove', () => {
      if (isDesktop()) {
        this.showHUD();
      }
    });
  }

  bindControlBarActions(togglePlay, toggleFullscreen, performSeek) {
    this.playPauseBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
    this.rewindBtn.onclick = (e) => { e.stopPropagation(); performSeek(Math.max(0, this.player.currentTime - 10)); };
    this.forwardBtn.onclick = (e) => { e.stopPropagation(); performSeek(Math.min(this.getDuration(), this.player.currentTime + 10)); };
    this.fullscreenBtn.onclick = (e) => { e.stopPropagation(); toggleFullscreen(); };
    this.nextEpisodeBtn.onclick = (e) => {
      e.stopPropagation();
      eventBus.emit('start-next-episode');
    };

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        this.fullscreenIcon.classList.remove('fa-expand');
        this.fullscreenIcon.classList.add('fa-compress');
      } else {
        this.fullscreenIcon.classList.remove('fa-compress');
        this.fullscreenIcon.classList.add('fa-expand');
      }
    });

    this.backBtn.onclick = (e) => {
      e.stopPropagation();
      const finalTime = this.player ? this.player.currentTime : 0;
      const currentItem = this.playerState.currentMovie || this.playerState.currentShow;
      
      this.close();
      this.saveProgress(finalTime);
      
      if (!this.playerState.currentMovie && currentItem) {
        eventBus.emit('open-show-details', currentItem);
      }
      eventBus.emit('player-closed');
    };

    document.addEventListener('mouseleave', () => {
      this.hideHUD();
    });
  }

  bindPlayerStateEvents(performSeek) {
    const updatePlayIcons = () => {
      if (this.player.paused) {
        this.playIcon.style.display = 'block';
        this.pauseIcon.style.display = 'none';
        if (this.centerPlayIcon) this.centerPlayIcon.style.display = 'block';
        if (this.centerPauseIcon) this.centerPauseIcon.style.display = 'none';
      } else {
        this.playIcon.style.display = 'none';
        this.pauseIcon.style.display = 'block';
        if (this.centerPlayIcon) this.centerPlayIcon.style.display = 'none';
        if (this.centerPauseIcon) this.centerPauseIcon.style.display = 'block';
      }
      this.showHUD();
    };

    this.player.onplay = updatePlayIcons;
    this.player.onpause = updatePlayIcons;

    this.player.onwaiting = () => {
      if (this.player.style.display !== 'none') {
        this.loader.style.display = 'flex';
        if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'block';
      }
      this.showHUD();
    };
    
    this.player.onplaying = () => {
      if (this.player.style.display !== 'none') {
        this.loader.style.display = 'none';
        if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'none';
      }
      this.showHUD();
    };
    
    this.player.oncanplay = () => {
      if (this.player.style.display !== 'none') {
        this.loader.style.display = 'none';
        if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'none';
      }
      this.showHUD();
    };

    this.player.onprogress = () => {
      this.updateBufferBar();
    };

    this.player.ontimeupdate = () => {
      if (this.playerState.scrubTime !== null) return;
      const totalDuration = this.getDuration();
      if (isNaN(totalDuration) || totalDuration <= 0) return;
      const displayTime = this.player.currentTime;

      this.renderCustomSubtitles(displayTime);

      const percent = (displayTime / totalDuration) * 100;
      this.timelineProgress.style.width = `${percent}%`;
      this.timelineHandle.style.left = `${percent}%`;
      this.videoTime.innerText = `${formatTime(displayTime)} / ${formatTime(totalDuration)}`;
      
      this.updateBufferBar();

      const currentSecond = Math.floor(displayTime);
      if (currentSecond > 5 && currentSecond % 10 === 0 && currentSecond !== this.playerState.lastSavedSecond) {
        this.playerState.lastSavedSecond = currentSecond;
        this.saveProgress(displayTime);
      }
    };
  }

  renderCustomSubtitles(displayTime) {
    if (!this.subtitlesOverlay) return;
    
    const track = this.player.querySelector('track')?.track;
    if (track && track.mode !== 'disabled') {
      let html = '';
      if (track.activeCues && track.activeCues.length > 0) {
        for (let i = 0; i < track.activeCues.length; i++) {
          html += `<div class="subtitle-cue">${track.activeCues[i].text}</div>`;
        }
      } else if (track.cues) {
        // Fallback
        for (let i = 0; i < track.cues.length; i++) {
          const cue = track.cues[i];
          if (displayTime >= cue.startTime && displayTime <= cue.endTime) {
            html += `<div class="subtitle-cue">${cue.text}</div>`;
          }
        }
      }
      if (this.subtitlesOverlay.innerHTML !== html) {
        this.subtitlesOverlay.innerHTML = html;
      }
    }
  }

  applyPendingSubtitle() {
    if (this.playerState.pendingSubtitle) {
      const autoSub = this.playerState.pendingSubtitle;
      const subUrl = `${apiService.apiBaseUrl}${autoSub.url}`;
      
      this.player.querySelectorAll('track').forEach(t => t.remove());

      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.srclang = autoSub.lang;
      track.src = subUrl;
      track.label = autoSub.label || autoSub.lang;
      track.default = true;
      
      this.player.appendChild(track);
      track.track.mode = 'showing';
      track.track.mode = 'hidden';
      
      console.log(`[PlayerView] Subtitle loaded in loadedmetadata: ${autoSub.lang}`);
      this.playerState.pendingSubtitle = null;
    }
  }

  bindTimelineControls(performSeek) {
    const updateVisualScrub = (time) => {
      const duration = this.getDuration();
      if (isNaN(duration) || duration <= 0) return;
      
      this.playerState.scrubTime = Math.max(0, Math.min(duration, time));
      const percent = (this.playerState.scrubTime / duration) * 100;
      if (this.timelineProgress) this.timelineProgress.style.width = `${percent}%`;
      if (this.timelineHandle) this.timelineHandle.style.left = `${percent}%`;
      if (this.videoTime) {
        this.videoTime.innerText = `${formatTime(this.playerState.scrubTime)} / ${formatTime(duration)}`;
      }
    };

    this.timelineContainer.onmousedown = (e) => {
      e.stopPropagation();
      if (this.player.style.display === 'none') return;
      this.isDragging = true;
      this.startScrubSession();
      
      const rect = this.timelineContainer.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      updateVisualScrub(pos * this.getDuration());
    };

    this.timelineContainer.addEventListener('touchstart', (e) => {
      if (this.player.style.display === 'none') return;
      this.isDragging = true;
      this.startScrubSession();
      
      const rect = this.timelineContainer.getBoundingClientRect();
      const touch = e.touches[0];
      if (touch) {
        const pos = (touch.clientX - rect.left) / rect.width;
        updateVisualScrub(pos * this.getDuration());
      }
    }, { passive: false });

    document.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        const duration = this.getDuration();
        const rect = this.timelineContainer.getBoundingClientRect();
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos));
        
        const finalTime = pos * duration;
        const shouldResume = this.playerState.wasPlayingBeforeScrub;

        this.playerState.scrubTime = null;
        this.playerState.wasPlayingBeforeScrub = false;
        this.isDragging = false;

        this.player.currentTime = finalTime;
        if (shouldResume) {
          this.player.play().catch(() => {});
        }
      }
    });

    document.addEventListener('touchend', (e) => {
      if (this.isDragging) {
        const duration = this.getDuration();
        const rect = this.timelineContainer.getBoundingClientRect();
        const touch = e.touches[0] || e.changedTouches[0];
        let pos = 0.5;
        if (touch) {
          pos = (touch.clientX - rect.left) / rect.width;
        }
        pos = Math.max(0, Math.min(1, pos));

        const finalTime = pos * duration;
        const shouldResume = this.playerState.wasPlayingBeforeScrub;

        this.playerState.scrubTime = null;
        this.playerState.wasPlayingBeforeScrub = false;
        this.isDragging = false;

        this.player.currentTime = finalTime;
        if (shouldResume) {
          this.player.play().catch(() => {});
        }
      }
    }, { passive: false });

    document.onmousemove = (e) => {
      if (this.isDragging && this.player.style.display !== 'none') {
        const rect = this.timelineContainer.getBoundingClientRect();
        let pos = (e.clientX - rect.left) / rect.width;
        pos = Math.max(0, Math.min(1, pos));
        updateVisualScrub(pos * this.getDuration());
      }
    };

    document.addEventListener('touchmove', (e) => {
      if (this.isDragging && this.player.style.display !== 'none') {
        if (e.cancelable) e.preventDefault();
        const rect = this.timelineContainer.getBoundingClientRect();
        const touch = e.touches[0];
        if (touch) {
          let pos = (touch.clientX - rect.left) / rect.width;
          pos = Math.max(0, Math.min(1, pos));
          updateVisualScrub(pos * this.getDuration());
        }
      }
    }, { passive: false });
  }

  startScrubSession() {
    if (!this.player) return;
    if (this.playerState.scrubTime === null) {
      this.playerState.scrubTime = this.player.currentTime;
      this.playerState.wasPlayingBeforeScrub = !this.player.paused;
      this.playerState.scrubStartTime = Date.now();
      if (this.playerState.wasPlayingBeforeScrub) {
        this.player.pause();
      }
    }
  }

  scrub(direction) {
    if (!this.player) return;
    const duration = this.getDuration();
    if (isNaN(duration) || duration <= 0) return;

    this.startScrubSession();

    // Calculate dynamic step based on elapsed hold duration
    const elapsed = Date.now() - (this.playerState.scrubStartTime || Date.now());
    let step = 10;
    if (elapsed > 3000) {
      step = 60; // 1 minute
    } else if (elapsed > 1500) {
      step = 30; // 30 seconds
    }

    if (direction === 'left') {
      this.playerState.scrubTime = Math.max(0, this.playerState.scrubTime - step);
    } else {
      this.playerState.scrubTime = Math.min(duration, this.playerState.scrubTime + step);
    }

    // Update UI immediately
    const percent = (this.playerState.scrubTime / duration) * 100;
    if (this.timelineProgress) this.timelineProgress.style.width = `${percent}%`;
    if (this.timelineHandle) this.timelineHandle.style.left = `${percent}%`;
    if (this.videoTime) {
      this.videoTime.innerText = `${formatTime(this.playerState.scrubTime)} / ${formatTime(duration)}`;
    }

    if (this.playerState.scrubTimeout) {
      clearTimeout(this.playerState.scrubTimeout);
    }

    this.showHUD();

    this.playerState.scrubTimeout = setTimeout(() => {
      const finalTime = this.playerState.scrubTime;
      const shouldResume = this.playerState.wasPlayingBeforeScrub;

      this.playerState.scrubTime = null;
      this.playerState.scrubTimeout = null;
      this.playerState.wasPlayingBeforeScrub = false;
      this.playerState.scrubStartTime = null;

      this.player.currentTime = finalTime;
      if (shouldResume) {
        this.player.play().catch(() => {});
      }
    }, 500);
  }

  getDuration() {
    if (!this.player) return 0;
    if (!isNaN(this.player.duration) && this.player.duration !== Infinity) return this.player.duration;
    
    const currentItem = this.playerState.currentMovie || this.playerState.currentShow;
    const epRuntime = this.playerState.currentEpisode ? (this.playerState.currentEpisode.runtime || this.playerState.currentEpisode.duration) : null;
    const metadataDuration = (parseInt(epRuntime, 10) || parseInt(currentItem?.runtime, 10) || 0) * 60;
    if (metadataDuration > 0) return metadataDuration;
    
    return (this.player.duration === Infinity || isNaN(this.player.duration)) ? this.player.currentTime : this.player.duration;
  }

  updateBufferBar() {
    if (this.player.buffered && this.player.buffered.length > 0 && this.player.style.display !== 'none') {
      const currentTime = this.player.currentTime;
      let bufferedEnd = 0;
      for (let i = 0; i < this.player.buffered.length; i++) {
        const start = this.player.buffered.start(i);
        const end = this.player.buffered.end(i);
        if (currentTime >= start && currentTime <= end) {
          bufferedEnd = end;
          break;
        }
      }
      const duration = this.getDuration();
      if (duration > 0) {
        const bufferedPercent = (bufferedEnd / duration) * 100;
        if (this.timelineBuffered) {
          this.timelineBuffered.style.width = `${Math.min(100, bufferedPercent)}%`;
        }
      }
    }
  }

  close() {
    this.isOpen = false;
    this.currentSessionId++;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    if (this.hudTimeout) {
      clearTimeout(this.hudTimeout);
      this.hudTimeout = null;
    }

    if (this.playerState.scrubTimeout) {
      clearTimeout(this.playerState.scrubTimeout);
      this.playerState.scrubTimeout = null;
    }
    this.playerState.scrubTime = null;
    this.playerState.wasPlayingBeforeScrub = false;
    this.playerState.scrubStartTime = null;
    this.playerState.pendingSubtitle = null;

    if (this.subtitlesOverlay) {
      this.subtitlesOverlay.innerHTML = '';
    }

    if (this.subtitlesContainer) {
      this.subtitlesContainer.classList.remove('menu-open');
    }

    if (this.player) {
      this.player.pause();
      
      if (this.player._hls) {
        try {
          this.player._hls.stopLoad();
          this.player._hls.detachMedia();
          this.player._hls.destroy();
        } catch (e) {
          console.warn('[PlayerView] Error destroying Hls instance:', e);
        }
        this.player._hls = null;
      }

      this.player.onloadedmetadata = null;
      this.player.oncanplay = null;
      this.player.querySelectorAll('track').forEach(t => t.remove());

      this.player.removeAttribute('src');
      this.player.load();
      this.player.style.display = 'none';
    }

    if (this.loader) this.loader.style.display = 'none';
    if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'none';
    if (this.controls) this.controls.style.display = 'none';

    navigationService.closePlayer();
  }

  setupSubtitlesMenu(subtitlesPromise, sessionId = this.currentSessionId) {
    if (!this.subtitlesDropdown) return;
    this.subtitlesDropdown.innerHTML = '<div class="spinner-small"></div>';

    const currentMovie = this.playerState.currentMovie;
    const currentShow = this.playerState.currentShow;
    const mediaId = currentMovie ? currentMovie.id : (currentShow ? currentShow.id : null);
    
    const prefPromise = mediaId ? apiService.getSubtitlePreference(mediaId) : Promise.resolve(null);

    Promise.all([subtitlesPromise, prefPromise]).then(([data, pref]) => {
      if (!this.isOpen || sessionId !== this.currentSessionId) return;
      const filtered = data.subtitles || [];

      // Group by language
      const groups = {};
      filtered.forEach(sub => {
        if (!groups[sub.lang]) groups[sub.lang] = [];
        groups[sub.lang].push(sub);
      });

      // Sort within each language and generate dynamic labels
      const sortedSubs = [];
      Object.keys(LANG_MAP).forEach(lang => {
        if (groups[lang]) {
          // Sort by score descending (null or undefined scores go to the bottom)
          groups[lang].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          
          const totalForLang = groups[lang].length;
          groups[lang].forEach((sub, index) => {
            sub.label = totalForLang === 1 ? LANG_MAP[lang] : `${LANG_MAP[lang]} ${index + 1}`;
            sub.langIndex = index + 1;
            sortedSubs.push(sub);
          });
        }
      });
      
      // Also add any other languages that might be returned but not in LANG_MAP
      filtered.forEach(sub => {
        if (!sortedSubs.some(s => s.id === sub.id)) {
          const totalForLang = filtered.filter(s => s.lang === sub.lang).length;
          const count = sortedSubs.filter(s => s.lang === sub.lang).length;
          sub.label = totalForLang === 1 ? sub.lang : `${sub.lang} ${count + 1}`;
          sub.langIndex = count + 1;
          sortedSubs.push(sub);
        }
      });

      const renderMenu = (activeSubId) => {
        const hadFocus = this.subtitlesDropdown.contains(document.activeElement);
        this.subtitlesDropdown.innerHTML = '';
        
        // "Off" option
        const offItem = document.createElement('div');
        offItem.className = `dropdown-item ${!activeSubId ? 'active' : ''}`;
        offItem.tabIndex = 0;
        offItem.innerText = 'Off';
        offItem.onclick = (e) => {
          e.stopPropagation();
          if (this.subtitlesContainer) this.subtitlesContainer.classList.remove('menu-open');
          if (this.subtitlesOverlay) this.subtitlesOverlay.innerHTML = '';
          this.player.querySelectorAll('track').forEach(t => t.remove());
          if (mediaId) apiService.saveSubtitlePreference(mediaId, 'off');
          renderMenu(null);
        };
        this.subtitlesDropdown.appendChild(offItem);

        let activeItem = null;

        sortedSubs.forEach((sub) => {
          const item = document.createElement('div');
          item.className = `dropdown-item ${activeSubId === sub.id ? 'active' : ''}`;
          item.tabIndex = 0;
          if (activeSubId === sub.id) activeItem = item;
          
          item.innerText = sub.label || sub.lang;
          
          item.onclick = (e) => {
            e.stopPropagation();
            if (this.subtitlesContainer) this.subtitlesContainer.classList.remove('menu-open');
            const subUrl = `${apiService.apiBaseUrl}${sub.url}`;
            this.player.querySelectorAll('track').forEach(t => t.remove());
            
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.srclang = sub.lang;
            track.src = subUrl;
            track.label = sub.label || sub.lang;
            track.default = true;
            this.player.appendChild(track);
            track.track.mode = 'showing';
            track.track.mode = 'hidden';
            
            if (mediaId) apiService.saveSubtitlePreference(mediaId, sub.lang);
            renderMenu(sub.id);
          };
          this.subtitlesDropdown.appendChild(item);
        });

        if (activeItem) {
          requestAnimationFrame(() => {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            if (hadFocus) {
              activeItem.focus();
            }
          });
        }
      };

      let autoSub = null;
      if (pref) {
        if (pref === 'off') {
          autoSub = null;
        } else {
          // Try to find the first subtitle of that language
          autoSub = sortedSubs.find(s => s.lang === pref);
          
          // Fallback to selecting the first available subtitle overall
          if (!autoSub) {
            autoSub = sortedSubs.length > 0 ? sortedSubs[0] : null;
          }
        }
      } else if (sortedSubs.length > 0) {
        // Autoplay the first subtitle (Index 0, which is our highest scoring aligned track)
        autoSub = sortedSubs[0];
      }
      
      renderMenu(autoSub ? autoSub.id : null);

      if (autoSub) {
        if (this.player.readyState >= 1) {
          const subUrl = `${apiService.apiBaseUrl}${autoSub.url}`;
          this.player.querySelectorAll('track').forEach(t => t.remove());

          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.srclang = autoSub.lang;
          track.src = subUrl;
          track.label = autoSub.label || autoSub.lang;
          track.default = true;
          this.player.appendChild(track);
          track.track.mode = 'showing';
          track.track.mode = 'hidden';
          console.log(`[PlayerView] Subtitle appended immediately: ${autoSub.lang}`);
        } else {
          this.playerState.pendingSubtitle = autoSub;
          console.log(`[PlayerView] Subtitle queued for loadedmetadata: ${autoSub.lang}`);
        }
      }
    }).catch(err => {
      console.error('Failed to setup subtitles menu:', err);
      this.subtitlesDropdown.innerHTML = '<div class="dropdown-item">Error loading subtitles</div>';
    });
  }

  open(item, startTime = 0, hasNextEpisode = false, subtitlesPromise = null) {
    this.isOpen = true;
    this.currentSessionId++;
    const sessionId = this.currentSessionId;

    if (item && item.type) {
      this.playerState.currentMovie = item.type === 'movie' ? item : null;
      this.playerState.currentShow = (item.type === 'series' || item.type === 'show') ? item : null;
    }
    this.playerState.lastSavedSecond = -1;

    if (this.playerState.scrubTimeout) {
      clearTimeout(this.playerState.scrubTimeout);
      this.playerState.scrubTimeout = null;
    }
    this.playerState.scrubTime = null;
    this.playerState.wasPlayingBeforeScrub = false;
    this.playerState.scrubStartTime = null;

    if (this.player._hls) {
      try {
        this.player._hls.stopLoad();
        this.player._hls.detachMedia();
        this.player._hls.destroy();
      } catch (e) {}
      this.player._hls = null;
    }
    if (this.player) {
      this.player.pause();
      this.player.onloadedmetadata = null;
      this.player.oncanplay = null;
      this.player.removeAttribute('src');
      this.player.style.display = 'none';
      this.player.querySelectorAll('track').forEach(t => t.remove());
    }

    if (this.controls) this.controls.style.display = 'none';
    if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'block';
    if (this.loader) this.loader.style.display = 'flex';
    if (this.movieTitleDisplay) this.movieTitleDisplay.innerText = item.name;
    if (this.subtitlesOverlay) this.subtitlesOverlay.innerHTML = '';
    this.playerState.pendingSubtitle = null;

    if (subtitlesPromise) {
      this.setupSubtitlesMenu(subtitlesPromise, sessionId);
    }

    if (this.nextEpisodeBtn) {
      this.nextEpisodeBtn.style.display = hasNextEpisode ? 'block' : 'none';
    }

    if (this.timelineProgress) this.timelineProgress.style.width = '0%';
    if (this.timelineBuffered) this.timelineBuffered.style.width = '0%';
    if (this.timelineHandle) this.timelineHandle.style.left = '0%';
    if (this.videoTime) this.videoTime.innerText = '0:00 / 0:00';
    
    navigationService.openPlayer();
    this.showHUD();
  }

  handleStreamUrl(data, startTime, sessionId = this.currentSessionId) {
    if (!this.isOpen || sessionId !== this.currentSessionId) return;
    if (!this.playerState.currentMovie && !this.playerState.currentShow) return;

    const startAt = startTime || 0;
    this.saveProgress(startAt);

    if (this.controls) this.controls.style.display = 'flex';
    if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'block';
    if (this.loader) this.loader.style.display = 'flex';

    if (this.player._hls) {
      try {
        this.player._hls.stopLoad();
        this.player._hls.detachMedia();
        this.player._hls.destroy();
      } catch (e) {}
      this.player._hls = null;
    }

    this.player.onloadedmetadata = () => {
      if (!this.isOpen || sessionId !== this.currentSessionId) return;
      this.player.style.display = 'block';
      if (startAt > 0) {
        this.player.currentTime = startAt;
      }
      this.player.play().catch(() => {});
      this.applyPendingSubtitle();
    };

    this.player.oncanplay = () => {
      if (!this.isOpen || sessionId !== this.currentSessionId) return;
      this.player.style.display = 'block';
      if (this.loader) this.loader.style.display = 'none';
      if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'none';
      this.player.play().catch(() => {});
    };

    if (data.url.endsWith('.m3u8')) {
      this.initHlsPlayer(data.url, startAt, sessionId);
    } else {
      this.initNativePlayer(data.url);
    }
  }

  initHlsPlayer(url, startAt, sessionId = this.currentSessionId) {
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(this.player);
      this.player._hls = hls;

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (!this.isOpen || sessionId !== this.currentSessionId) {
          try {
            hls.stopLoad();
            hls.detachMedia();
            hls.destroy();
          } catch (e) {}
          return;
        }
        console.log('[VideoPlayer] HLS manifest parsed, ready to play.');
        if (this.loader) this.loader.style.display = 'none';
        if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'none';
        if (startAt > 0) {
          this.player.currentTime = startAt;
        }
        this.player.play().catch(e => {
          console.warn('Autoplay blocked. User action required to play:', e);
        });
      });

      hls.on(window.Hls.Events.ERROR, (event, errData) => {
        if (!this.isOpen || sessionId !== this.currentSessionId) return;
        console.error('[VideoPlayer] Hls.js error:', errData);
        if (errData.fatal) {
          if (this.loader) this.loader.style.display = 'none';
          if (this.bufferingSpinner) this.bufferingSpinner.style.display = 'none';
        }
      });
    } else if (this.player.canPlayType('application/vnd.apple.mpegurl')) {
      this.player.src = url;
    } else {
      console.error('HLS is not supported in this browser.');
      this.player.src = url;
    }
  }

  initNativePlayer(url) {
    this.player.src = url;
  }

  handleStreamError(err) {
    this.close();
  }

  async startStream(payload, startTime) {
    const sessionId = this.currentSessionId;
    this.playerState.lastSavedSecond = -1;
    if (this.loader) this.loader.style.display = 'block';
    try {
      const res = await apiService.startStream(payload);
      if (sessionId !== this.currentSessionId || !this.isOpen) {
        console.log('[PlayerView] Stream response arrived after player closed, aborting.');
        return;
      }
      if (res && res.success && res.url) {
        this.handleStreamUrl({ url: res.url }, startTime, sessionId);
      } else {
        this.handleStreamError((res && res.error) || "Failed to start stream");
        Toast.show(CONTENT_UNAVAILABLE_MSG, 'error');
      }
    } catch (err) {
      if (sessionId !== this.currentSessionId || !this.isOpen) return;
      this.handleStreamError(err.message || err);
      Toast.show(CONTENT_UNAVAILABLE_MSG, 'error');
    }
  }

  showHUD() {
    const isState2 = this.player && this.player.style.display !== 'none';
    const container = document.querySelector('.video-container');
    const topBar = document.querySelector('.video-top-bar');

    if (this.controls && isState2) {
      this.controls.style.opacity = '1';
      this.controls.style.pointerEvents = 'auto';
    }
    if (topBar) {
      topBar.style.opacity = '1';
      topBar.style.pointerEvents = 'auto';
    }
    if (this.overlay) this.overlay.style.cursor = 'default';
    if (container) container.classList.add('hud-active');

    if (this.hudTimeout) clearTimeout(this.hudTimeout);

    const isMobileSubtitlesOpen = !isDesktop() && this.subtitlesContainer && this.subtitlesContainer.classList.contains('menu-open');
    if (isMobileSubtitlesOpen) return;

    if (this.player && !this.player.paused && this.loader && this.loader.style.display === 'none') {
      this.hudTimeout = setTimeout(() => this.hideHUD(), 3000);
    }
  }

  hideHUD() {
    const topBar = document.querySelector('.video-top-bar');
    const container = document.querySelector('.video-container');

    if (this.hudTimeout) clearTimeout(this.hudTimeout);
    
    if (this.controls) {
      this.controls.style.opacity = '0';
      this.controls.style.pointerEvents = 'none';
    }
    if (topBar) {
      topBar.style.opacity = '0';
      topBar.style.pointerEvents = 'none';
    }
    if (this.overlay) this.overlay.style.cursor = 'none';
    if (container) container.classList.remove('hud-active');
  }

  saveProgress(timestamp) {
    const currentItem = this.playerState.currentMovie || this.playerState.currentShow;
    if (!currentItem) return;

    const isShow = !!this.playerState.currentShow;
    const mediaId = currentItem.id;
    const durationSec = this.getDuration();
    const runtimeMinutes = durationSec > 0 
      ? Math.round(durationSec / 60) 
      : (parseInt(this.playerState.currentEpisode?.runtime || currentItem.runtime, 10) || undefined);

    apiService.saveTimestamp({
      [isShow ? 'showId' : 'movieId']: mediaId,
      timestamp: timestamp > 1 ? timestamp : undefined,
      metadata: {
        runtime: runtimeMinutes,
        ...(isShow && this.playerState.currentEpisode ? {
          season: this.playerState.currentEpisode.season,
          episode: this.playerState.currentEpisode.episode || this.playerState.currentEpisode.number
        } : {})
      }
    });
  }
}

export const playerView = new PlayerView();
export default playerView;
