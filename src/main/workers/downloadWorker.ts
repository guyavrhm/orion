import { Worker, type Job, type WorkerOptions } from 'bullmq';
import WebTorrent, { type Instance as WebTorrentInstance, type Torrent, type TorrentFile } from 'webtorrent';
import path from 'node:path';
import fs from 'node:fs';
import { createRedisConnection } from '../config/redis.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  downloadQueue,
  enqueueMediaProcessingFlow,
  publishDownloadStatus
} from '../queues/index.js';
import { WORKER_CONCURRENCY, TORRENT_QUEUE } from '../config/queue.js';
import { eviction } from '../utils/eviction.js';
import { calculateOSHash } from '../utils/hash.js';
import { getMediaDirs } from '../utils/helpers.js';
import { logger as baseLogger } from '../utils/logger.js';
import { MOVIES_TEMP, SHOWS_TEMP } from '../utils/paths.js';
import {
  DOWNLOAD_STATUS,
  type DownloadJobData,
  type DownloadJobResult,
  type DownloadJobProgress,
  type ParsedTorrentCandidate,
  type MediaProcessingFlowData
} from '../types/index.js';

const logger = baseLogger.child('downloadWorker');

export interface CandidateTestResult {
  candidate: ParsedTorrentCandidate;
  peakSpeedKB: number;
  isHealthy: boolean;
  client: WebTorrentInstance | null;
  torrent: Torrent | null;
}

/**
 * Checks if a selected file is fully downloaded.
 * @param file WebTorrent file instance
 * @returns boolean
 */
export function isFileCompleted(file: TorrentFile | null | undefined): boolean {
  if (!file || file.length <= 0) return false;
  return file.downloaded === file.length;
}

/**
 * Selects either the specified index or the largest file in the torrent as the main media file.
 * @param torrent WebTorrent torrent instance
 * @param fileIdx Index of the target file
 * @returns TorrentFile or null
 */
export function findMainFile(torrent: Torrent, fileIdx?: number | null): TorrentFile | null {
  if (!torrent.files || torrent.files.length === 0) return null;
  if (fileIdx !== undefined && fileIdx !== null && fileIdx >= 0 && fileIdx < torrent.files.length) {
    return torrent.files[fileIdx];
  }
  let largestFile = torrent.files[0];
  torrent.files.forEach((f) => {
    if (f.length > largestFile.length) largestFile = f;
  });
  return largestFile;
}

/**
 * Destroys a torrent instance and optionally removes raw temp files.
 * @param torrent WebTorrent torrent instance
 * @param deleteFiles Whether to remove temporary files on disk
 */
export function cleanTorrentDir(torrent: Torrent | null | undefined, deleteFiles = true): void {
  if (!torrent) return;
  try {
    const torrentName = torrent.name || '';
    const torrentPath = torrentName && torrent.path ? path.join(torrent.path, torrentName) : null;
    torrent.removeAllListeners();
    torrent.destroy();
    if (deleteFiles && torrentPath && fs.existsSync(torrentPath)) {
      fs.rmSync(torrentPath, { recursive: true, force: true });
      logger.info(`Removed torrent raw temporary folders at: ${torrentPath}`);
    }
  } catch (e) {
    logger.error(`Failed to clean temporary raw torrent folder: ${torrent ? torrent.name : ''}`, e);
  }
}

/**
 * Probes a single candidate for up to 15 seconds of active downloading.
 * If speed >= STALL_SPEED_KB (100 KB/s), locks in immediately and returns the active client/torrent.
 * Otherwise, records peak speed and cleans up.
 *
 * @param candidate Candidate descriptor
 * @param targetDir Destination folder
 * @returns Candidate test result
 */
