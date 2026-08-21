import fs from 'node:fs';
import path from 'node:path';
import { db } from './index.js';
import { SUBTITLE_LANGS } from '../config/languages.js';
import { getMediaDirs } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import type { SubtitlePreferenceRow, LocalSubtitleTrack } from '../types/index.js';

const getSubtitlePreferenceStmt = db.prepare('SELECT subtitle_lang FROM subtitle_preferences WHERE media_id = ?');
const saveSubtitlePreferenceStmt = db.prepare(`
  INSERT INTO subtitle_preferences (media_id, subtitle_lang)
  VALUES (?, ?)
  ON CONFLICT(media_id) DO UPDATE SET subtitle_lang=excluded.subtitle_lang
`);

/**
 * Helper to read and parse scores.json from subtitles directory.
 * @param subtitlesDir Directory containing subtitle files
 * @returns Scores map
 */
function readScores(subtitlesDir: string): Record<string, number> {
  const scoresPath = path.join(subtitlesDir, 'scores.json');
  if (fs.existsSync(scoresPath)) {
    try {
      return JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
    } catch (err) {
      logger.error(`Failed to load subtitle scores at ${scoresPath}`, err);
    }
  }
  return {};
}

/**
 * Retrieves saved subtitle preference for a media.
 * @param mediaId Media identifier
 * @returns Preferred language code or null
 */
export function getSubtitlePreference(mediaId: string): string | null {
  try {
    const row = getSubtitlePreferenceStmt.get(mediaId) as SubtitlePreferenceRow | undefined;
    return row ? row.subtitle_lang : null;
  } catch (e) {
    logger.error(`Error loading subtitle preference for ${mediaId}`, e);
    return null;
  }
}

/**
 * Saves preferred subtitle.
 * @param mediaId Media identifier
 * @param lang Preferred subtitle language
 */
export function saveSubtitlePreference(mediaId: string, lang: string | null): void {
  try {
    saveSubtitlePreferenceStmt.run(mediaId, lang);
    logger.info(`Saved preferred subtitle: lang=${lang} for: ${mediaId}`);
  } catch (e) {
    logger.error(`Failed to save subtitle preference for ${mediaId}`, e);
  }
}

/**
 * Scans and returns list of locally available subtitles for client consumption.
 * @param fileId Underscored fileId
 * @returns List of subtitle tracks
 */
export function getLocalSubtitles(fileId: string): LocalSubtitleTrack[] {
  const subtitles: LocalSubtitleTrack[] = [];
  try {
    const dirs = getMediaDirs(fileId);
    if (dirs && fs.existsSync(dirs.subtitlesDir)) {
      const files = fs.readdirSync(dirs.subtitlesDir);
      
      // Load scores.json if it exists
      const scores = readScores(dirs.subtitlesDir);
      
      for (const lang of SUBTITLE_LANGS) {
        const langFiles = files.filter(f => f.startsWith(`${fileId}_${lang}_`) && f.endsWith('.vtt'));
        
        const mapped: LocalSubtitleTrack[] = langFiles.map((file) => {
          const id = file.replace('.vtt', '');
          return {
            id,
            lang: lang,
            url: `/subtitles/${fileId}/${file}`,
            score: scores[id] ?? null
          };
        });
        
        if (mapped.length > 0) {
          // Sort by score descending (treat null/undefined scores as lowest quality)
          mapped.sort((a, b) => {
            const scoreA = a.score ?? -Infinity;
            const scoreB = b.score ?? -Infinity;
            return scoreB - scoreA;
          });
          // Return only the highest scoring subtitle track for this language
          subtitles.push(mapped[0]);
        }
      }
    }
  } catch (e) {
    logger.error(`Failed to scan local subtitles list for: ${fileId}`, e);
  }
  return subtitles;
}

export const subtitlesRepo = {
  getLocalSubtitles,
  getSubtitlePreference,
  saveSubtitlePreference
};

export { subtitlesRepo as subtitleRegistry };
export default subtitlesRepo;
