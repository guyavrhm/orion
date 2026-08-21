import type { Worker } from 'bullmq';
import { createDownloadWorker } from './downloadWorker.js';
import {
  createTranscodeWorker,
  createFastTranscodeWorker,
  createHeavyTranscodeWorker
} from './transcodeWorker.js';
import { createSubtitleWorker } from './subtitleWorker.js';
import { createFinalizeWorker } from './finalizeWorker.js';
import { WORKER_CONCURRENCY, QUEUE_NAMES } from '../config/queue.js';
import { logger as baseLogger } from '../utils/logger.js';
import { setupProcessSafety } from '../utils/process.js';

setupProcessSafety();

const logger = baseLogger.child('workers');

export const activeWorkers: Worker[] = [];

/**
 * Parses CLI arguments to determine which workers to start.
 *
 * Supported formats:
 *   node src/main/workers/index.js --worker=download
 *   node src/main/workers/index.js --worker=transcode,subtitle,finalize
 *   node src/main/workers/index.js -w download
 *   node src/main/workers/index.js download transcode finalize
 *   node src/main/workers/index.js (starts all workers)
 *
 * @param argv Process arguments
 * @returns Set of worker names to run
 */
export function parseWorkerArgs(argv: string[] = process.argv.slice(2)): Set<string> {
  const selected = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--worker=')) {
      const val = arg.split('=')[1];
      val.split(',').forEach((w) => selected.add(w.trim().toLowerCase()));
    } else if (arg === '--worker' || arg === '-w') {
      if (i + 1 < argv.length) {
        argv[i + 1].split(',').forEach((w) => selected.add(w.trim().toLowerCase()));
        i++;
      }
    } else if (['download', 'transcode', 'subtitle', 'finalize', 'all'].includes(arg.toLowerCase())) {
      selected.add(arg.toLowerCase());
    }
  }

  if (selected.size === 0 || selected.has('all')) {
    return new Set(['download', 'transcode', 'subtitle', 'finalize']);
  }

  return selected;
}

/**
 * Starts the requested workers.
 *
 * @param workersToStart Set or array of worker names to start
 * @returns Array of active BullMQ Worker instances
 */
export async function startWorkers(
  workersToStart: Set<string> | string[] = parseWorkerArgs()
): Promise<Worker[]> {
  const targetSet = workersToStart instanceof Set ? workersToStart : new Set(workersToStart);

  logger.info(`Initializing workers: [${Array.from(targetSet).join(', ')}]`);

  if (targetSet.has('download')) {
    logger.info(`Spawning Download Worker (concurrency: ${WORKER_CONCURRENCY.DOWNLOAD})...`);
    const downloadWorker = createDownloadWorker();
    activeWorkers.push(downloadWorker);
  }

  if (targetSet.has('transcode') || targetSet.has('transcode:fast') || targetSet.has('transcode-fast')) {
    logger.info(`Spawning Fast Transcode Worker [${QUEUE_NAMES.TRANSCODE_FAST}] (concurrency: ${WORKER_CONCURRENCY.TRANSCODE_FAST})...`);
    const fastWorker = createFastTranscodeWorker();
    activeWorkers.push(fastWorker);
  }

  if (targetSet.has('transcode') || targetSet.has('transcode:heavy') || targetSet.has('transcode-heavy')) {
    logger.info(`Spawning Heavy Transcode Worker [${QUEUE_NAMES.TRANSCODE_HEAVY}] (concurrency: ${WORKER_CONCURRENCY.TRANSCODE_HEAVY})...`);
    const heavyWorker = createHeavyTranscodeWorker();
    activeWorkers.push(heavyWorker);
  }

  if (targetSet.has('transcode:legacy') || targetSet.has('transcode')) {
    const legacyWorker = createTranscodeWorker(QUEUE_NAMES.TRANSCODE, WORKER_CONCURRENCY.TRANSCODE);
    activeWorkers.push(legacyWorker);
  }

  if (targetSet.has('subtitle')) {
    logger.info(`Spawning Subtitle Worker (concurrency: ${WORKER_CONCURRENCY.SUBTITLE})...`);
    const subtitleWorker = createSubtitleWorker();
    activeWorkers.push(subtitleWorker);
  }

  if (targetSet.has('finalize')) {
    logger.info(`Spawning Finalize Worker (concurrency: ${WORKER_CONCURRENCY.FINALIZE})...`);
    const finalizeWorker = createFinalizeWorker();
    activeWorkers.push(finalizeWorker);
  }

  logger.info(`Successfully started ${activeWorkers.length} worker process(es).`);
  return activeWorkers;
}

/**
 * Starts all workers in the background fleet.
 *
 * @returns Array of active BullMQ Worker instances
 */
export async function startAllWorkers(): Promise<Worker[]> {
  return startWorkers(new Set(['download', 'transcode', 'subtitle', 'finalize']));
}

/**
 * Gracefully shuts down all active workers.
 */
export async function stopWorkers(): Promise<void> {
  if (activeWorkers.length === 0) return;

  logger.info(`Gracefully shutting down ${activeWorkers.length} active worker(s)...`);
  await Promise.allSettled(activeWorkers.map((worker) => worker.close()));
  activeWorkers.length = 0;
  logger.info('All workers shut down cleanly.');
}

// Attach graceful shutdown hooks
let isShuttingDown = false;
async function handleSignal(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}. Commencing graceful shutdown...`);
  try {
    await stopWorkers();
    process.exit(0);
  } catch (err) {
    logger.error('Error during worker shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

// Auto-run if executed directly via Node CLI or tsx
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''))) {
  startWorkers().catch((err: Error) => {
    logger.error('Fatal error starting workers:', err);
    process.exit(1);
  });
}

export {
  createDownloadWorker,
  createTranscodeWorker,
  createFastTranscodeWorker,
  createHeavyTranscodeWorker,
  createSubtitleWorker,
  createFinalizeWorker
};

export default {
  startWorkers,
  startAllWorkers,
  stopWorkers,
  parseWorkerArgs,
  activeWorkers,
  createDownloadWorker,
  createTranscodeWorker,
  createFastTranscodeWorker,
  createHeavyTranscodeWorker,
  createSubtitleWorker,
  createFinalizeWorker
};
