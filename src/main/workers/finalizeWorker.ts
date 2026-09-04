import { Worker, type Job, type WorkerOptions } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { createRedisConnection } from '../config/redis.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  publishMediaRequestStatus
} from '../queues/index.js';
import { WORKER_CONCURRENCY } from '../config/queue.js';
import { streamsRepo } from '../db/streams.js';
import { getMediaDirs, getDirSize, cleanupJobTempDir } from '../utils/helpers.js';
import { logger as baseLogger } from '../utils/logger.js';
import {
  MEDIA_REQUEST_STATUS,
  type FinalizeJobData,
  type FinalizeJobResult
} from '../types/index.js';

const logger = baseLogger.child('finalizeWorker');

/**
 * Processes a finalize media job in the BullMQ Flow DAG.
 * Executed only after child jobs (transcode and subtitle) succeed.
 *
 * @param job BullMQ Job instance
 * @returns Finalization result
 */
export async function processFinalizeJob(
  job: Job<FinalizeJobData, FinalizeJobResult, string>
): Promise<FinalizeJobResult> {
  const {
    fileId,
    rawTempDir,
    quality
  } = job.data;

  logger.info(`Starting finalization job for fileId: ${fileId} (Job ID: ${job.id})`);

  const dirs = getMediaDirs(fileId);
  if (!dirs) {
    throw new Error(`Could not resolve media directories for ${fileId}`);
  }

  // 1. Inspect child job outcomes from BullMQ Flow
  const children = await job.getChildrenValues<{ fileId?: string }>();
  const keys = Object.keys(children ?? {});

  const transcodeOk = keys.some(
    (k) => k.includes(QUEUE_NAMES.TRANSCODE_FAST) || k.includes(QUEUE_NAMES.TRANSCODE_HEAVY)
  );

  if (!transcodeOk) {
    logger.error(`Cannot finalize ${fileId}: transcoding failed.`);
    await publishMediaRequestStatus(fileId, MEDIA_REQUEST_STATUS.FAILED);

    // Clean up all partial media assets across HLS, subtitles, and isolated raw temp directory
    try {
      if (fs.existsSync(dirs.baseDir)) {
        fs.rmSync(dirs.baseDir, { recursive: true, force: true });
        logger.info(`Purged partial media directory on finalization failure: ${dirs.baseDir}`);
      }
      cleanupJobTempDir(rawTempDir);
      logger.info(`Purged raw temp directory on finalization failure for ${fileId}: ${rawTempDir}`);
    } catch (cleanupErr) {
      logger.warn(`Failed to clean up directories on finalization failure for ${fileId}:`, cleanupErr);
    }

    throw new Error(`Transcode job failed for ${fileId}`);
  }

  // 2. Calculate final media directory size on disk
  const finalSizeBytes = getDirSize(dirs.baseDir);

  // 3. Register media stream in SQLite database
  streamsRepo.registerStream(fileId, {
    quality: quality ?? 'unknown',
    size_bytes: finalSizeBytes,
    ready_at: Date.now()
  });
  logger.info(`Registered completed stream in database: ${fileId} (${finalSizeBytes} bytes)`);

  // 4. Safely clean up isolated job temp directory
  cleanupJobTempDir(rawTempDir);

  // 5. Broadcast completed status over Redis Pub/Sub
  await publishMediaRequestStatus(fileId, MEDIA_REQUEST_STATUS.READY);
  logger.info(`Finalization complete & media registered as READY: ${fileId} (${finalSizeBytes} bytes)`);

  return {
    fileId,
    hlsDir: dirs.hlsDir,
    size_bytes: finalSizeBytes
  };
}

/**
 * Creates and initializes the BullMQ Finalize Worker.
 *
 * @param customOptions Additional BullMQ worker options
 * @returns Worker instance
 */
export function createFinalizeWorker(
  customOptions: Partial<WorkerOptions> = {}
): Worker<FinalizeJobData, FinalizeJobResult> {
  const connection = createRedisConnection({ connectionName: 'worker:finalize' });

  const worker = new Worker<FinalizeJobData, FinalizeJobResult>(
    QUEUE_NAMES.FINALIZE,
    async (job: Job<FinalizeJobData, FinalizeJobResult, string>) => {
      return processFinalizeJob(job);
    },
    {
      prefix: QUEUE_PREFIX,
      connection,
      concurrency: WORKER_CONCURRENCY.FINALIZE,
      ...customOptions
    }
  );

  worker.on('active', (job) => {
    logger.info(`Job ${job.id} active (fileId: ${job.data.fileId})`);
  });

  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed (fileId: ${job.data.fileId})`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed (fileId: ${job?.data?.fileId}):`, err);
  });

  worker.on('error', (err) => {
    logger.error('BullMQ Worker error:', err);
  });

  return worker;
}

export default createFinalizeWorker;
