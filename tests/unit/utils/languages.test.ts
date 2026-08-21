import { describe, it, expect } from 'vitest';
import {
  RTL_LANGS,
  SUBTITLE_LANG_MAP,
  countryToLanguageMap
} from '../../../src/main/utils/languages.js';

describe('utils/languages', () => {
  describe('RTL_LANGS', () => {
    it('should be a frozen immutable array', () => {
      expect(Array.isArray(RTL_LANGS)).toBe(true);
      expect(Object.isFrozen(RTL_LANGS)).toBe(true);
    });

    it('should contain all expected Right-to-Left (RTL) language codes', () => {
      const expectedCodes = [
        'heb', 'he',
        'ara', 'ar',
        'fas', 'per', 'fa',
        'urd', 'ur',
        'yid', 'yi',
        'pus', 'ps',
        'kur', 'ku'
      ];
      for (const code of expectedCodes) {
        expect(RTL_LANGS).toContain(code);
      }
    });

    it('should not contain Left-to-Right (LTR) languages', () => {
      const ltrCodes = ['eng', 'en', 'spa', 'es', 'fre', 'fr', 'ger', 'de', 'jpn', 'ja', 'chi', 'zh', 'rus', 'ru'];
      for (const code of ltrCodes) {
        expect(RTL_LANGS).not.toContain(code);
      }
    });
  });

  describe('SUBTITLE_LANG_MAP', () => {
    it('should correctly map 2-letter ISO 639-1 codes to 3-letter canonical codes', () => {
      const iso639_1_mappings: Record<string, string> = {
        en: 'eng',
        es: 'spa',
        fr: 'fre',
        de: 'ger',
        it: 'ita',
        pt: 'por',
        ru: 'rus',
        ja: 'jpn',
        ko: 'kor',
        zh: 'chi',
        ar: 'ara',
        hi: 'hin',
        tr: 'tur',
        he: 'heb',
        iw: 'heb', // Legacy Hebrew code
        vi: 'vie',
        pl: 'pol',
        nl: 'dut',
        sv: 'swe',
        no: 'nor',
        da: 'dan',
        fi: 'fin',
        el: 'gre',
        cs: 'cze',
        hu: 'hun',
        ro: 'rum',
        uk: 'ukr',
        th: 'tha',
        id: 'ind',
        fa: 'per',
        hr: 'hrv',
        is: 'ice',
        lt: 'lit',
        lv: 'lav',
        mk: 'mac',
        ms: 'may',
        sl: 'slv',
        sr: 'srp'
      };

      for (const [code, expected] of Object.entries(iso639_1_mappings)) {
        expect(SUBTITLE_LANG_MAP[code]).toBe(expected);
      }
    });

    it('should correctly map alternate ISO 639-2 (bibliographic / terminology) variants', () => {
      const iso639_2_variants: Record<string, string> = {
        fra: 'fre', // French (fre/fra)
        deu: 'ger', // German (ger/deu)
        zho: 'chi', // Chinese (chi/zho)
        nld: 'dut', // Dutch (dut/nld)
        ell: 'gre', // Greek (gre/ell)
        ces: 'cze', // Czech (cze/ces)
        ron: 'rum', // Romanian (rum/ron)
        fas: 'per', // Persian (per/fas)
        isl: 'ice', // Icelandic (ice/isl)
        mkd: 'mac', // Macedonian (mac/mkd)
        msa: 'may', // Malay (may/msa)
        scc: 'srp'  // Serbian (srp/scc)
      };

      for (const [variant, canonical] of Object.entries(iso639_2_variants)) {
        expect(SUBTITLE_LANG_MAP[variant]).toBe(canonical);
      }
    });

    it('should correctly map full English language names to canonical codes', () => {
      const fullNames: Record<string, string> = {
        english: 'eng',
        spanish: 'spa',
        castilian: 'spa',
        french: 'fre',
        german: 'ger',
        italian: 'ita',
        portuguese: 'por',
        russian: 'rus',
        japanese: 'jpn',
        korean: 'kor',
        chinese: 'chi',
        mandarin: 'chi',
        cantonese: 'chi',
        arabic: 'ara',
        hindi: 'hin',
        turkish: 'tur',
        hebrew: 'heb',
        vietnamese: 'vie',
        polish: 'pol',
        dutch: 'dut',
        flemish: 'dut',
        swedish: 'swe',
        norwegian: 'nor',
        danish: 'dan',
        finnish: 'fin',
        greek: 'gre',
        czech: 'cze',
        hungarian: 'hun',
        romanian: 'rum',
        ukrainian: 'ukr',
        thai: 'tha',
        indonesian: 'ind',
        persian: 'per',
        farsi: 'per',
        croatian: 'hrv',
        icelandic: 'ice',
        lithuanian: 'lit',
        latvian: 'lav',
        macedonian: 'mac',
        malay: 'may',
        slovenian: 'slv',
        serbian: 'srp',
        montenegrin: 'srp'
      };

      for (const [name, canonical] of Object.entries(fullNames)) {
        expect(SUBTITLE_LANG_MAP[name]).toBe(canonical);
      }
    });

    it('should map localized and dialect representations to canonical codes', () => {
      const localized: Record<string, string> = {
        'español': 'spa',
        'espanol': 'spa',
        'français': 'fre',
        'francais': 'fre',
        'deutsch': 'ger',
        'italiano': 'ita',
        'português': 'por',
        'portugues': 'por',
        'brazilian': 'por',
        'pt-br': 'por',
        'pt-pt': 'por',
        'russkiy': 'rus',
        'nihongo': 'jpn',
        'hangul': 'kor',
        'zh-cn': 'chi',
        'zh-tw': 'chi',
        'zh-hk': 'chi',
        'zh-hans': 'chi',
        'zh-hant': 'chi',
        'türkçe': 'tur',
        'tiếng việt': 'vie',
        'tieng viet': 'vie',
        'polski': 'pol',
        'nederlands': 'dut',
        'svenska': 'swe',
        'norsk': 'nor',
        'nob': 'nor',
        'nno': 'nor',
        'dansk': 'dan',
        'suomi': 'fin',
        'magyar': 'hun',
        'hrvatski': 'hrv',
        'íslenska': 'ice',
        'islenska': 'ice',
        'lietuvių': 'lit',
        'lietuviu': 'lit',
        'latviešu': 'lav',
        'latviesu': 'lav',
        'makedonski': 'mac',
        'bahasa indonesia': 'ind',
        'bahasa melayu': 'may',
        'slovenski': 'slv',
        'slovenščina': 'slv',
        'srpski': 'srp',
        'cnr': 'srp'
      };

      for (const [loc, canonical] of Object.entries(localized)) {
        expect(SUBTITLE_LANG_MAP[loc]).toBe(canonical);
      }
    });

    it('should map canonical 3-letter ISO codes to themselves', () => {
      const canonicalCodes = [
        'eng', 'spa', 'fre', 'ger', 'ita', 'por', 'rus', 'jpn', 'kor', 'chi',
        'ara', 'hin', 'tur', 'heb', 'vie', 'pol', 'dut', 'swe', 'nor', 'dan',
        'fin', 'gre', 'cze', 'hun', 'rum', 'ukr', 'tha', 'ind', 'per', 'hrv',
        'ice', 'lit', 'lav', 'mac', 'may', 'slv', 'srp'
      ];

      for (const code of canonicalCodes) {
        expect(SUBTITLE_LANG_MAP[code]).toBe(code);
      }
    });

    it('should return undefined for unknown or arbitrary language keys', () => {
      expect(SUBTITLE_LANG_MAP['klingon']).toBeUndefined();
      expect(SUBTITLE_LANG_MAP['valyrian']).toBeUndefined();
      expect(SUBTITLE_LANG_MAP['xyz']).toBeUndefined();
      expect(SUBTITLE_LANG_MAP['']).toBeUndefined();
    });
  });

  describe('countryToLanguageMap', () => {
    it('should map English-speaking countries and include relevant codes', () => {
      expect(countryToLanguageMap['united states']).toEqual(expect.arrayContaining(['eng', 'en', 'english', 'spa']));
      expect(countryToLanguageMap['usa']).toEqual(expect.arrayContaining(['eng', 'en', 'english']));
      expect(countryToLanguageMap['uk']).toEqual(expect.arrayContaining(['eng', 'en', 'english']));
      expect(countryToLanguageMap['great britain']).toEqual(expect.arrayContaining(['eng', 'en', 'english']));
      expect(countryToLanguageMap['australia']).toEqual(expect.arrayContaining(['eng', 'en', 'english']));
      expect(countryToLanguageMap['canada']).toEqual(expect.arrayContaining(['eng', 'en', 'english', 'fre', 'french']));
    });

    it('should map multi-lingual nations correctly', () => {
      // Switzerland has German, French, Italian
      expect(countryToLanguageMap['switzerland']).toEqual(expect.arrayContaining(['ger', 'fre', 'ita']));
      // Belgium has French and Dutch
      expect(countryToLanguageMap['belgium']).toEqual(expect.arrayContaining(['fre', 'dut']));
      // India has Hindi, English, Tamil, Telugu
      expect(countryToLanguageMap['india']).toEqual(expect.arrayContaining(['hin', 'eng', 'tam', 'tel']));
      // Israel has Hebrew, Arabic, English
      expect(countryToLanguageMap['israel']).toEqual(expect.arrayContaining(['heb', 'ara', 'eng']));
      // Philippines has English and Tagalog
      expect(countryToLanguageMap['philippines']).toEqual(expect.arrayContaining(['eng', 'tgl', 'fil']));
      // Ukraine has Ukrainian and Russian
      expect(countryToLanguageMap['ukraine']).toEqual(expect.arrayContaining(['ukr', 'rus']));
      // Hong Kong has Chinese and English
      expect(countryToLanguageMap['hong kong']).toEqual(expect.arrayContaining(['chi', 'eng', 'cantonese']));
    });

    it('should map Asian film producing nations accurately', () => {
      expect(countryToLanguageMap['japan']).toEqual(expect.arrayContaining(['jpn', 'ja', 'japanese']));
      expect(countryToLanguageMap['south korea']).toEqual(expect.arrayContaining(['kor', 'ko', 'korean']));
      expect(countryToLanguageMap['korea']).toEqual(expect.arrayContaining(['kor', 'ko', 'korean']));
      expect(countryToLanguageMap['china']).toEqual(expect.arrayContaining(['chi', 'zho', 'zh', 'chinese']));
      expect(countryToLanguageMap['taiwan']).toEqual(expect.arrayContaining(['chi', 'mandarin']));
      expect(countryToLanguageMap['thailand']).toEqual(expect.arrayContaining(['tha', 'th', 'thai']));
      expect(countryToLanguageMap['vietnam']).toEqual(expect.arrayContaining(['vie', 'vi', 'vietnamese']));
      expect(countryToLanguageMap['indonesia']).toEqual(expect.arrayContaining(['ind', 'id', 'indonesian']));
    });

    it('should map European film producing nations accurately', () => {
      expect(countryToLanguageMap['france']).toEqual(expect.arrayContaining(['fre', 'fra', 'french']));
      expect(countryToLanguageMap['germany']).toEqual(expect.arrayContaining(['ger', 'deu', 'german']));
      expect(countryToLanguageMap['italy']).toEqual(expect.arrayContaining(['ita', 'it', 'italian']));
      expect(countryToLanguageMap['spain']).toEqual(expect.arrayContaining(['spa', 'es', 'spanish']));
      expect(countryToLanguageMap['sweden']).toEqual(expect.arrayContaining(['swe', 'sv', 'swedish']));
      expect(countryToLanguageMap['norway']).toEqual(expect.arrayContaining(['nor', 'no', 'norwegian']));
      expect(countryToLanguageMap['denmark']).toEqual(expect.arrayContaining(['dan', 'da', 'danish']));
      expect(countryToLanguageMap['finland']).toEqual(expect.arrayContaining(['fin', 'fi', 'finnish']));
      expect(countryToLanguageMap['poland']).toEqual(expect.arrayContaining(['pol', 'pl', 'polish']));
      expect(countryToLanguageMap['russia']).toEqual(expect.arrayContaining(['rus', 'ru', 'russian']));
    });

    it('should map Middle Eastern nations accurately', () => {
      expect(countryToLanguageMap['turkey']).toEqual(expect.arrayContaining(['tur', 'tr', 'turkish']));
      expect(countryToLanguageMap['türkiye']).toEqual(expect.arrayContaining(['tur', 'tr', 'turkish']));
      expect(countryToLanguageMap['iran']).toEqual(expect.arrayContaining(['per', 'fas', 'persian', 'farsi']));
      expect(countryToLanguageMap['egypt']).toEqual(expect.arrayContaining(['ara', 'ar', 'arabic']));
      expect(countryToLanguageMap['saudi arabia']).toEqual(expect.arrayContaining(['ara', 'ar', 'arabic']));
      expect(countryToLanguageMap['uae']).toEqual(expect.arrayContaining(['ara', 'ar', 'arabic', 'eng']));
    });
  });
});
