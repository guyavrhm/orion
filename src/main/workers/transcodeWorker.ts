import { Worker, type Job, type WorkerOptions } from 'bullmq';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { createRedisConnection } from '../config/redis.js';
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  publishDownloadStatus
} from '../queues/index.js';
import { WORKER_CONCURRENCY } from '../config/queue.js';
import { metadataRepo } from '../db/metadata.js';
import { parseFileId, getMediaDirs } from '../utils/helpers.js';
import { logger as baseLogger } from '../utils/logger.js';
import { countryToLanguageMap } from '../utils/languages.js';
import {
  DOWNLOAD_STATUS,
  type TranscodeJobData,
  type TranscodeJobResult
} from '../types/index.js';

const logger = baseLogger.child('transcodeWorker');

// Configure ffmpeg and ffprobe binary paths
const ffmpegPath = (ffmpegStatic as unknown as string) || '';
const ffprobePath = ffprobeStatic.path;

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

export function getLanguageCodesFromCountry(countryStr?: string | null): string[] {
  if (!countryStr || typeof countryStr !== 'string') {
    return [];
  }

  const countries = countryStr.toLowerCase().split(',').map((c) => c.trim());
  const languages: string[] = [];

  for (const country of countries) {
    if (countryToLanguageMap[country]) {
      languages.push(...countryToLanguageMap[country]);
    }
  }

  // Remove duplicates and keep order
  return [...new Set(languages)];
}

export interface ProbedMediaInfo {
  audioIndex: number;
  isVideoH264: boolean;
  videoCodec: string;
  pixFmt: string;
}

/**
 * Probes the input video file to find the preferred audio stream and determine
 * if the video is web-universal 8-bit H.264 or requires adaptive transcoding.
 * @param inputPath Path to the media file
 * @param preferredLangs Array of language tags in priority order
 * @returns ProbedMediaInfo
 */
export function probeMediaStreams(inputPath: string, preferredLangs: string[]): Promise<ProbedMediaInfo> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn(`ffprobe timed out for ${inputPath}, defaulting to audio index 0, stream copy`);
      resolve({ audioIndex: 0, isVideoH264: true, videoCodec: 'unknown', pixFmt: 'unknown' });
    }, 10000);

    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      clearTimeout(timeout);
      if (err || !metadata || !metadata.streams) {
        logger.warn(`ffprobe failed or returned no streams for ${inputPath}: ${err ? err.message : 'no metadata'}. Defaulting to audio index 0`);
        return resolve({ audioIndex: 0, isVideoH264: true, videoCodec: 'unknown', pixFmt: 'unknown' });
      }

      try {
        // 1. Inspect Video Stream
        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        const videoCodec = String(videoStream?.codec_name || '').toLowerCase();
        const pixFmt = String(videoStream?.pix_fmt || '').toLowerCase();
        const profile = String(videoStream?.profile || '').toLowerCase();

        // 8-bit standard H.264 is universally supported in all browsers with -c:v copy
        const is8Bit = pixFmt === 'yuv420p' || (!pixFmt.includes('10') && !pixFmt.includes('12') && !profile.includes('10'));
        const isVideoH264 = videoCodec === 'h264' && is8Bit;

        logger.info(`Probed video for ${inputPath}: codec=${videoCodec || 'unknown'}, pix_fmt=${pixFmt || 'unknown'}, isVideoH264=${isVideoH264}`);

        // 2. Inspect Audio Streams
        const audioStreams = metadata.streams.filter((s) => s.codec_type === 'audio');
        if (audioStreams.length <= 1) {
          return resolve({ audioIndex: 0, isVideoH264, videoCodec, pixFmt });
        }

        // Search streams sequentially for each preferred language in order of preference
        for (const targetLang of preferredLangs) {
          const index = audioStreams.findIndex((s) => {
            const lang = (s.tags && s.tags.language && typeof s.tags.language === 'string') ? s.tags.language.toLowerCase() : '';
            const title = (s.tags && s.tags.title && typeof s.tags.title === 'string') ? s.tags.title.toLowerCase() : '';

            // Direct match (e.g. 'spa' or sub-tags like 'es-ES' matching 'es')
            if (lang === targetLang || lang.startsWith(targetLang + '-') || lang.startsWith(targetLang + '_')) {
              return true;
            }

            // Match title using word boundaries for terms >= 3 characters to avoid false positives
            if (targetLang.length >= 3) {
              const regex = new RegExp(`\\b${targetLang}\\b`, 'i');
              if (regex.test(title)) {
                return true;
              }
            }

            return false;
          });

          if (index !== -1) {
            logger.info(`Detected preferred audio stream matching '${targetLang}' at relative index ${index} (stream index ${audioStreams[index].index}) for ${inputPath}`);
            return resolve({ audioIndex: index, isVideoH264, videoCodec, pixFmt });
          }
        }

        logger.info(`No preferred audio stream detected among ${audioStreams.length} tracks. Defaulting to index 0`);
        resolve({ audioIndex: 0, isVideoH264, videoCodec, pixFmt });
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        logger.error(`Error parsing streams in ffprobe for ${inputPath}: ${msg}`);
        resolve({ audioIndex: 0, isVideoH264: true, videoCodec: 'unknown', pixFmt: 'unknown' });
      }
    });
  });
}

