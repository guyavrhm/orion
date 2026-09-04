/**
 * Event payloads, Server-Sent Events (SSE), and real-time status types.
 */

// Backend media request states across the worker pipeline
export const MEDIA_REQUEST_STATUS = Object.freeze({
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
  REMOVED: 'removed'
} as const);

export type MediaRequestStatus = typeof MEDIA_REQUEST_STATUS[keyof typeof MEDIA_REQUEST_STATUS];

export type UserMediaRequestStatus = 'queued' | 'preparing' | 'ready' | 'failed' | 'removed';

export interface MediaRequestStatusEvent {
  id: string;
  status: MediaRequestStatus;
  progress: string;
  error?: string;
  stage?: string;
}

export interface UserMediaRequestResponse {
  id: string;
  status: UserMediaRequestStatus;
  progress: string;
}

// ==========================================
// 2. Active In-Flight Media State (Redis)
// ==========================================

export interface ActiveMediaState {
  fileId: string;
  status: MediaRequestStatus;
  progress: string;
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

export interface UserActiveMediaState {
  fileId: string;
  status: UserMediaRequestStatus;
  progress: string;
  error?: string;
  updatedAt: number;
}

export interface QueueStateResponse {
  activeMediaRequests: Record<string, UserActiveMediaState>;
  error?: string;
}
