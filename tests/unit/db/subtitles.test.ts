import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../../src/main/db/index.js';
import {
  subtitlesRepo,
  getSubtitlePreference,
  saveSubtitlePreference,
  getLocalSubtitles
} from '../../../src/main/db/subtitles.js';
import * as helpers from '../../../src/main/utils/helpers.js';

describe('db/subtitles - SubtitlesRepo', () => {
  beforeEach(() => {
    db.exec('DELETE FROM subtitle_preferences;');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Subtitle Preferences', () => {
    it('should return null when no subtitle preference is set', () => {
      const pref = getSubtitlePreference('tt0137523');
      expect(pref).toBeNull();
    });

    it('should save and retrieve a preferred subtitle language', () => {
      saveSubtitlePreference('tt0137523', 'spa');
      const pref = getSubtitlePreference('tt0137523');
      expect(pref).toBe('spa');
    });

    it('should update existing preference when saveSubtitlePreference is called again', () => {
      saveSubtitlePreference('tt0137523', 'eng');
      expect(getSubtitlePreference('tt0137523')).toBe('eng');

      saveSubtitlePreference('tt0137523', 'fre');
      expect(getSubtitlePreference('tt0137523')).toBe('fre');
    });

    it('should allow setting subtitle preference to null (disabled subtitles)', () => {
      saveSubtitlePreference('tt0137523', 'eng');
      saveSubtitlePreference('tt0137523', null);
      expect(getSubtitlePreference('tt0137523')).toBeNull();
    });

    it('should export repository methods under subtitlesRepo object', () => {
      expect(subtitlesRepo.getSubtitlePreference).toBeDefined();
      expect(subtitlesRepo.saveSubtitlePreference).toBeDefined();
      expect(subtitlesRepo.getLocalSubtitles).toBeDefined();
    });
  });

  describe('getLocalSubtitles Scanning', () => {
    const fileId = 'tt_subs_movie_test';
    let realBaseDir: string;
    let realSubsDir: string;

    beforeEach(() => {
      const dirs = helpers.getMediaDirs(fileId);
      if (dirs) {
        realBaseDir = dirs.baseDir;
        realSubsDir = dirs.subtitlesDir;
        if (fs.existsSync(realBaseDir)) {
          fs.rmSync(realBaseDir, { recursive: true, force: true });
        }
      }
    });

    afterEach(() => {
      if (realBaseDir && fs.existsSync(realBaseDir)) {
        fs.rmSync(realBaseDir, { recursive: true, force: true });
      }
    });

    it('should return empty array if subtitles directory does not exist', () => {
      const tracks = getLocalSubtitles(fileId);
      expect(tracks).toEqual([]);
    });

    it('should return empty array if subtitles directory is empty', () => {
      fs.mkdirSync(realSubsDir, { recursive: true });
      const tracks = getLocalSubtitles(fileId);
      expect(tracks).toEqual([]);
    });

    it('should discover local subtitle files and format track URLs', () => {
      fs.mkdirSync(realSubsDir, { recursive: true });
      
      const vttFileName = `${fileId}_eng_1.vtt`;
      fs.writeFileSync(path.join(realSubsDir, vttFileName), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHello');

      const tracks = getLocalSubtitles(fileId);
      expect(tracks).toHaveLength(1);
      expect(tracks[0]).toEqual({
        id: `${fileId}_eng_1`,
        lang: 'eng',
        url: `/subtitles/${fileId}/${vttFileName}`,
        score: null
      });
    });

    it('should read scores.json and pick the highest scoring subtitle track for a language', () => {
      fs.mkdirSync(realSubsDir, { recursive: true });

      const track1 = `${fileId}_eng_track1.vtt`;
      const track2 = `${fileId}_eng_track2.vtt`;
      const track3 = `${fileId}_spa_track1.vtt`;

      fs.writeFileSync(path.join(realSubsDir, track1), 'WEBVTT');
      fs.writeFileSync(path.join(realSubsDir, track2), 'WEBVTT');
      fs.writeFileSync(path.join(realSubsDir, track3), 'WEBVTT');

      const scores = {
        [`${fileId}_eng_track1`]: 50,
        [`${fileId}_eng_track2`]: 95, // Higher score for English
        [`${fileId}_spa_track1`]: 80
      };
      fs.writeFileSync(path.join(realSubsDir, 'scores.json'), JSON.stringify(scores));

      const tracks = getLocalSubtitles(fileId);
      
      // Should pick track2 for English (highest score) and track3 for Spanish
      const engTrack = tracks.find(t => t.lang === 'eng');
      const spaTrack = tracks.find(t => t.lang === 'spa');

      expect(engTrack).toBeDefined();
      expect(engTrack?.id).toBe(`${fileId}_eng_track2`);
      expect(engTrack?.score).toBe(95);

      expect(spaTrack).toBeDefined();
      expect(spaTrack?.id).toBe(`${fileId}_spa_track1`);
      expect(spaTrack?.score).toBe(80);
    });

    it('should handle corrupt scores.json gracefully and fall back to score: null', () => {
      fs.mkdirSync(realSubsDir, { recursive: true });

      const track1 = `${fileId}_eng_track1.vtt`;
      fs.writeFileSync(path.join(realSubsDir, track1), 'WEBVTT');
      fs.writeFileSync(path.join(realSubsDir, 'scores.json'), 'INVALID_JSON{{{');

      const tracks = getLocalSubtitles(fileId);
      expect(tracks).toHaveLength(1);
      expect(tracks[0].id).toBe(`${fileId}_eng_track1`);
      expect(tracks[0].score).toBeNull();
    });

    it('should ignore subtitles belonging to other media IDs', () => {
      fs.mkdirSync(realSubsDir, { recursive: true });

      fs.writeFileSync(path.join(realSubsDir, `other_id_eng_1.vtt`), 'WEBVTT');

      const tracks = getLocalSubtitles(fileId);
      expect(tracks).toHaveLength(0);
    });
  });
});