/**
 * Legacy wrapper for getPreferredAudioStreamIndex.
 */
export async function getPreferredAudioStreamIndex(inputPath: string, preferredLangs: string[]): Promise<number> {
  const probed = await probeMediaStreams(inputPath, preferredLangs);
  return probed.audioIndex;
}

/**
 * Transcodes any raw video format (mp4, mkv, etc.) to HLS format.
 * Dynamically chooses between fast stream-copy (for 8-bit H.264) and adaptive H.264 re-encoding (for HEVC/AV1/10-bit).
 * Emits real-time progress events over Redis/SSE during transcoding.
 * @param inputPath Path to source media
 * @param outputDir Destination HLS directory
 * @param country Original country/countries of the media
 * @param fileId Optional canonical file identifier for status reporting
 * @returns Path of the master playlist (.m3u8) file
 */
export function convertToHls(
  inputPath: string,
  outputDir: string,
  country?: string | null,
  fileId?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const playlistPath = path.join(outputDir, 'index.m3u8');

    const preferredLangs = getLanguageCodesFromCountry(country);
    logger.debug(`Preferred languages for HLS transcoding (country: "${country || ''}"): ${JSON.stringify(preferredLangs)}`);

    probeMediaStreams(inputPath, preferredLangs)
      .then((probed) => {
        const audioMap = `-map 0:a:${probed.audioIndex}?`;
        logger.info(`Using audio mapping option: ${audioMap} for HLS transcode of ${inputPath}`);

        const cpuCount = os.cpus()?.length || 1;
        const transcodeThreads = Math.max(1, Math.min(4, Math.floor(cpuCount / 2)));
        const videoOptions: string[] = probed.isVideoH264
          ? ['-c:v copy', '-threads 1']
          : [
              '-c:v libx264',
              '-preset veryfast',
              '-crf 22',
              '-pix_fmt yuv420p',
              `-threads ${transcodeThreads}`
            ];

        if (!probed.isVideoH264) {
          logger.info(`Non-standard / HEVC video detected (${probed.videoCodec} ${probed.pixFmt}). Performing adaptive H.264 transcode for universal web playback.`);
          if (fileId) {
            publishDownloadStatus(fileId, DOWNLOAD_STATUS.PROCESSING, '0.00').catch((err) => {
              logger.warn(`Failed to publish initial transcode processing status for ${fileId}:`, err);
            });
          }
        }

        let lastBroadcastPercent = -1;
        let lastBroadcastTime = 0;

        const proc = ffmpeg(inputPath)
          .outputOptions([
            '-map 0:v:0',
            audioMap,
            ...videoOptions,
            '-c:a aac',
            '-ac 2',
            '-b:a 192k',
            '-af aresample=async=1',
            '-hls_time 6',
            '-hls_playlist_type vod',
            '-hls_list_size 0'
          ])
          .format('hls')
          .output(playlistPath)
          .on('start', (commandLine: string) => {
            logger.info(`FFmpeg process started: ${commandLine}`);
            const ffmpegProc = (proc as unknown as { ffmpegProc?: { pid?: number } }).ffmpegProc;
            if (ffmpegProc && ffmpegProc.pid) {
              try {
                // Set lowest CPU scheduling priority (nice value 19 on macOS/Linux)
                os.setPriority(ffmpegProc.pid, 19);
                logger.debug(`Set FFmpeg process priority to background (nice 19)`);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.warn(`Could not set FFmpeg process scheduling priority: ${msg}`);
              }
            }
          })
          .on('progress', (progress: { percent?: number }) => {
            if (!fileId) return;
            const percent = Math.floor(progress.percent || 0);
            const now = Date.now();
            if (percent > lastBroadcastPercent && percent <= 100 && (now - lastBroadcastTime >= 1500 || percent === 100)) {
              lastBroadcastPercent = percent;
              lastBroadcastTime = now;
              publishDownloadStatus(fileId, DOWNLOAD_STATUS.PROCESSING, percent.toFixed(2)).catch((err) => {
                logger.warn(`Failed to publish transcode progress for ${fileId}:`, err);
              });
            }
          })
          .on('end', () => {
            logger.info(`FFmpeg HLS transcode completed successfully: ${playlistPath}`);
            resolve(playlistPath);
          })
          .on('error', (err: Error) => {
            logger.error(`FFmpeg HLS transcode failed:`, err);
            reject(err);
          });

        proc.run();
      })
      .catch((err: Error) => {
        logger.error(`Failed to transcode HLS: ${err.message}`);
        reject(err);
      });
  });
}

