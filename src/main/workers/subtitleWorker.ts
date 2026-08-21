import { Worker, type Job, type WorkerOptions } from 'bullmq';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, type ExecFileOptions } from 'node:child_process';
import os from 'node:os';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import { createRedisConnection } from '../config/redis.js';
import { QUEUE_NAMES, QUEUE_PREFIX } from '../queues/index.js';
import { WORKER_CONCURRENCY } from '../config/queue.js';
import { parseFileId, getMediaDirs, fetchWithTimeout } from '../utils/helpers.js';
import { logger as baseLogger } from '../utils/logger.js';
import { openSubtitlesClient } from '../clients/opensubtitles.js';
import { SUBTITLE_LANGS } from '../config/languages.js';
import { RTL_LANGS, SUBTITLE_LANG_MAP } from '../utils/languages.js';
import type {
  SubtitleJobData,
  SubtitleJobResult
} from '../types/index.js';

const logger = baseLogger.child('subtitleWorker');

export function execFilePromise(
  file: string,
  args: string[],
  options: ExecFileOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const enhancedError = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
        enhancedError.stdout = stdout;
        enhancedError.stderr = stderr;
        reject(enhancedError);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });

    if (child && child.pid) {
      try {
        // Set lowest CPU scheduling priority (nice value 19 on macOS/Linux)
        os.setPriority(child.pid, 19);
        logger.debug(`Set child process priority to background (nice 19) for PID: ${child.pid}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Could not set child process scheduling priority: ${msg}`);
      }
    }
  });
}

const ffmpegStaticPath = (ffmpegStatic as unknown as string) || '';
const ffprobeStaticPath = ffprobeStatic.path || '';
const ffmpegDir = path.dirname(ffmpegStaticPath);
const ffprobeDir = path.dirname(ffprobeStaticPath);
const customEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: `${ffmpegDir}${path.delimiter}${ffprobeDir}${path.delimiter}${process.env.PATH || ''}`
};

if (ffmpegStaticPath) {
  ffmpeg.setFfmpegPath(ffmpegStaticPath);
}
if (ffprobeStaticPath) {
  ffmpeg.setFfprobePath(ffprobeStaticPath);
}

export function getFfsCommand(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'venv', 'bin', 'ffs'),
    path.join(process.cwd(), '.venv', 'bin', 'ffs'),
    '/opt/venv/bin/ffs'
  ];
  if (process.env.VIRTUAL_ENV) {
    possiblePaths.unshift(path.join(process.env.VIRTUAL_ENV, 'bin', 'ffs'));
  }
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'ffs';
}

export interface AnalyzedSubtitleLine {
  openTags: string[];
  closeTags: string[];
  coreText: string;
}

/**
 * Helper to analyze a subtitle line and extract outer HTML tags.
 * @param line Subtitle line text
 * @returns Analyzed line structure
 */
