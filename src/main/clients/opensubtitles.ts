import { fetchWithTimeout } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import type { OpenSubtitleItem, OpenSubtitlesResponse } from '../types/index.js';

const OPENSUBTITLES_API = 'https://opensubtitles-v3.strem.io';

export class OpenSubtitlesClient {
  /**
   * Queries OpenSubtitles for subtitles matching hash/size or filename and returns normalized candidates.
   * @param fileId Unique media or file identifier
   * @param imdbId IMDb identifier
   * @param type Media type ('movie' or 'series')
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
    type: 'movie' | 'series',
    season: number | string | null = null,
    episode: number | string | null = null,
    torrentTitle?: string,
    hash: string | null = null,
    size: number | string | null = null
  ): Promise<OpenSubtitleItem[]> {
    try {
      const id = type === 'series' ? `${imdbId}:${season}:${episode}` : imdbId;

      let url: string;
      if (hash && size) {
        url = `${OPENSUBTITLES_API}/subtitles/${type}/${id}/videoHash=${hash}&videoSize=${size}.json`;
      } else {
        const cleanTitle = (torrentTitle || '').split('\n')[0];
        const cleanFilename = encodeURIComponent(cleanTitle.replace(/ /g, '.'));
        url = `${OPENSUBTITLES_API}/subtitles/${type}/${id}/filename=${cleanFilename}.json`;
      }

      logger.info(`Fetching subtitle details from OpenSubtitles: ${url}`);
      const resp = await fetchWithTimeout(url);
      if (!resp.ok) {
        logger.warn(`OpenSubtitles returned status ${resp.status} for ${url}`);
        return [];
      }

      const data = (await resp.json()) as OpenSubtitlesResponse;
      if (!data.subtitles || !Array.isArray(data.subtitles)) {
        return [];
      }

      return data.subtitles.map((sub: Partial<OpenSubtitleItem>) => ({
        id: (sub.idSubMovieHash || sub.idSubImdb || sub.id || '') as string,
        lang: sub.lang || '',
        m: sub.m,
        matchType: sub.m,
        url: sub.url || '',
        format: sub.format || 'srt',
        ...sub
      })) as OpenSubtitleItem[];
    } catch (e) {
      logger.error(`OpenSubtitles fetch workflow failed for ${fileId || imdbId}`, e);
      return [];
    }
  }
}

const openSubtitlesInstance = new OpenSubtitlesClient();
export { openSubtitlesInstance as openSubtitlesClient };
export default openSubtitlesInstance;
