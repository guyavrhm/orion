import { ErrorCode } from './constants.js';

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds === 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatRuntime(minutes) {
  if (!minutes) return '';
  const mins = parseInt(minutes);
  if (isNaN(mins)) return minutes;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function isDesktop() {
  return window.matchMedia('(hover: hover)').matches;
}

export function setupScrollHover(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!isDesktop()) return;
  
  let scrollSpeed = 0;
  let scrollInterval = null;
  const threshold = 150;
  const maxScrollSpeed = 15;

  const style = window.getComputedStyle(container);
  const isVertical = style.flexDirection === 'column';
  
  const scrollProp = isVertical ? 'scrollTop' : 'scrollLeft';
  const sizeProp = isVertical ? 'height' : 'width';

  const startScrolling = () => {
    if (!scrollInterval) {
      scrollInterval = setInterval(() => {
        if (scrollSpeed !== 0) {
          container[scrollProp] += scrollSpeed;
        }
      }, 16);
    }
  };

  const stopScrolling = () => {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  };

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    const mousePos = isVertical ? (e.clientY - rect.top) : (e.clientX - rect.left);
    const containerSize = rect[sizeProp];

    if (mousePos < threshold) {
      const intensity = (threshold - mousePos) / threshold;
      scrollSpeed = -maxScrollSpeed * intensity;
      startScrolling();
    } else if (mousePos > containerSize - threshold) {
      const intensity = (mousePos - (containerSize - threshold)) / threshold;
      scrollSpeed = maxScrollSpeed * intensity;
      startScrolling();
    } else {
      scrollSpeed = 0;
      stopScrolling();
    }
  });

  container.addEventListener('mouseleave', () => {
    scrollSpeed = 0;
    stopScrolling();
  });
}

export function extractYear(dateValue) {
  if (!dateValue) return '';
  const str = dateValue.toString();
  const match = str.match(/\b(19\d\d|20\d\d)\b/);
  return match ? match[1] : '';
}

export function buildMetadataHtml(item, options = {}) {
  if (!item) return '';
  const parts = [];
  const type = item.type === 'show' ? 'Show' : 'Movie';
  parts.push(`<span>${type}</span>`);

  const genre = item.genres && item.genres.length > 0 ? item.genres[0] : '';
  if (genre) {
    parts.push(`<span>${genre}</span>`);
  }

  // Insert episode title if requested (e.g. desktop continue watching card info)
  const season = item.season;
  const epNum = item.episode;
  let epObj = null;
  if (item.type === 'show' && season && Array.isArray(item.episodes)) {
    epObj = item.episodes.find(v => v.season === season && v.episode === epNum);
  }

  if (options.includeEpisodeTitle && item.type === 'show' && season) {
    const epTitle = (epObj && epObj.title) ? epObj.title : `Episode ${epNum}`;
    parts.push(`<span style="color: #E50914; font-weight: bold;">S${season} E${epNum}:</span> <span style="color: #E50914; font-weight: bold;">${epTitle}</span>`);
  }

  // Year: prefer episode year for continue watching shows, fallback to show/item year
  const year = extractYear((epObj && epObj.released) ? epObj.released : (item.year || ''));
  if (year) {
    parts.push(`<span>${year}</span>`);
  }

  // Runtime: prefer episode runtime if available, else item runtime
  const rawRuntime = (epObj && epObj.runtime) ? epObj.runtime : item.runtime;
  const runtime = formatRuntime(rawRuntime);
  if (runtime) {
    parts.push(`<span>${runtime}</span>`);
  }

  // Rating: prefer episode rating, fallback to item rating
  const rating = (epObj && epObj.rating) ? epObj.rating : item.rating;
  if (rating && parseFloat(rating) > 0) {
    parts.push(`<span>${rating} <i class="fa-solid fa-star"></i></span>`);
  }

  return parts.join('<span class="dot">•</span>');
}

export function buildEpisodeMetadataHtml(episode, show = null) {
  if (!episode) return '';
  const parts = [];

  const year = extractYear(episode.released || (show ? show.year : ''));
  if (year) {
    parts.push(`<span>${year}</span>`);
  }

  const runtime = formatRuntime(episode.runtime || (show ? show.runtime : null));
  if (runtime) {
    parts.push(`<span>${runtime}</span>`);
  }

  const rating = episode.rating;
  if (rating && parseFloat(rating) > 0) {
    parts.push(`<span>${rating} <i class="fa-solid fa-star"></i></span>`);
  }

  return parts.join('<span class="dot">•</span>');
}

export function getMediaRequestErrorMessage(code) {
  switch (code) {
    case ErrorCode.PROVIDER_NOT_CONFIGURED:
      return 'Torrent provider is not configured. Please check server settings in .env.';
    case ErrorCode.PROVIDER_UNAVAILABLE:
      return 'Torrent provider is temporarily unavailable or timed out. Please try again later.';
    case ErrorCode.NO_STREAMS_FOUND:
      return 'No streams found for this title.';
    case ErrorCode.MEDIA_NOT_READY:
      return 'Content is not ready yet. Please request it first.';
    default:
      return 'Failed to request media. Please try again later.';
  }
}