/**
 * Processes a single transcoding job.
 *
 * @param job BullMQ Job instance
 * @returns Transcode result
 */
export async function processTranscodeJob(
  job: Job<TranscodeJobData, TranscodeJobResult, string>
): Promise<TranscodeJobResult> {
  const {
    fileId,
    sourcePath
  } = job.data;

  logger.info(`Starting transcode job for fileId: ${fileId} (Job ID: ${job.id})`);

  const dirs = getMediaDirs(fileId);
  if (!dirs) {
    throw new Error(`Could not resolve media directories for ${fileId}`);
  }

  if (!fs.existsSync(dirs.baseDir)) {
    fs.mkdirSync(dirs.baseDir, { recursive: true });
  }

  // 1. Retrieve origin country from metadata cache to select matching original audio track
  let country: string | null = null;
  try {
    const parsed = parseFileId(fileId);
    if (parsed) {
      const cached = metadataRepo.getCachedMetadata(parsed.imdbId);
      if (cached && cached.metadata && cached.metadata.country) {
        country = cached.metadata.country;
        logger.info(`Retrieved origin country for ${fileId}: "${country}"`);
      }
    }
  } catch (metaErr) {
    logger.error(`Failed to retrieve country metadata for ${fileId}:`, metaErr);
  }

  // 2. Perform HLS transcoding (converting to .m3u8 and .ts chunks)
  try {
    logger.info(`Transcoding video to HLS: source=${sourcePath} targetDir=${dirs.hlsDir}`);
    await convertToHls(sourcePath, dirs.hlsDir, country, fileId);
  } catch (transcodeErr) {
    logger.error(`FFmpeg transcoding failed for ${fileId}:`, transcodeErr);
    await publishDownloadStatus(fileId, DOWNLOAD_STATUS.FAILED);
    throw transcodeErr;
  }

  logger.info(`Transcode complete: ${fileId}`);

  return {
    fileId,
    status: 'transcoded'
  };
}

/**
 * Creates and initializes a BullMQ Transcode Worker for a specific queue lane.
 *
 * @param queueName Target queue name
 * @param concurrency Concurrency level
 * @param customOptions Additional BullMQ worker options
 * @returns Worker instance
 */
export function createTranscodeWorker(
  queueName: string = QUEUE_NAMES.TRANSCODE,
  concurrency: number = WORKER_CONCURRENCY.TRANSCODE,
  customOptions: Partial<WorkerOptions> = {}
): Worker<TranscodeJobData, TranscodeJobResult> {
  const safeName = queueName.replace(/[:/]/g, '_');
  const connection = createRedisConnection({ connectionName: `worker:${safeName}` });

  const worker = new Worker<TranscodeJobData, TranscodeJobResult>(
    queueName,
    async (job: Job<TranscodeJobData, TranscodeJobResult, string>) => {
      return processTranscodeJob(job);
    },
    {
      prefix: QUEUE_PREFIX,
      connection,
      concurrency,
      ...customOptions
    }
  );

  worker.on('active', (job) => {
    logger.info(`[${queueName}] Job ${job.id} active (fileId: ${job.data.fileId})`);
  });

  worker.on('completed', (job) => {
    logger.info(`[${queueName}] Job ${job.id} completed (fileId: ${job.data.fileId})`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[${queueName}] Job ${job?.id} failed (fileId: ${job?.data?.fileId}):`, err);
  });

  worker.on('error', (err) => {
    logger.error(`[${queueName}] BullMQ Worker error:`, err);
  });

  return worker;
}

export function createFastTranscodeWorker(
  customOptions: Partial<WorkerOptions> = {}
): Worker<TranscodeJobData, TranscodeJobResult> {
  return createTranscodeWorker(
    QUEUE_NAMES.TRANSCODE_FAST,
    WORKER_CONCURRENCY.TRANSCODE_FAST,
    customOptions
  );
}

export function createHeavyTranscodeWorker(
  customOptions: Partial<WorkerOptions> = {}
): Worker<TranscodeJobData, TranscodeJobResult> {
  return createTranscodeWorker(
    QUEUE_NAMES.TRANSCODE_HEAVY,
    WORKER_CONCURRENCY.TRANSCODE_HEAVY,
    customOptions
  );
}

export default createTranscodeWorker;
