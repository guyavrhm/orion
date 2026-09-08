import { describe, it, expect } from 'vitest';
import { parseTimestamp, parseWebVtt, findActiveCueText, cleanSubtitleText, isRtlText } from '../../../src/client/utils/subtitles.js';

describe('client subtitles utility', () => {
  describe('parseTimestamp', () => {
    it('parses standard HH:MM:SS.mmm format', () => {
      expect(parseTimestamp('01:23:45.678')).toBe(1 * 3600 + 23 * 60 + 45.678);
    });

    it('parses SRT comma separator HH:MM:SS,mmm', () => {
      expect(parseTimestamp('00:01:20,500')).toBe(80.5);
    });

    it('parses MM:SS.mmm format', () => {
      expect(parseTimestamp('02:15.250')).toBe(135.25);
    });

    it('returns 0 for empty or invalid string', () => {
      expect(parseTimestamp('')).toBe(0);
    });
  });

  describe('cleanSubtitleText', () => {
    it('removes HTML and WebVTT tags', () => {
      expect(cleanSubtitleText('<i>Hello</i> <b>world</b>')).toBe('Hello world');
      expect(cleanSubtitleText('<v Speaker>Welcome back!</v>')).toBe('Welcome back!');
      expect(cleanSubtitleText('<c.yellow>Yellow text</c>')).toBe('Yellow text');
    });

    it('removes SSA and ASS override tags like {\\an8}', () => {
      expect(cleanSubtitleText('{\\an8}Look at the top of the screen')).toBe('Look at the top of the screen');
      expect(cleanSubtitleText('{\\pos(192,200)\\c&H00FFFF&}Colored text{\\r}')).toBe('Colored text');
      expect(cleanSubtitleText('{\\b1}Bold{\\b0} and {\\i1}Italic{\\i0}')).toBe('Bold and Italic');
    });

    it('decodes common HTML entities', () => {
      expect(cleanSubtitleText('You &amp; I &quot;Rock&quot; &#39;n&#39; Roll')).toBe('You & I "Rock" \'n\' Roll');
    });
  });

  describe('parseWebVtt', () => {
    it('parses standard WebVTT cues properly without zeroing end timestamp', () => {
      const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.000
Hello world!

2
00:00:05.500 --> 00:00:08.200 position:50% align:center
Second cue text
Line 2 of second cue
`;
      const cues = parseWebVtt(vtt);
      expect(cues).toHaveLength(2);
      expect(cues[0]).toEqual({
        start: 1,
        end: 4,
        text: 'Hello world!',
      });
      expect(cues[1]).toEqual({
        start: 5.5,
        end: 8.2,
        text: 'Second cue text\nLine 2 of second cue',
      });
    });

    it('handles VTT without numeric indices', () => {
      const vtt = `WEBVTT

00:01:10.000 --> 00:01:15.000
Unnumbered cue
`;
      const cues = parseWebVtt(vtt);
      expect(cues).toHaveLength(1);
      expect(cues[0].start).toBe(70);
      expect(cues[0].end).toBe(75);
      expect(cues[0].text).toBe('Unnumbered cue');
    });
  });

  describe('findActiveCueText', () => {
    const cues = [
      { start: 2, end: 5, text: 'First subtitle' },
      { start: 7, end: 10, text: 'Second subtitle' },
    ];

    it('returns empty string when before any cue', () => {
      expect(findActiveCueText(cues, 1)).toBe('');
    });

    it('matches active cue inside its interval', () => {
      expect(findActiveCueText(cues, 3)).toBe('First subtitle');
      expect(findActiveCueText(cues, 5)).toBe('First subtitle');
    });

    it('accounts for offset seconds', () => {
      // At currentTime 1.5 with +1s offset => 2.5 => matches cue 1
      expect(findActiveCueText(cues, 1.5, 1.0)).toBe('First subtitle');
    });
  });

  describe('isRtlText', () => {
    it('detects Hebrew text as RTL', () => {
      expect(isRtlText('שלום עולם')).toBe(true);
    });

    it('detects Arabic text as RTL', () => {
      expect(isRtlText('مرحبا بالعالم')).toBe(true);
    });

    it('returns false for Latin text', () => {
      expect(isRtlText('Hello World!')).toBe(false);
    });
  });
});
