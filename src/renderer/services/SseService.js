import { store } from '../state/Store.js';
import { eventBus } from '../utils/EventBus.js';
import { MEDIA_REQUEST_STATUS } from '../utils/constants.js';

class SseService {
  constructor() {
    this.eventSource = null;
  }

  connect() {
    if (this.eventSource) return;
    
    console.log('[SseService] Connecting to Server-Sent Events...');
    this.eventSource = new EventSource('/events');

    this.eventSource.onopen = () => {
      console.log('[SseService] SSE connection successfully opened.');
      eventBus.emit('sse-connected');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const { channel, data } = JSON.parse(event.data);
        
        // Translate localhost stream URLs to actual hostname
        if (channel === 'stream-url' && data && data.url) {
          this.translateStreamUrl(data);
        }

        if (channel === 'media-request-status' && data) {
          this.handleMediaRequestStatus(data);
        }
      } catch (e) {
        console.error('[SseService] SSE error processing message:', e);
      }
    };

    this.eventSource.onerror = () => {
      console.warn('[SseService] SSE connection lost. Reconnecting...');
      this.close();
      setTimeout(() => this.connect(), 3000);
    };
  }

  translateStreamUrl(data) {
    const base = data.url.startsWith('http') ? undefined : window.location.origin;
    const urlObj = new URL(data.url, base);
    urlObj.hostname = window.location.hostname;
    urlObj.port = window.location.port;
    data.url = urlObj.toString();
    store.notify('stream-url-received', data);
  }

  handleMediaRequestStatus({ id, status, progress }) {
    if (!id) return;

    switch (status) {
      case MEDIA_REQUEST_STATUS.READY:
        store.setMediaRequestStatus(id, true);
        break;
      case MEDIA_REQUEST_STATUS.REMOVED:
      case MEDIA_REQUEST_STATUS.FAILED:
        store.setMediaRequestStatus(id, false);
        break;
      case MEDIA_REQUEST_STATUS.QUEUED:
      case MEDIA_REQUEST_STATUS.PREPARING:
        store.setActiveMediaRequest(id, status, progress ?? '0.00');
        break;
      default:
        console.warn(`[SseService] Unknown request status: ${status}`);
    }
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

export const sseService = new SseService();