export function testCandidateStream(
  candidate: ParsedTorrentCandidate,
  targetDir: string
): Promise<CandidateTestResult> {
  return new Promise((resolve) => {
    let client: WebTorrentInstance | null = null;
    let torrent: Torrent | null = null;
    let poll: NodeJS.Timeout | null = null;
    let activeDownloadSec = 0;
    let totalSec = 0;
    let peakSpeedKB = 0;
    let resolved = false;

    const finish = (isHealthy: boolean): void => {
      if (resolved) return;
      resolved = true;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      resolve({
        candidate,
        peakSpeedKB,
        isHealthy,
        client,
        torrent
      });
    };

    try {
      client = new WebTorrent({ utp: false });
      client.on('error', (err: Error | string) => {
        const msg = typeof err === 'string' ? err : err.message;
        logger.warn(`Candidate test client error for ${candidate.hash}: ${msg}`);
        finish(false);
      });

      torrent = client.add(candidate.magnetUrl, { path: targetDir });

      torrent.on('error', (err: Error | string) => {
        const msg = typeof err === 'string' ? err : err.message;
        logger.warn(`Candidate test torrent error for ${candidate.hash}: ${msg}`);
        finish(false);
      });

      torrent.on('ready', () => {
        if (!torrent) return;
        const file = findMainFile(torrent, candidate.fileIdx);
        if (file) {
          torrent.files.forEach((f) => f.deselect());
          file.select();
        }
      });

      poll = setInterval(() => {
        totalSec += 1;
        if (torrent && torrent.ready) {
          activeDownloadSec += 1;
          const currentSpeedKB = torrent.downloadSpeed / 1024;
          if (currentSpeedKB > peakSpeedKB) {
            peakSpeedKB = currentSpeedKB;
          }

          // Instant lock-in if candidate achieves >= 100 KB/s
          if (currentSpeedKB >= TORRENT_QUEUE.STALL_SPEED_KB) {
            logger.info(`Candidate ${candidate.hash} achieved healthy speed ${currentSpeedKB.toFixed(1)} KB/s in ${activeDownloadSec}s! Locking in.`);
            finish(true);
            return;
          }

          // 15 seconds of active downloading completed without hitting 100 KB/s
          if (activeDownloadSec >= 15) {
            logger.info(`Candidate ${candidate.hash} test finished: peak=${peakSpeedKB.toFixed(1)} KB/s after 15s active.`);
            finish(false);
            return;
          }
        } else {
          // Timeout if torrent metadata never resolves within 25s
          if (totalSec >= 25) {
            logger.info(`Candidate ${candidate.hash} metadata resolution timed out.`);
            finish(false);
            return;
          }
        }
      }, 1000);
    } catch (err) {
      logger.warn(`Failed testing candidate ${candidate.hash}:`, err);
      finish(false);
    }
  });
}

/**
 * Processes a single torrent download job with multi-candidate tournament discovery and failover.
 *
 * @param job BullMQ Job instance
 * @returns Download result
 */
