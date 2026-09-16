import { describe, it, expect } from 'vitest';
import {
  parseTimestamp,
  cleanSubtitleText,
  parseWebVtt,
  findActiveCueText,
  isRtlText,
  getLanguageDisplayName,
} from '../../../src/client/utils/subtitles.js';

describe('Client Subtitle Utilities - getLanguageDisplayName', () => {
  it('should map standard ISO 639-2 codes to native language names (autonyms)', () => {
    expect(getLanguageDisplayName('eng')).toBe('English');
    expect(getLanguageDisplayName('spa')).toBe('Español');
    expect(getLanguageDisplayName('fre')).toBe('Français');
    expect(getLanguageDisplayName('ger')).toBe('Deutsch');
    expect(getLanguageDisplayName('ita')).toBe('Italiano');
    expect(getLanguageDisplayName('por')).toBe('Português');
    expect(getLanguageDisplayName('rus')).toBe('Русский');
    expect(getLanguageDisplayName('jpn')).toBe('日本語');
    expect(getLanguageDisplayName('kor')).toBe('한국어');
    expect(getLanguageDisplayName('chi')).toBe('中文');
    expect(getLanguageDisplayName('ara')).toBe('العربية');
    expect(getLanguageDisplayName('heb')).toBe('עברית');
    expect(getLanguageDisplayName('tur')).toBe('Türkçe');
    expect(getLanguageDisplayName('hin')).toBe('हिन्दी');
    expect(getLanguageDisplayName('pol')).toBe('Polski');
    expect(getLanguageDisplayName('swe')).toBe('Svenska');
    expect(getLanguageDisplayName('nor')).toBe('Norsk');
    expect(getLanguageDisplayName('dan')).toBe('Dansk');
    expect(getLanguageDisplayName('fin')).toBe('Suomi');
    expect(getLanguageDisplayName('gre')).toBe('Ελληνικά');
    expect(getLanguageDisplayName('cze')).toBe('Čeština');
    expect(getLanguageDisplayName('hun')).toBe('Magyar');
    expect(getLanguageDisplayName('rum')).toBe('Română');
    expect(getLanguageDisplayName('ukr')).toBe('Українська');
    expect(getLanguageDisplayName('tha')).toBe('ไทย');
    expect(getLanguageDisplayName('ind')).toBe('Bahasa Indonesia');
    expect(getLanguageDisplayName('per')).toBe('فارسی');
    expect(getLanguageDisplayName('hrv')).toBe('Hrvatski');
    expect(getLanguageDisplayName('ice')).toBe('Íslenska');
    expect(getLanguageDisplayName('lit')).toBe('Lietuvių');
    expect(getLanguageDisplayName('lav')).toBe('Latviešu');
    expect(getLanguageDisplayName('mac')).toBe('Македонски');
    expect(getLanguageDisplayName('may')).toBe('Bahasa Melayu');
    expect(getLanguageDisplayName('slv')).toBe('Slovenščina');
    expect(getLanguageDisplayName('srp')).toBe('Srpski');
  });

  it('should handle uppercase and whitespace', () => {
    expect(getLanguageDisplayName(' ENG ')).toBe('English');
    expect(getLanguageDisplayName('HEB')).toBe('עברית');
    expect(getLanguageDisplayName('SPA')).toBe('Español');
  });

  it('should handle fallback for unknown or empty codes gracefully', () => {
    expect(getLanguageDisplayName('')).toBe('');
    expect(getLanguageDisplayName(null)).toBe('');
  });
});

describe('Client Subtitle Utilities - parseWebVtt & findActiveCueText', () => {
  const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.500
Hello, world!

2
00:00:05.000 --> 00:00:08.000
<i>This is a subtitle</i>

3
00:00:10.000 --> 00:00:15.000
שלום עולם
`;

  it('should parse WebVTT text into structured cues', () => {
    const cues = parseWebVtt(sampleVtt);
    expect(cues.length).toBe(3);
    expect(cues[0]).toEqual({
      start: 1,
      end: 4.5,
      text: 'Hello, world!',
    });
    expect(cues[1]).toEqual({
      start: 5,
      end: 8,
      text: 'This is a subtitle',
    });
  });

  it('should find active cue text based on current playback time', () => {
    const cues = parseWebVtt(sampleVtt);
    expect(findActiveCueText(cues, 2)).toBe('Hello, world!');
    expect(findActiveCueText(cues, 6)).toBe('This is a subtitle');
    expect(findActiveCueText(cues, 9)).toBe('');
    expect(findActiveCueText(cues, 12)).toBe('שלום עולם');
  });

  it('should detect RTL text correctly', () => {
    expect(isRtlText('Hello')).toBe(false);
    expect(isRtlText('שלום עולם')).toBe(true);
    expect(isRtlText('مرحبا بالعالم')).toBe(true);
  });
});