export function analyzeLine(line: string): AnalyzedSubtitleLine {
  let current = line;

  // Peel outer HTML tags
  const openTags: string[] = [];
  const closeTags: string[] = [];
  while (true) {
    const match = current.match(/^(<[a-zA-Z0-9=" '#]+>)(.*)(<\/[a-zA-Z0-9]+>)$/);
    if (match) {
      openTags.push(match[1]);
      closeTags.unshift(match[3]);
      current = match[2];
    } else {
      break;
    }
  }

  return {
    openTags,
    closeTags,
    coreText: current
  };
}

/**
 * Fixes RTL subtitle directionality and layout formatting issues.
 * Detects if the subtitle is "LTR-hacked" (visual layout reversal).
 * Swaps leading and trailing punctuation blocks to restore correct layout under RTL rendering and prepends \u202b (RLE).
 * @param text Raw subtitle content
 * @returns Formatted subtitle content
 */
export function fixRtlSubtitleText(text: string): string {
  // Normalize carriage returns first
  const normalizedText = text.replace(/\r/g, '');
  const lines = normalizedText.split('\n');

  let countStart = 0;
  let countEnd = 0;

  const rtlRegex = /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0750-\u077f\u0780-\u07bf\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
  const END_PUNC_CHARS = '.,?!:;…';
  const SWAP_PUNC_CHARS = END_PUNC_CHARS + '\\-–—';

  // Heuristic matching: check for end-of-sentence punctuation (excluding ellipses) or trailing dashes
  const leadEndPuncReg = /^(?:[?!:;]+|(?!\.\.)\.)/;
  const trailEndPuncReg = new RegExp(`([${END_PUNC_CHARS}\\s]+)$`);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('WEBVTT') || trimmed.includes('-->') || /^\d+$/.test(trimmed)) {
      continue;
    }
    const cleanLine = trimmed.replace(/[\u202b\u202c]/g, '');
    if (!cleanLine || !rtlRegex.test(cleanLine)) continue;

    // Analyze the clean line to extract core text
    const { coreText } = analyzeLine(cleanLine);
    const trimmedCore = coreText.trim();

    if (leadEndPuncReg.test(trimmedCore) || /[\-–—]$/.test(trimmedCore)) countStart++;
    if (trailEndPuncReg.test(trimmedCore)) countEnd++;
  }

  // We classify as hacked if we have significantly more lines starting with end-punctuation than ending with them.
  const isHacked = countStart > countEnd && countStart > 10;

  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || line.startsWith('WEBVTT') || line.includes('-->') || /^\d+$/.test(trimmed)) {
      return line;
    }

    if (!rtlRegex.test(line)) {
      return line;
    }

    const cleanLine = line.replace(/[\u202b\u202c]/g, '');

    // Analyze and extract structure
    const { openTags, closeTags, coreText } = analyzeLine(cleanLine);

    let processedCore = coreText;

    if (isHacked) {
      const leadReg = new RegExp(`^([${SWAP_PUNC_CHARS}\\s]+)`);
      const trailReg = new RegExp(`([${SWAP_PUNC_CHARS}\\s]+)$`);

      const leadMatch = processedCore.match(leadReg);
      const leadPunc = leadMatch ? leadMatch[1] : '';

      const trailMatch = processedCore.match(trailReg);
      const trailPunc = trailMatch ? trailMatch[1] : '';

      if (leadPunc || trailPunc) {
        let core = processedCore.substring(leadPunc.length);
        if (trailPunc) {
          core = core.substring(0, core.length - trailPunc.length);
        }
        processedCore = trailPunc + core + leadPunc;
      }
    }

    // Reassemble line
    const reassembled = openTags.join('') + processedCore + closeTags.join('');
    return '\u202b' + reassembled;
  });

  return processedLines.join('\n');
}

/**
 * Applies the RTL alignment fix to a local WebVTT file if the language is RTL.
 * @param filePath Path to local VTT file
 */
export function applyRtlFixIfNecessary(filePath: string): void {
  const isRtl = RTL_LANGS.some((lang) => path.basename(filePath).includes(`_${lang}_`));
  if (isRtl && fs.existsSync(filePath)) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const fixed = fixRtlSubtitleText(text);
      fs.writeFileSync(filePath, fixed, 'utf8');
      logger.info(`Applied/re-applied RTL formatting corrections to: ${path.basename(filePath)}`);
    } catch (err) {
      logger.error(`Failed to apply RTL fix to ${filePath}`, err);
    }
  }
}

/**
 * Probes the video file for text-based embedded subtitles, extracts them,
 * converts them to WebVTT, applies RTL fixes if needed, and saves scores.json.
 * @param fileId Unique media identifier
 * @param videoPath Path to video source
 * @returns True if at least one subtitle was successfully extracted
 */
