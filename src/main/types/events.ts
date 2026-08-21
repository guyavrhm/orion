/**
 * Event payloads, Server-Sent Events (SSE), and real-time status types.
 */

// ==========================================
// 1. Download Status Enum & Events
// ==========================================

export const DOWNLOAD_STATUS = Object.freeze({
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REMOVED: 'removed'
} as const);

export type DownloadStatus = typeof DOWNLOAD_STATUS[keyof typeof DOWNLOAD_STATUS];

export interface DownloadStatusEvent {
  id: string;
  status: DownloadStatus;
  progress: number | string;
  error?: string;
  stage?: string;
}

// ==========================================
// 2. Active In-Flight Media State (Redis)
// ==========================================

export interface ActiveMediaState {
  id?: string;
  fileId?: string;
  status: DownloadStatus;
  progress: string | number;
  error?: string;
  updatedAt: number;
}

// ==========================================
// 3. Redis Pub/Sub & SSE Message Payloads
// ==========================================

export interface RedisEventPayload<T = unknown> {
  channel: string;
  data: T;
  timestamp: string;
}

export interface SseEventPayload<T = unknown> {
  channel: string;
  data: T;
}

// ==========================================
// 4. API Queue State Response
// ==========================================

export interface QueueStateResponse {
  activeDownloads: Record<string, ActiveMediaState>;
  active: ActiveMediaState | null;
  current: ActiveMediaState | null;
  queue: ActiveMediaState[];
  error?: string;
}
