import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import type { OpenSubtitleItem, OpenSubtitlesResponse, MediaType } from '../types/index.js';

const OPENSUBTITLES_API = 'https://opensubtitles-v3.strem.io';

export class OpenSubtitlesClient {
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(maxRetries = 2, retryDelayMs = 1000) {
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
  }

  /**
   * Queries OpenSubtitles for subtitles matching hash/size or filename and returns normalized candidates.
   * Retries automatically on transient network failures.
   * @param fileId Unique media or file identifier
   * @param imdbId IMDb identifier
   * @param type Media type ('movie' or 'show')
   * @param season Season number
   * @param episode Episode number
   * @param torrentTitle Torrent release title
   * @param hash File hash (optional)
   * @param size File size in bytes (optional)
   * @returns Normalized list of subtitle candidates with download URLs
   */
  async fetchSubtitles(
    fileId: string,
    imdbId: string,
    type: MediaType,
    season: number | string | null = null,
    episode: number | string | null = null,
    torrentTitle?: string,
    hash: string | null = null,
    size: number | string | null = null
  ): Promise<OpenSubtitleItem[]> {
    // OpenSubtitles protocol partitions routes by 'movie' / 'series'
    const externalType = type === 'movie' ? 'movie' : 'series';
    const id = type === 'show' ? `${imdbId}:${season}:${episode}` : imdbId;

    let url: string;
    if (hash && size) {
      url = `${OPENSUBTITLES_API}/subtitles/${externalType}/${id}/videoHash=${hash}&videoSize=${size}.json`;
    } else {
      const cleanTitle = (torrentTitle ?? '').split('\n')[0];
      const cleanFilename = encodeURIComponent(cleanTitle.replace(/ /g, '.'));
      url = `${OPENSUBTITLES_API}/subtitles/${externalType}/${id}/filename=${cleanFilename}.json`;
    }

    logger.info(`Fetching subtitle details from OpenSubtitles: ${url}`);

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const resp = await fetchWithTimeout(url);
        if (!resp.ok) {
          if (resp.status >= 500 || resp.status === 429) {
            throw new Error(`OpenSubtitles upstream HTTP ${resp.status}`);
          }
          logger.warn(`OpenSubtitles returned status ${resp.status} for ${url}`);
          return [];
        }

        const data = (await resp.json()) as OpenSubtitlesResponse;
        if (!data.subtitles || !Array.isArray(data.subtitles)) {
          return [];
        }

        return data.subtitles.map((sub: Partial<OpenSubtitleItem>) => ({
          id: (sub.idSubMovieHash ?? sub.idSubImdb ?? sub.id ?? '') as string,
          lang: sub.lang ?? '',
          m: sub.m,
          matchType: sub.m,
          url: sub.url ?? '',
          format: sub.format ?? 'srt',
          ...sub
        })) as OpenSubtitleItem[];
      } catch (e) {
        const errorDetail =
          (e as { cause?: { message?: string } })?.cause?.message ??
          (e instanceof Error ? e.message : String(e));
        if (attempt <= this.maxRetries) {
          logger.warn(
            `OpenSubtitles fetch attempt ${attempt} failed for ${fileId} (${errorDetail}). Retrying in ${this.retryDelayMs * attempt}ms...`,
            e
          );
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        } else {
          logger.error(
            `OpenSubtitles fetch workflow failed for ${fileId} after ${this.maxRetries + 1} attempts (${errorDetail})`,
            e
          );
          return [];
        }
      }
    }

    return [];
  }
}

const openSubtitlesInstance = new OpenSubtitlesClient();
export { openSubtitlesInstance as openSubtitlesClient };
export default openSubtitlesInstance;
