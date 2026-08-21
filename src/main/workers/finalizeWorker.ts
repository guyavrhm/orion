import { Worker, type Job, type WorkerOptions } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { createRedisConnection } from '../config/redis.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  publishDownloadStatus
} from '../queues/index.js';
import { WORKER_CONCURRENCY } from '../config/queue.js';
import { downloadsRepo } from '../db/downloads.js';
import { getMediaDirs, getDirSize } from '../utils/helpers.js';
import { logger as baseLogger } from '../utils/logger.js';
import {
  DOWNLOAD_STATUS,
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
    sourcePath,
    rawTempDir,
    hash,
    fileHash,
    fileIdx,
    targetFileName,
    quality
  } = job.data;

  logger.info(`Starting finalization job for fileId: ${fileId} (Job ID: ${job.id})`);

  const dirs = getMediaDirs(fileId);
  if (!dirs) {
    throw new Error(`Could not resolve media directories for ${fileId}`);
  }

  // 1. Verify that master HLS playlist was generated successfully
  const masterPlaylistPath = path.join(dirs.hlsDir, 'index.m3u8');
  if (!fs.existsSync(masterPlaylistPath)) {
    logger.error(`Cannot finalize ${fileId}: master HLS playlist ${masterPlaylistPath} does not exist.`);
    await publishDownloadStatus(fileId, DOWNLOAD_STATUS.FAILED);
    throw new Error(`Master HLS playlist ${masterPlaylistPath} does not exist`);
  }

  // 2. Calculate final HLS directory size on disk
  const finalSizeBytes = getDirSize(dirs.baseDir);

  // 3. Register media in DownloadRegistry (SQLite database)
  downloadsRepo.addDownloadEntry(fileId, {
    fileName: targetFileName || (sourcePath ? path.basename(sourcePath) : fileId),
    torrentHash: hash,
    fileHash: fileHash || null,
    fileIdx: fileIdx !== undefined && fileIdx !== null ? fileIdx : null,
    quality: quality || '1080p',
    sizeBytes: finalSizeBytes
  });
  logger.info(`Registered completed media in database: ${fileId} (${finalSizeBytes} bytes)`);

  // 4. Delete specific raw temporary source file and its speech reference (.npz)
  // (Do NOT delete rawTempDir if other episodes from the same batch are still downloading/processing)
  if (sourcePath && fs.existsSync(sourcePath)) {
    try {
      fs.rmSync(sourcePath, { force: true });
      logger.info(`Cleaned up raw temporary source file at: ${sourcePath} for ${fileId}`);
      
      const npzPath = sourcePath.replace(/\.[^/.]+$/, '.npz');
      if (fs.existsSync(npzPath)) {
        fs.rmSync(npzPath, { force: true });
      }
    } catch (cleanupErr) {
      const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      logger.warn(`Failed to clean up sourcePath ${sourcePath}: ${msg}`);
    }
  }

  // Only remove rawTempDir if it exists and is completely empty
  if (rawTempDir && fs.existsSync(rawTempDir)) {
    try {
      const remainingFiles = fs.readdirSync(rawTempDir);
      if (remainingFiles.length === 0) {
        fs.rmdirSync(rawTempDir);
        logger.info(`Removed empty temporary directory: ${rawTempDir}`);
      }
    } catch (_) {}
  }

  // 5. Broadcast completed status over Redis Pub/Sub
  await publishDownloadStatus(fileId, DOWNLOAD_STATUS.COMPLETED);
  logger.info(`Finalization complete & media registered as COMPLETED: ${fileId} (${finalSizeBytes} bytes)`);

  return {
    fileId,
    status: 'completed',
    hlsDir: dirs.hlsDir,
    sizeBytes: finalSizeBytes
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
