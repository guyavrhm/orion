/**
 * Queue, worker, and job lifecycle configuration.
 */

export const QUEUE_PREFIX = process.env.QUEUE_PREFIX ?? 'orion';

export const QUEUE_NAMES = Object.freeze({
  DOWNLOAD: 'download',
  TRANSCODE_FAST: 'transcode-fast',
  TRANSCODE_HEAVY: 'transcode-heavy',
  SUBTITLE: 'subtitle',
  FINALIZE: 'finalize'
} as const);

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

export const EVENTS_CHANNEL = `${QUEUE_PREFIX}:events`;

export const DEFAULT_JOB_OPTIONS = Object.freeze({
  removeOnComplete: true,
  removeOnFail: true,
  attempts: 1
} as const);

const defaultTranscode = parseInt(process.env.CONCURRENCY_TRANSCODE ?? '1', 10) || 1;

export const WORKER_CONCURRENCY = Object.freeze({
  DOWNLOAD: parseInt(process.env.CONCURRENCY_DOWNLOAD ?? '3', 10) || 3,
  TRANSCODE_FAST: parseInt(process.env.CONCURRENCY_TRANSCODE_FAST ?? '1', 10) || 1,
  TRANSCODE_HEAVY: parseInt(process.env.CONCURRENCY_TRANSCODE_HEAVY ?? String(defaultTranscode), 10) || defaultTranscode,
  SUBTITLE: parseInt(process.env.CONCURRENCY_SUBTITLE ?? '1', 10) || 1,
  FINALIZE: parseInt(process.env.CONCURRENCY_FINALIZE ?? '1', 10) || 1
} as const);

export const DOWNLOAD_PRIORITIES = Object.freeze({
  HIGH: 1,    // stream failover
  NORMAL: 2,  // fresh user-initiated downloads
  LOW: 3      // stalled downloads yielding to queue
} as const);

export const DOWNLOAD_WATCHDOG = Object.freeze({
  POLL_INTERVAL_MS: 2000,
  POLL_INTERVAL_SEC: 2,
  STALL_SPEED_KB: 100,
  METADATA_GRACE_PERIOD_SEC: 60,
  STALL_CONSECUTIVE_SEC: 30,
  DEAD_PRUNE_SEC: 1200 // 20 minutes of no progress
} as const);

