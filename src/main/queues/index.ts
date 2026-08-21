import { Queue, FlowProducer, type JobNode, type QueueOptions } from 'bullmq';
import { createRedisConnection, redisPublisher } from '../config/redis.js';
import { logger } from '../utils/logger.js';

import {
  QUEUE_PREFIX,
  QUEUE_NAMES,
  EVENTS_CHANNEL,
  JOB_PRIORITIES,
  DEFAULT_JOB_OPTIONS
} from '../config/queue.js';

import type {
  DownloadJobData,
  DownloadJobResult,
  TranscodeJobData,
  TranscodeJobResult,
  SubtitleJobData,
  SubtitleJobResult,
  FinalizeJobData,
  FinalizeJobResult,
  MediaProcessingFlowData,
  ActiveMediaState,
  DownloadStatus
} from '../types/index.js';

export {
  QUEUE_PREFIX,
  QUEUE_NAMES,
  EVENTS_CHANNEL,
  JOB_PRIORITIES,
  DEFAULT_JOB_OPTIONS
};

const defaultQueueOptions: Omit<QueueOptions, 'connection'> = {
  prefix: QUEUE_PREFIX,
  defaultJobOptions: DEFAULT_JOB_OPTIONS
};

/**
 * BullMQ Queues initialized with dedicated Redis connection instances.
 * Names are namespaced under 'orion:' using BullMQ prefix (e.g. orion:download, orion:transcode, orion:subtitle, orion:finalize).
 */
export const downloadQueue = new Queue<DownloadJobData, DownloadJobResult, string>(
  QUEUE_NAMES.DOWNLOAD,
  {
    ...defaultQueueOptions,
    connection: createRedisConnection({ connectionName: 'queue:download' })
  }
);

export const transcodeQueue = new Queue<TranscodeJobData, TranscodeJobResult, string>(
  QUEUE_NAMES.TRANSCODE,
  {
    ...defaultQueueOptions,
    connection: createRedisConnection({ connectionName: 'queue:transcode' })
  }
);

export const transcodeFastQueue = new Queue<TranscodeJobData, TranscodeJobResult, string>(
  QUEUE_NAMES.TRANSCODE_FAST,
  {
    ...defaultQueueOptions,
    connection: createRedisConnection({ connectionName: 'queue:transcode:fast' })
  }
);

export const transcodeHeavyQueue = new Queue<TranscodeJobData, TranscodeJobResult, string>(
  QUEUE_NAMES.TRANSCODE_HEAVY,
  {
    ...defaultQueueOptions,
    connection: createRedisConnection({ connectionName: 'queue:transcode:heavy' })
  }
);

export const subtitleQueue = new Queue<SubtitleJobData, SubtitleJobResult, string>(
  QUEUE_NAMES.SUBTITLE,
  {
    ...defaultQueueOptions,
    connection: createRedisConnection({ connectionName: 'queue:subtitle' })
  }
);

export const finalizeQueue = new Queue<FinalizeJobData, FinalizeJobResult, string>(
  QUEUE_NAMES.FINALIZE,
  {
    ...defaultQueueOptions,
    connection: createRedisConnection({ connectionName: 'queue:finalize' })
  }
);

/**
 * BullMQ FlowProducer instance for managing DAG workflows.
 */
export const flowProducer = new FlowProducer({
  prefix: QUEUE_PREFIX,
  connection: createRedisConnection({ connectionName: 'queue:flow' })
});

// Queue-level error logging (kept at debug level to avoid duplicating connection-level logs)
downloadQueue.on('error', (err: Error) => logger.debug(`BullMQ Download Queue error: ${err.message}`));
transcodeQueue.on('error', (err: Error) => logger.debug(`BullMQ Transcode Queue error: ${err.message}`));
transcodeFastQueue.on('error', (err: Error) => logger.debug(`BullMQ Transcode Fast Queue error: ${err.message}`));
transcodeHeavyQueue.on('error', (err: Error) => logger.debug(`BullMQ Transcode Heavy Queue error: ${err.message}`));
subtitleQueue.on('error', (err: Error) => logger.debug(`BullMQ Subtitle Queue error: ${err.message}`));
finalizeQueue.on('error', (err: Error) => logger.debug(`BullMQ Finalize Queue error: ${err.message}`));

/**
 * Enqueues a media processing DAG flow using BullMQ FlowProducer.
 * The parent job (finalize-media) executes only after both child jobs
 * (transcode-media and subtitle-media) complete successfully in parallel.
 *
 * Automatically routes 8-bit H.264 streams to the Fast Lane (stream-copy)
 * and HEVC/AV1/other streams to the Slow Lane (re-encode).
 *
 * @param flowData Media metadata and paths payload
 * @returns Added Flow tree
 */