export async function extractEmbeddedSubtitles(fileId: string, videoPath: string): Promise<boolean> {
  const dirs = getMediaDirs(fileId);
  if (!dirs) return false;

  try {
    logger.info(`Probing video for embedded subtitles: ${videoPath}`);

    const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, meta) => {
        if (err) return reject(err);
        resolve(meta);
      });
    });

    if (!metadata || !metadata.streams) {
      logger.warn(`No streams found in metadata for ${videoPath}`);
      return false;
    }

    const subtitleStreams = metadata.streams.filter((s) => s.codec_type === 'subtitle');
    if (subtitleStreams.length === 0) {
      logger.info(`No embedded subtitle streams found in ${videoPath}`);
      return false;
    }

    const TEXT_CODECS = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'microdvd'];
    const textStreams = subtitleStreams.filter((s) => {
      const codec = (s.codec_name || '').toLowerCase();
      return TEXT_CODECS.includes(codec);
    });

    if (textStreams.length === 0) {
      logger.info(`Found ${subtitleStreams.length} embedded subtitle stream(s), but none are text-based: ${subtitleStreams.map((s) => s.codec_name).join(', ')}`);
      return false;
    }

    logger.info(`Found ${textStreams.length} text-based embedded subtitle stream(s). Beginning extraction.`);

    if (!fs.existsSync(dirs.subtitlesDir)) {
      fs.mkdirSync(dirs.subtitlesDir, { recursive: true });
    }

    let extractedCount = 0;
    const langCounters: Record<string, number> = {};

    // Helper function to normalize language tag using SUBTITLE_LANG_MAP
    const normalizeLang = (langTag?: string | null): string | null => {
      if (!langTag) return null;
      const cleanTag = langTag.toLowerCase().trim();
      return SUBTITLE_LANG_MAP[cleanTag] || null;
    };

    for (let i = 0; i < textStreams.length; i++) {
      const stream = textStreams[i];
      const langTag = (stream.tags && stream.tags.language) ? String(stream.tags.language) : '';
      const targetLang = normalizeLang(langTag);

      if (!targetLang || !SUBTITLE_LANGS.includes(targetLang)) {
        logger.debug(`Skipping embedded subtitle stream ${stream.index} with language "${langTag}" (${targetLang || 'unrecognized'}) not in SUBTITLE_LANGS`);
        continue;
      }

      const langIndex = langCounters[targetLang] ?? 0;
      langCounters[targetLang] = langIndex + 1;

      const subId = `${fileId}_${targetLang}_embedded_${langIndex}`;
      const subPath = path.join(dirs.subtitlesDir, `${subId}.vtt`);

      try {
        logger.info(`Extracting embedded subtitle stream ${stream.index} (${langTag} -> ${targetLang}) to ${subPath}`);

        // Execute ffmpeg to extract the stream and convert to vtt
        const ffmpegBin = ffmpegStaticPath;
        const args = ['-y', '-threads', '1', '-i', videoPath, '-map', `0:${stream.index}`, subPath];

        await execFilePromise(ffmpegBin, args, { env: customEnv });

        if (fs.existsSync(subPath)) {
          applyRtlFixIfNecessary(subPath);
          extractedCount++;
        }
      } catch (extractErr) {
        logger.error(`Failed to extract subtitle stream ${stream.index} from ${videoPath}`, extractErr);
        // If the file was partially created, delete it
        if (fs.existsSync(subPath)) {
          try { fs.unlinkSync(subPath); } catch (_) {}
        }
      }
    }

    if (extractedCount > 0) {
      logger.info(`Successfully extracted ${extractedCount} embedded subtitle(s).`);
      return true;
    }

    return false;
  } catch (err) {
    logger.error(`Failed to probe/extract embedded subtitles for ${videoPath}`, err);
    return false;
  }
}

/**
 * Scrapes subtitles from OpenSubtitles, parses them, and saves as WebVTT.
 */
