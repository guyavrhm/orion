export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Converts WebVTT / SRT timestamp strings to seconds.
 * Supported formats:
 * - HH:MM:SS.mmm
 * - HH:MM:SS,mmm
 * - MM:SS.mmm
 * - MM:SS,mmm
 * - SS.mmm
 */
export function parseTimestamp(str: string): number {
  if (!str) return 0;
  const clean = str.trim().replace(',', '.');
  const parts = clean.split(':');

  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const mins = parseFloat(parts[1]) || 0;
    const secs = parseFloat(parts[2]) || 0;
    return hours * 3600 + mins * 60 + secs;
  } else if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  } else if (parts.length === 1) {
    return parseFloat(parts[0]) || 0;
  }
  return 0;
}

/**
 * Cleans formatting tags and HTML entities from subtitle text lines.
 */
export function cleanSubtitleText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '') // Strips SSA/ASS override tags (e.g. {\an8}, {\pos(x,y)}, {\b1})
    .replace(/<[^>]+>/g, '') // Strips HTML / VTT tags (e.g., <i>, <b>, <c.yellow>, <v Speaker>)
    .replace(/&rlm;|&lrm;/gi, '') // Strips hidden direction markers if present
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Parses raw WebVTT / SRT text into structured SubtitleCue items.
 */
export function parseWebVtt(vttText: string): SubtitleCue[] {
  if (!vttText || typeof vttText !== 'string') {
    return [];
  }

  const lines = vttText.split(/\r?\n/);
  const cues: SubtitleCue[] = [];
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentContent: string[] = [];

  const flushCue = () => {
    if (currentStart !== null && currentEnd !== null && currentContent.length > 0) {
      const text = cleanSubtitleText(currentContent.join('\n'));
      if (text) {
        cues.push({
          start: currentStart,
          end: currentEnd,
          text,
        });
      }
    }
    currentStart = null;
    currentEnd = null;
    currentContent = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Empty line separates cues
    if (!line) {
      flushCue();
      continue;
    }

    // Cue timing definition line
    if (line.includes('-->')) {
      flushCue();
      const parts = line.split('-->');
      if (parts.length >= 2) {
        const startToken = parts[0].trim().split(/\s+/)[0];
        const endToken = parts[1].trim().split(/\s+/)[0];
        currentStart = parseTimestamp(startToken);
        currentEnd = parseTimestamp(endToken);
      }
      continue;
    }

    // Skip WebVTT header blocks and comments if not inside a cue
    if (currentStart === null || currentEnd === null) {
      if (line.startsWith('WEBVTT') || line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION')) {
        continue;
      }
      // Line might be a numeric cue index (e.g. "1", "2") or cue ID before the timestamp line
      continue;
    }

    // Cue text content
    currentContent.push(line);
  }

  flushCue();
  return cues;
}

/**
 * Finds all active subtitle cues for the given playback time (with optional offset).
 */
export function findActiveCueText(
  cues: SubtitleCue[],
  currentTime: number,
  offsetSeconds: number = 0
): string {
  if (!cues || cues.length === 0) return '';
  const adjustedTime = currentTime + (offsetSeconds || 0);

  const matched = cues.filter((c) => adjustedTime >= c.start && adjustedTime <= c.end);
  if (matched.length === 0) return '';
  return matched.map((c) => c.text).join('\n');
}

/**
 * Detects RTL characters (Hebrew, Arabic, Persian, etc.)
 */
export function isRtlText(text: string): boolean {
  if (!text) return false;
  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Static map of ISO 639-2 canonical language codes to native display names (autonyms).
 */
export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  eng: 'English',
  spa: 'Español',
  fre: 'Français',
  ger: 'Deutsch',
  ita: 'Italiano',
  por: 'Português',
  rus: 'Русский',
  jpn: '日本語',
  kor: '한국어',
  chi: '中文',
  ara: 'العربية',
  hin: 'हिन्दी',
  tur: 'Türkçe',
  heb: 'עברית',
  vie: 'Tiếng Việt',
  pol: 'Polski',
  dut: 'Nederlands',
  swe: 'Svenska',
  nor: 'Norsk',
  dan: 'Dansk',
  fin: 'Suomi',
  gre: 'Ελληνικά',
  cze: 'Čeština',
  hun: 'Magyar',
  rum: 'Română',
  ukr: 'Українська',
  tha: 'ไทย',
  ind: 'Bahasa Indonesia',
  per: 'فارسی',
  hrv: 'Hrvatski',
  ice: 'Íslenska',
  lit: 'Lietuvių',
  lav: 'Latviešu',
  mac: 'Македонски',
  may: 'Bahasa Melayu',
  slv: 'Slovenščina',
  srp: 'Srpski',
};

/**
 * Formats a language code (e.g. "eng", "heb", "es", "fre") to its full display name.
 */
export function getLanguageDisplayName(code?: string | null): string {
  if (!code) return '';
  const clean = code.trim().toLowerCase();
  if (LANGUAGE_DISPLAY_NAMES[clean]) {
    return LANGUAGE_DISPLAY_NAMES[clean];
  }

  // Fallback to Intl.DisplayNames if available
  if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
    try {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      const resolved = displayNames.of(clean);
      if (resolved && resolved !== clean) {
        return resolved;
      }
    } catch {
      // Ignore invalid language tag error and fallback
    }
  }

  // Fallback: capitalize original code
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