export async function processDownloadJob(
  job: Job<DownloadJobData, DownloadJobResult, string>
): Promise<DownloadJobResult> {
  const { fileId, type, quality } = job.data;
  logger.info(`Starting download job for fileId: ${fileId} (Job ID: ${job.id})`);

  // 1. Check if media is already downloaded
  const dirs = getMediaDirs(fileId);
  const hlsPlaylist = dirs ? path.join(dirs.hlsDir, 'index.m3u8') : '';
  if (hlsPlaylist && fs.existsSync(hlsPlaylist)) {
    logger.info(`Item already downloaded. Skipping: ${fileId}`);
    await publishDownloadStatus(fileId, DOWNLOAD_STATUS.COMPLETED);
    return { fileId, status: 'already_downloaded' };
  }

  // 2. Prepare candidate streams list
  const candidates: ParsedTorrentCandidate[] = Array.isArray(job.data.candidates) && job.data.candidates.length > 0
    ? [...job.data.candidates]
    : [
        {
          hash: job.data.hash || '',
          magnetUrl: job.data.magnetUrl || '',
          fileIdx: job.data.fileIdx,
          quality: job.data.quality || '1080p',
          sizeBytes: job.data.sizeBytes || 0,
          title: job.data.fileId
        }
      ];

  const failedCandidates = new Set<string>(job.data?.failedCandidates || []);
  const availableCandidates = candidates.filter((c) => !failedCandidates.has(c.hash));

  if (availableCandidates.length === 0) {
    logger.error(`All candidate torrent streams for ${fileId} have failed/pruned.`);
    await publishDownloadStatus(fileId, DOWNLOAD_STATUS.FAILED);
    throw new Error('All candidate torrent streams failed');
  }

  const targetDir = type === 'movie' ? MOVIES_TEMP : SHOWS_TEMP;

  // 3. Check storage cache limit with EvictionService before downloading
  const torrentSizeBytes = availableCandidates[0].sizeBytes || job.data.sizeBytes || 0;
  try {
    eviction.ensureFreeSpace(torrentSizeBytes);
  } catch (err) {
    logger.error(`Failed running eviction check for ${fileId}`, err);
  }

  // 4. Mark download as active
  await publishDownloadStatus(fileId, DOWNLOAD_STATUS.DOWNLOADING, '0.00');

  // 5. PHASE 1: Tournament Discovery or Resumed Locked Candidate
  let lockedCandidate: ParsedTorrentCandidate | null = null;
  let activeClient: WebTorrentInstance | null = null;
  let activeTorrent: Torrent | null = null;

  if (job.data?.lockedCandidateHash) {
    lockedCandidate = availableCandidates.find((c) => c.hash === job.data.lockedCandidateHash) || availableCandidates[0];
    logger.info(`Resuming download on previously locked candidate: ${lockedCandidate.hash} (${lockedCandidate.quality})`);
  } else {
    logger.info(`Initiating 15-second tournament test across ${availableCandidates.length} candidates for ${fileId}...`);

    for (const candidate of availableCandidates) {
      logger.info(`Testing candidate stream: ${candidate.hash} (${candidate.quality || ''})...`);
      const result = await testCandidateStream(candidate, targetDir);
      candidate.peakSpeedKB = result.peakSpeedKB;

      if (result.isHealthy) {
        lockedCandidate = candidate;
        activeClient = result.client;
        activeTorrent = result.torrent;
        logger.info(`Candidate ${candidate.hash} won tournament with immediate lock-in`);
        break;
      } else {
        // Clean up unselected candidate test client and files
        if (result.client) {
          cleanTorrentDir(result.torrent, true);
          try {
            result.client.destroy();
          } catch (_) {}
        }
      }
    }

    if (!lockedCandidate) {
      // Sort candidates by measured peak speed descending
      availableCandidates.sort((a, b) => (b.peakSpeedKB || 0) - (a.peakSpeedKB || 0));
      lockedCandidate = availableCandidates[0];
      logger.info(`Tournament completed. Selected fastest candidate: ${lockedCandidate.hash} (peak: ${(lockedCandidate.peakSpeedKB || 0).toFixed(1)} KB/s)`);
    }
  }

  // 6. PHASE 2: Steady State Download Loop (with 20-minute Progress Watchdog & Dead Swarm Failover)
  return new Promise<DownloadJobResult>((resolve, reject) => {
    const candidateToDownload = lockedCandidate!;
    const client: WebTorrentInstance = activeClient || new WebTorrent({ utp: false });
    const torrent: Torrent = activeTorrent || client.add(candidateToDownload.magnetUrl, { path: targetDir });
    let pollInterval: NodeJS.Timeout | null = null;
    let doneFired = false;
    let fileSelected = false;
    let selectedFile: TorrentFile | null = null;
    let lastBroadcastedProgress: string | null = null;
    let deadDuration = Number(job.data?.accumulatedDeadDuration) || 0;
    let lastDownloadedBytes: number | null = null;
    let stalledDuration = 0;
    let activeDuration = 0;
    let loggedStalled = false;
    let wasStalled = Boolean(job.data?.wasStalled);

    const cleanupClient = (deleteFiles = false): void => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (torrent) {
        cleanTorrentDir(torrent, deleteFiles);
      }
      try {
        client.destroy();
        logger.info(`WebTorrent client destroyed for job ${fileId}`);
      } catch (e) {
        // ignore
      }
    };

    client.on('error', (err: Error | string) => {
      logger.error(`WebTorrent client critical error for ${fileId}:`, err);
    });

    const onReady = (): void => {
      stalledDuration = 0;
      if (!fileSelected) {
        selectedFile = findMainFile(torrent, candidateToDownload.fileIdx);
        if (selectedFile) {
          torrent.files.forEach((f) => f.deselect());
          selectedFile.select();
          fileSelected = true;
          logger.info(`Selected primary media file: ${selectedFile.name} (other sub-files deselected)`);
        }
      }
    };

    if (torrent.ready) {
      onReady();
    } else {
      torrent.on('ready', onReady);
    }

    const handleDone = async (): Promise<void> => {
      if (doneFired) return;
      doneFired = true;

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      logger.info(`WebTorrent completed download: ${fileId} on candidate ${candidateToDownload.hash}`);

      try {
        const targetFile = selectedFile || findMainFile(torrent, candidateToDownload.fileIdx);
        if (!targetFile) {
          throw new Error('No target file found in torrent payload upon completion');
        }

        const actualFileIdx = torrent.files.indexOf(targetFile);
        const sourcePath = path.join(targetDir, targetFile.path);
        const rawTempDir = torrent.name ? path.join(targetDir, torrent.name) : null;

        // Verify destination media base dir
        if (dirs && !fs.existsSync(dirs.baseDir)) {
          fs.mkdirSync(dirs.baseDir, { recursive: true });
        }

        // Calculate OSHash and file size once
        let fileHash: string | null = null;
        let fileSize: number | null = null;
        try {
          const hashRes = await calculateOSHash(sourcePath);
          fileHash = hashRes.hash;
          fileSize = hashRes.size;
          logger.info(`Calculated OSHash: ${fileHash}, size: ${fileSize} for ${sourcePath}`);
        } catch (hashErr) {
          logger.error(`Error calculating OSHash for ${sourcePath}:`, hashErr);
        }

        // Clean up WebTorrent client instance cleanly before handing off to queues
        cleanupClient(false);

        // Enqueue media processing DAG flow (transcode and subtitle parallel children, finalize parent)
        const downstreamJobPayload: MediaProcessingFlowData = {
          fileId,
          sourcePath,
          rawTempDir,
          hash: candidateToDownload.hash,
          fileHash,
          fileSize,
          type,
          fileIdx: actualFileIdx,
          targetFileName: targetFile.name,
          quality: candidateToDownload.quality || quality || '1080p',
          sizeBytes: torrentSizeBytes,
          codec: candidateToDownload.codec
        };

        logger.info(`Enqueueing media processing DAG flow for fileId: ${fileId}`);
        await enqueueMediaProcessingFlow(downstreamJobPayload);

        resolve({
          fileId,
          status: 'completed',
          sourcePath,
          rawTempDir,
          fileHash,
          fileSize
        });
      } catch (completionErr) {
        logger.error(`Post-download completion error for ${fileId}:`, completionErr);
        await publishDownloadStatus(fileId, DOWNLOAD_STATUS.FAILED);
        cleanupClient(true);
        reject(completionErr);
      }
    };

    pollInterval = setInterval(async () => {
      if ((torrent as unknown as { destroyed?: boolean }).destroyed || doneFired) {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return;
      }

      activeDuration += TORRENT_QUEUE.POLL_INTERVAL_SEC;

      // 1. Select main file once metadata is ready
      if (torrent.ready && !fileSelected) {
        selectedFile = findMainFile(torrent, candidateToDownload.fileIdx);
        if (selectedFile) {
          torrent.files.forEach((f) => f.deselect());
          selectedFile.select();
          fileSelected = true;
          logger.info(`Selected main media file: ${selectedFile.name}`);
        }
      }

      // 2. Compute performance metrics
      const speedBytes = torrent.downloadSpeed || 0;
      const speedKB = speedBytes / 1024;
      const numPeers = torrent.numPeers || 0;
      const speedMB = speedKB / 1024;

      let progressVal = '0.00';
      let isDone = false;

      if (torrent.ready) {
        const currentTargetFile = selectedFile || findMainFile(torrent, candidateToDownload.fileIdx);
        if (currentTargetFile) {
          const isCompleted = isFileCompleted(currentTargetFile);
          progressVal = isCompleted
            ? '100.00'
            : ((currentTargetFile.downloaded / currentTargetFile.length) * 100).toFixed(2);
          if (isCompleted) {
            isDone = true;
          }
        } else {
          progressVal = (torrent.progress * 100).toFixed(2);
          if (torrent.progress === 1) {
            isDone = true;
          }
        }
      }

      const speedVal = speedMB.toFixed(2);
      logger.debug(`Download metrics [${fileId} - ${candidateToDownload.hash}]: ${progressVal}%, Speed: ${speedVal} MB/s, Peers: ${numPeers}`);

      // 3. Progress-Based Dead Torrent Check (Pruning: No file progress for 20 minutes)
      let progressMade = false;
      if (torrent.ready) {
        const currentTargetFile = selectedFile || findMainFile(torrent, candidateToDownload.fileIdx);
        const currentDownloaded = currentTargetFile ? currentTargetFile.downloaded : (torrent.downloaded || 0);

        if (lastDownloadedBytes === null) {
          lastDownloadedBytes = currentDownloaded;
        } else if (currentDownloaded > lastDownloadedBytes) {
          progressMade = true;
          lastDownloadedBytes = currentDownloaded;
          deadDuration = 0; // Real video progress made! Reset watchdog timer
        }
      }

      if (!progressMade) {
        deadDuration += TORRENT_QUEUE.POLL_INTERVAL_SEC;
        if (deadDuration >= TORRENT_QUEUE.DEAD_PRUNE_SEC) {
          logger.warn(`Candidate ${candidateToDownload.hash} is DEAD (No progress for ${TORRENT_QUEUE.DEAD_PRUNE_SEC}s). Triggering failover...`);
          failedCandidates.add(candidateToDownload.hash);
          cleanupClient(true);

          const remainingCandidates = candidates.filter((c) => !failedCandidates.has(c.hash));
          if (remainingCandidates.length > 0) {
            remainingCandidates.sort((a, b) => (b.peakSpeedKB || 0) - (a.peakSpeedKB || 0));
            const nextCandidate = remainingCandidates[0];
            logger.info(`Failing over to next fastest candidate: ${nextCandidate.hash}`);
            doneFired = true;

            // Re-enqueue job to pick up next candidate smoothly
            await downloadQueue.add(
              'download',
              {
                ...job.data,
                lockedCandidateHash: nextCandidate.hash,
                failedCandidates: Array.from(failedCandidates),
                accumulatedDeadDuration: 0
              },
              {
                priority: 1
              }
            );
            resolve({ fileId, status: 'failover', nextCandidate: nextCandidate.hash });
            return;
          }

          // Global Prune: All candidate streams failed
          logger.error(`All candidate torrent streams for ${fileId} failed and were pruned.`);
          doneFired = true;
          await publishDownloadStatus(fileId, DOWNLOAD_STATUS.FAILED);
          reject(new Error(`All candidate torrent streams pruned for ${fileId}`));
          return;
        }
      }

      // 4. Stall Detection & Self-healing
      const isStalledSpeed = torrent.ready && speedKB < TORRENT_QUEUE.STALL_SPEED_KB;
      const isStalledMetadata = !torrent.ready && activeDuration >= TORRENT_QUEUE.METADATA_GRACE_PERIOD_SEC;

      if (isStalledSpeed || isStalledMetadata) {
        stalledDuration += TORRENT_QUEUE.POLL_INTERVAL_SEC;
        if (stalledDuration >= TORRENT_QUEUE.STALL_CONSECUTIVE_SEC) {
          wasStalled = true;
          if (!loggedStalled) {
            logger.warn(`Torrent stalled for ${fileId} (${candidateToDownload.hash}): speed=${speedKB.toFixed(1)}KB/s`);
            loggedStalled = true;
          }
        }
      } else if (torrent.ready && speedKB >= TORRENT_QUEUE.STALL_SPEED_KB) {
        stalledDuration = 0;
        wasStalled = false;
        loggedStalled = false;
      }

      // 5. Structured Progress Reporting
      try {
        const progressPayload: DownloadJobProgress = {
          percent: parseFloat(progressVal),
          speedMB: speedVal,
          peers: numPeers,
          wasStalled,
          activeCandidate: candidateToDownload.hash
        };
        await job.updateProgress(progressPayload as unknown as object);
      } catch (_) {}

      // 6. Progress broadcast throttling via Redis Pub/Sub
      if (lastBroadcastedProgress !== progressVal) {
        await publishDownloadStatus(fileId, DOWNLOAD_STATUS.DOWNLOADING, progressVal);
        lastBroadcastedProgress = progressVal;
      }

      // 7. Stall Preemption trigger
      if (wasStalled) {
        try {
          const waitingJobs = await downloadQueue.getJobs(['waiting']);
          const hasFreshWaiting = waitingJobs.some((j) => (j.opts?.priority ?? 0) < 10);
          if (hasFreshWaiting) {
            logger.info(`Preempting stalled download ${fileId} (${candidateToDownload.hash}) for fresh job in queue`);
            doneFired = true;
            cleanupClient(false);
            await downloadQueue.add(
              'download',
              {
                ...job.data,
                wasStalled: true,
                lockedCandidateHash: candidateToDownload.hash,
                failedCandidates: Array.from(failedCandidates),
                accumulatedDeadDuration: deadDuration
              },
              {
                priority: 10
              }
            );
            await publishDownloadStatus(fileId, DOWNLOAD_STATUS.QUEUED, progressVal);
            resolve({ fileId, status: 'preempted', wasStalled: true });
            return;
          }
        } catch (queueErr) {
          logger.error(`Error checking waiting jobs for preemption on ${fileId}:`, queueErr);
        }
      }

      if (isDone) {
        await handleDone();
      }
    }, TORRENT_QUEUE.POLL_INTERVAL_MS);

    torrent.on('download', () => {
      const currentTargetFile = selectedFile || (torrent.ready ? findMainFile(torrent, candidateToDownload.fileIdx) : null);
      if (currentTargetFile && isFileCompleted(currentTargetFile)) {
        handleDone();
      }
    });

    torrent.on('done', () => {
      handleDone();
    });

    torrent.on('error', async (err: Error | string) => {
      if (doneFired) return;
      logger.error(`Torrent download error for ${fileId} (${candidateToDownload.hash}):`, err);
      failedCandidates.add(candidateToDownload.hash);
      cleanupClient(true);

      const remaining = candidates.filter((c) => !failedCandidates.has(c.hash));
      if (remaining.length > 0) {
        const next = remaining[0];
        logger.info(`Error on candidate: failing over to ${next.hash}`);
        doneFired = true;
        await downloadQueue.add(
          'download',
          {
            ...job.data,
            lockedCandidateHash: next.hash,
            failedCandidates: Array.from(failedCandidates),
            accumulatedDeadDuration: 0
          },
          {
            priority: 1
          }
        );
        resolve({ fileId, status: 'failover_on_error', nextCandidate: next.hash });
        return;
      }

      await publishDownloadStatus(fileId, DOWNLOAD_STATUS.FAILED);
      reject(typeof err === 'string' ? new Error(err) : err);
    });
  });
}

/**
 * Creates and initializes the BullMQ Download Worker.
 *
 * @param customOptions Additional BullMQ worker options
 * @returns Worker instance
 */
export function createDownloadWorker(
  customOptions: Partial<WorkerOptions> = {}
): Worker<DownloadJobData, DownloadJobResult> {
  const connection = createRedisConnection({ connectionName: 'worker:download' });

  const worker = new Worker<DownloadJobData, DownloadJobResult>(
    QUEUE_NAMES.DOWNLOAD,
    async (job: Job<DownloadJobData, DownloadJobResult, string>) => {
      return processDownloadJob(job);
    },
    {
      prefix: QUEUE_PREFIX,
      connection,
      concurrency: WORKER_CONCURRENCY.DOWNLOAD,
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

export default createDownloadWorker;