export async function scrapeAndSaveSubtitles(
  fileId: string,
  imdbId: string,
  type: 'movie' | 'series',
  season: number | string | null = null,
  episode: number | string | null = null,
  torrentTitle?: string,
  hash: string | null = null,
  size: number | null = null
): Promise<void> {
  const dirs = getMediaDirs(fileId);
  if (!dirs) return;

  try {
    const subtitles = await openSubtitlesClient.fetchSubtitles(fileId, imdbId, type, season, episode, torrentTitle, hash, size);

    if (subtitles && Array.isArray(subtitles) && subtitles.length > 0) {
      const downloadAndConvertSubtitle = async (subUrl: string, filePath: string): Promise<void> => {
        try {
          const response = await fetchWithTimeout(subUrl);
          const text = await response.text();
          let vtt = text
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();

          if (!vtt.startsWith('WEBVTT')) {
            vtt = 'WEBVTT\n\n' + vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
          }

          const isRtl = RTL_LANGS.some((lang) => filePath.includes(`_${lang}_`));
          if (isRtl) {
            vtt = fixRtlSubtitleText(vtt);
          }

          fs.writeFileSync(filePath, vtt, 'utf-8');
          logger.info(`Subtitle track saved to: ${filePath}`);
        } catch (e) {
          logger.error(`Failed to download and convert subtitle track from: ${subUrl}`, e);
        }
      };

      if (!fs.existsSync(dirs.subtitlesDir)) {
        fs.mkdirSync(dirs.subtitlesDir, { recursive: true });
      }

      for (const lang of SUBTITLE_LANGS) {
        const langSubs = subtitles.filter((s) => s.lang === lang);
        const hashMatches = langSubs.filter((s) => s.m === 'h');
        const imdbMatches = langSubs.filter((s) => s.m === 'i');
        const combinedSubs = [...hashMatches, ...imdbMatches];

        logger.info(`Saving all ${combinedSubs.length} subtitles for ${lang} (Hash matches: ${hashMatches.length}, IMDb matches: ${imdbMatches.length}).`);
        for (let i = 0; i < combinedSubs.length; i++) {
          const subPath = path.join(dirs.subtitlesDir, `${fileId}_${lang}_${i}.vtt`);
          await downloadAndConvertSubtitle(combinedSubs[i].url, subPath);
        }
      }
    }
  } catch (e) {
    logger.error(`OpenSubtitles scrape workflow failed for ${fileId}`, e);
  }
}

/**
 * Helper to execute ffsubsync (performing alignment on disk) and parse the match score from stderr.
 * @param ffsBin Path to ffsubsync executable
 * @param refPath Video reference or serialized speech path
 * @param subPath Target subtitle file to align
 * @param extraArgs Optional additional flags
 * @returns Match score
 */
export async function runFfs(
  ffsBin: string,
  refPath: string,
  subPath: string,
  extraArgs = ''
): Promise<number> {
  // Perform synchronization (overwriting the input file on disk) and skip if alignment confidence is low
  const args = [refPath, '-i', subPath, '--overwrite-input', '--skip-sync-on-low-quality'];
  if (extraArgs) {
    args.push(extraArgs);
  }
  logger.debug(`Running command: ${ffsBin} ${args.join(' ')}`);
  const { stderr } = await execFilePromise(ffsBin, args, { env: customEnv });
  const scoreMatch = stderr.match(/score:\s*(-?[\d.]+)/i);
  const offsetMatch = stderr.match(/offset seconds:\s*(-?[\d.]+)/i);
  const offset = offsetMatch ? parseFloat(offsetMatch[1]) : 0;
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
  logger.info(`Aligned track ${path.basename(subPath)}: offset applied = ${offset}s, raw match score = ${score}`);
  return score;
}

/**
 * Helper to read and parse scores.json from subtitles directory.
 * @param subtitlesDir Directory containing subtitles
 * @returns Scores map
 */
export function readScores(subtitlesDir: string): Record<string, number> {
  const scoresPath = path.join(subtitlesDir, 'scores.json');
  if (fs.existsSync(scoresPath)) {
    try {
      return JSON.parse(fs.readFileSync(scoresPath, 'utf8')) as Record<string, number>;
    } catch (err) {
      logger.error(`Failed to load subtitle scores at ${scoresPath}`, err);
    }
  }
  return {};
}