export async function enqueueMediaProcessingFlow(flowData: MediaProcessingFlowData): Promise<JobNode> {
  const {
    fileId,
    sourcePath,
    rawTempDir,
    hash,
    fileHash,
    fileSize,
    type,
    fileIdx,
    targetFileName,
    quality,
    sizeBytes,
    codec
  } = flowData;

  const isFastTranscode = codec === 'h264';
  const targetTranscodeQueue = isFastTranscode ? QUEUE_NAMES.TRANSCODE_FAST : QUEUE_NAMES.TRANSCODE_HEAVY;

  logger.info(`Assigning transcode for ${fileId} (codec: ${codec || 'unknown'}) to lane "${targetTranscodeQueue}"`);

  const flow = await flowProducer.add({
    name: 'finalize-media',
    queueName: QUEUE_NAMES.FINALIZE,
    data: {
      fileId,
      sourcePath,
      rawTempDir,
      hash,
      fileHash,
      fileIdx,
      targetFileName,
      quality: quality || '',
      sizeBytes: sizeBytes || 0
    } satisfies FinalizeJobData,
    opts: {
      ...DEFAULT_JOB_OPTIONS
    },
    children: [
      {
        name: 'transcode-media',
        queueName: targetTranscodeQueue,
        data: {
          fileId,
          sourcePath,
          codec
        } satisfies TranscodeJobData,
        opts: {
          ...DEFAULT_JOB_OPTIONS,
          failParentOnFailure: true
        }
      },
      {
        name: 'subtitle-media',
        queueName: QUEUE_NAMES.SUBTITLE,
        data: {
          fileId,
          sourcePath,
          fileHash,
          fileSize,
          targetFileName
        } satisfies SubtitleJobData,
        opts: {
          ...DEFAULT_JOB_OPTIONS,
          failParentOnFailure: true
        }
      }
    ]
  });

  logger.info(`Enqueued media processing DAG flow for ${fileId} (Job ID: ${flow?.job?.id})`);
  return flow;
}

const ACTIVE_MEDIA_PREFIX = `${QUEUE_PREFIX}:active_media:`;
const ACTIVE_MEDIA_TTL_SEC = 7200; // 2 hours safety expiration

/**
 * Sets the active in-flight media state in Redis.
 *
 * @param fileId
 * @param status
 * @param progress
 */
export async function setActiveMediaState(
  fileId: string,
  status: DownloadStatus | string,
  progress: string | number = '0.00'
): Promise<void> {
  try {
    const key = `${ACTIVE_MEDIA_PREFIX}${fileId}`;
    const payload = JSON.stringify({
      fileId,
      status,
      progress: String(progress),
      updatedAt: Date.now()
    });
    await redisPublisher.set(key, payload, 'EX', ACTIVE_MEDIA_TTL_SEC);
  } catch (err) {
    logger.error(`Failed to set active media state for ${fileId}:`, err);
  }
}

/**
 * Retrieves the active in-flight media state from Redis.
 *
 * @param fileId
 * @returns Active media state or null
 */
export async function getActiveMediaState(fileId: string): Promise<ActiveMediaState | null> {
  try {
    const key = `${ACTIVE_MEDIA_PREFIX}${fileId}`;
    const data = await redisPublisher.get(key);
    if (!data) return null;
    return JSON.parse(data) as ActiveMediaState;
  } catch (err) {
    logger.error(`Failed to get active media state for ${fileId}:`, err);
    return null;
  }
}

/**
 * Retrieves all active in-flight media records from Redis.
 *
 * @returns Dictionary of all active media states
 */
export async function getAllActiveMedia(): Promise<Record<string, ActiveMediaState>> {
  try {
    const keys = await redisPublisher.keys(`${ACTIVE_MEDIA_PREFIX}*`);
    if (!keys || keys.length === 0) return {};
    const values = await redisPublisher.mget(keys);
    const result: Record<string, ActiveMediaState> = {};
    values.forEach((v: string | null) => {
      if (v) {
        try {
          const parsed = JSON.parse(v) as ActiveMediaState;
          if (parsed && (parsed.fileId || parsed.id)) {
            const id = parsed.fileId || parsed.id || '';
            result[id] = parsed;
          }
        } catch (_) {}
      }
    });
    return result;
  } catch (err) {
    logger.error('Failed to get all active media from Redis:', err);
    return {};
  }
}

/**
 * Deletes the active in-flight media state from Redis.
 *
 * @param fileId
 */
export async function deleteActiveMediaState(fileId: string): Promise<void> {
  try {
    const key = `${ACTIVE_MEDIA_PREFIX}${fileId}`;
    await redisPublisher.del(key);
  } catch (err) {
    logger.error(`Failed to delete active media state for ${fileId}:`, err);
  }
}

/**
 * Publishes an event payload to the Redis pub/sub events channel.
 *
 * @param channel Logical event channel/name (e.g., 'download-status')
 * @param data Event payload data
 * @returns Number of clients that received the message
 */
export async function publishEvent<T = unknown>(channel: string, data: T): Promise<number> {
  try {
    const payload = JSON.stringify({
      channel,
      data,
      timestamp: new Date().toISOString()
    });
    const subscriberCount = await redisPublisher.publish(EVENTS_CHANNEL, payload);
    return subscriberCount;
  } catch (error) {
    logger.error(`Failed to publish event to ${EVENTS_CHANNEL} [channel: ${channel}]:`, error);
    return 0;
  }
}

/**
 * Helper to publish a download status progress update over Redis Pub/Sub,
 * automatically keeping the Redis active_media key synchronized.
 *
 * @param id Unique media or file identifier
 * @param status Status string (from DownloadStatus)
 * @param progress Progress percentage string or number
 * @returns Number of subscribers notified
 */
export async function publishDownloadStatus(
  id: string,
  status: DownloadStatus | string,
  progress: string | number = '0.00'
): Promise<number> {
  if (
    status === 'completed' ||
    status === 'failed' ||
    status === 'removed'
  ) {
    await deleteActiveMediaState(id);
  } else {
    await setActiveMediaState(id, status, progress);
  }

  return publishEvent('download-status', {
    id,
    status,
    progress: String(progress)
  });
}

export default {
  downloadQueue,
  transcodeQueue,
  transcodeFastQueue,
  transcodeHeavyQueue,
  subtitleQueue,
  finalizeQueue,
  flowProducer,
  enqueueMediaProcessingFlow,
  setActiveMediaState,
  getActiveMediaState,
  getAllActiveMedia,
  deleteActiveMediaState,
  publishEvent,
  publishDownloadStatus,
  EVENTS_CHANNEL,
  QUEUE_NAMES,
  QUEUE_PREFIX
};
