/**
 * Language runtime configuration.
 */

/**
 * Subtitle languages for downloading, extraction, and local presentation.
 * Configurable via process.env.SUBTITLE_LANGS (comma-separated ISO 639-2 codes, e.g. "eng,spa,fre,ger").
 */
export const SUBTITLE_LANGS: readonly string[] = Object.freeze(
  process.env.SUBTITLE_LANGS
    ? process.env.SUBTITLE_LANGS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : ['eng', 'spa']
);