/**
 * Helper to write scores to scores.json in subtitles directory.
 * @param subtitlesDir Directory containing subtitles
 * @param scores Scores dictionary
 */
export function writeScores(subtitlesDir: string, scores: Record<string, number>): void {
  try {
    const scoresPath = path.join(subtitlesDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2), 'utf8');
    logger.info(`Saved subtitle scores to: ${scoresPath}`);
  } catch (err) {
    logger.error(`Failed to write subtitle scores to ${subtitlesDir}`, err);
  }
}

/**
 * Performs subtitle alignment and scoring on all local subtitle tracks for a media file.
 * Saves the result to scores.json in the subtitles directory.
 * @param fileId Unique media identifier
 * @param videoPath Path to video media
 */
export async function scoreLocalSubtitles(fileId: string, videoPath: string): Promise<void> {
  const dirs = getMediaDirs(fileId);
  if (!dirs || !fs.existsSync(dirs.subtitlesDir)) {
    logger.warn(`Subtitles directory not found for alignment/scoring: ${fileId}`);
    return;
  }

  const parsedPath = path.parse(videoPath);
  const speechNpzPath = path.join(parsedPath.dir, parsedPath.name + '.npz');

  try {
    const files = fs.readdirSync(dirs.subtitlesDir);
    const subFiles = files
      .filter((f) => {
        if (!f.startsWith(`${fileId}_`) || !f.endsWith('.vtt')) return false;
        const remainder = f.replace(`${fileId}_`, '').replace('.vtt', '');
        const lang = remainder.split('_')[0];
        return SUBTITLE_LANGS.includes(lang);
      })
      .sort();

    if (subFiles.length === 0) {
      logger.info(`No matching local subtitles (${SUBTITLE_LANGS.join(', ')}) found to align/score for ${fileId}`);
      return;
    }

    const scores: Record<string, number> = {};
    const ffsBin = getFfsCommand();
    let serialized = false;
    let ffsAvailable = true;

    for (const subFile of subFiles) {
      const subPath = path.join(dirs.subtitlesDir, subFile);
      const subId = subFile.replace('.vtt', '');

      if (!ffsAvailable) {
        scores[subId] = 0;
        continue;
      }

      try {
        if (!serialized) {
          // First run extracts speech and serializes it to speed up subsequent runs
          logger.info(`Extracting speech, aligning, and scoring first subtitle: ${subFile}`);
          const score = await runFfs(ffsBin, videoPath, subPath, '--serialize-speech');
          scores[subId] = score;
          if (fs.existsSync(speechNpzPath)) {
            serialized = true;
          }
        } else {
          logger.info(`Aligning/scoring subtitle using serialized speech reference: ${subFile}`);
          const score = await runFfs(ffsBin, speechNpzPath, subPath);
          scores[subId] = score;
        }

        // Post-alignment sanitize to ensure RTL layout formatting is preserved/fixed
        applyRtlFixIfNecessary(subPath);
      } catch (subErr: unknown) {
        const errObj = subErr as Error & { code?: string };
        if (errObj?.code === 'ENOENT' || String(subErr).includes('ENOENT')) {
          logger.warn(`ffsubsync (${ffsBin}) is not installed or not in PATH. Skipping audio-alignment scoring for remaining subtitles.`);
          ffsAvailable = false;
        } else {
          logger.error(`Failed to align/score subtitle track ${subFile}`, subErr);
        }
        scores[subId] = 0; // Default score on failure
      }
    }

    // 3. Save to scores.json
    writeScores(dirs.subtitlesDir, scores);
  } catch (e) {
    logger.error(`ffsubsync subtitle scoring workflow failed for ${fileId}`, e);
  } finally {
    // 4. Clean up serialized speech
    if (fs.existsSync(speechNpzPath)) {
      try {
        fs.unlinkSync(speechNpzPath);
      } catch (e) {
        logger.warn(`Failed to clean up serialized speech file ${speechNpzPath}`, e);
      }
    }
  }
}

