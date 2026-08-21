/**
 * Queue, worker, and job lifecycle configuration.
 */

export const QUEUE_PREFIX = process.env.QUEUE_PREFIX || 'orion';

export const QUEUE_NAMES = Object.freeze({
  DOWNLOAD: 'download',
  TRANSCODE: 'transcode',
  TRANSCODE_FAST: 'transcode-fast',
  TRANSCODE_HEAVY: 'transcode-heavy',
  SUBTITLE: 'subtitle',
  FINALIZE: 'finalize'
} as const);

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export const EVENTS_CHANNEL = `${QUEUE_PREFIX}:events`;

export const JOB_PRIORITIES = Object.freeze({
  HIGH: 1,      // Fresh / untested downloads
  NORMAL: 5,    // Standard jobs
  LOW: 10       // Stalled / pre-empted downloads
} as const);

export const DEFAULT_JOB_OPTIONS = Object.freeze({
  removeOnComplete: true,
  removeOnFail: true,
  attempts: 1
} as const);

const defaultTranscode = parseInt(process.env.CONCURRENCY_TRANSCODE || '1', 10);

export const WORKER_CONCURRENCY = Object.freeze({
  DOWNLOAD: parseInt(process.env.CONCURRENCY_DOWNLOAD || '3', 10),
  TRANSCODE: defaultTranscode,
  TRANSCODE_FAST: parseInt(process.env.CONCURRENCY_TRANSCODE_FAST || '1', 10),
  TRANSCODE_HEAVY: parseInt(process.env.CONCURRENCY_TRANSCODE_HEAVY || String(defaultTranscode), 10),
  SUBTITLE: parseInt(process.env.CONCURRENCY_SUBTITLE || '1', 10),
  FINALIZE: parseInt(process.env.CONCURRENCY_FINALIZE || '1', 10)
} as const);

export const TORRENT_QUEUE = Object.freeze({
  POLL_INTERVAL_MS: 2000,
  POLL_INTERVAL_SEC: 2,
  STALL_SPEED_KB: 100,
  METADATA_GRACE_PERIOD_SEC: 60,
  STALL_CONSECUTIVE_SEC: 30,
  DEAD_PRUNE_SEC: 1200 // 20 minutes of no progress
} as const);