/**
 * Processes subtitles for a downloaded media file.
 * Extracts all embedded text subtitles and downloads all API subtitles,
 * then aligns and scores all of them. The best-scored track will be
 * selected by the client.
 */
export async function processSubtitles(
  fileId: string,
  videoPath: string,
  imdbId: string,
  type: 'movie' | 'series',
  season: number | string | null = null,
  episode: number | string | null = null,
  torrentTitle?: string,
  hash: string | null = null,
  size: number | null = null
): Promise<void> {
  const dirs = getMediaDirs(fileId);
  if (dirs && fs.existsSync(path.join(dirs.subtitlesDir, 'scores.json'))) {
    logger.info(`Subtitle processing already completed (scores.json exists) for: ${fileId}. Skipping.`);
    return;
  }

  logger.info(`Starting subtitle processing for: ${fileId}`);

  // 1. Extract embedded text subtitles
  try {
    await extractEmbeddedSubtitles(fileId, videoPath);
  } catch (err) {
    logger.error(`Error extracting embedded subtitles for ${fileId}`, err);
  }

  // 2. Download API subtitles
  try {
    await scrapeAndSaveSubtitles(fileId, imdbId, type, season, episode, torrentTitle, hash, size);
  } catch (err) {
    logger.error(`Error scraping API subtitles for ${fileId}`, err);
  }

  // 3. Align and score all local subtitles (both embedded and scraped)
  try {
    logger.info(`Running VAD and scoring all subtitles for: ${fileId}`);
    await scoreLocalSubtitles(fileId, videoPath);
  } catch (scoreErr) {
    logger.error(`VAD subtitle scoring failed for ${fileId}`, scoreErr);
  }
}

/**
 * Processes a single subtitle extraction and synchronization job.
 *
 * @param job BullMQ Job instance
 * @returns Subtitle processing result
 */
export async function processSubtitleJob(
  job: Job<SubtitleJobData, SubtitleJobResult, string>
): Promise<SubtitleJobResult> {
  const {
    fileId,
    sourcePath,
    fileHash,
    fileSize,
    targetFileName
  } = job.data;

  logger.info(`Starting subtitle job for fileId: ${fileId} (Job ID: ${job.id})`);

  const parsed = parseFileId(fileId);
  if (!parsed) {
    throw new Error(`Invalid fileId format for subtitle processing: ${fileId}`);
  }

  const { imdbId, type: mediaType, season, episode } = parsed;

  try {
    // 1. Probe embedded text subtitles, scrape OpenSubtitles, and synchronize/score with ffsubsync
    await processSubtitles(
      fileId,
      sourcePath,
      imdbId,
      mediaType,
      season,
      episode,
      targetFileName,
      fileHash,
      fileSize
    );
    logger.info(`Subtitle processing finished for: ${fileId}`);
  } catch (err) {
    logger.error(`Subtitle extraction/syncing failed for ${fileId}:`, err);
    // Non-fatal for the stream playback: proceed so finalize can complete
  }

  return {
    fileId,
    status: 'subtitles_ready'
  };
}

/**
 * Creates and initializes the BullMQ Subtitle Worker.
 *
 * @param customOptions Additional BullMQ worker options
 * @returns Worker instance
 */
export function createSubtitleWorker(
  customOptions: Partial<WorkerOptions> = {}
): Worker<SubtitleJobData, SubtitleJobResult> {
  const connection = createRedisConnection({ connectionName: 'worker:subtitle' });

  const worker = new Worker<SubtitleJobData, SubtitleJobResult>(
    QUEUE_NAMES.SUBTITLE,
    async (job: Job<SubtitleJobData, SubtitleJobResult, string>) => {
      return processSubtitleJob(job);
    },
    {
      prefix: QUEUE_PREFIX,
      connection,
      concurrency: WORKER_CONCURRENCY.SUBTITLE,
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

export default createSubtitleWorker;
