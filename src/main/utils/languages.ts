/**
 * Static linguistic datasets, lookup tables, and ISO language mappings.
 */

/**
 * Common Right-to-Left (RTL) language codes.
 */
export const RTL_LANGS: readonly string[] = Object.freeze([
  'heb', 'he',
  'ara', 'ar',
  'fas', 'per', 'fa',
  'urd', 'ur',
  'yid', 'yi',
  'pus', 'ps',
  'kur', 'ku'
]);

/**
 * Mapping of language codes (ISO 639-1, 639-2/B, 639-2/T), localized strings,
 * and common stream aliases to canonical 3-letter ISO 639-2 codes.
 */
export const SUBTITLE_LANG_MAP: Record<string, string> = {
  'eng': 'eng', 'en': 'eng', 'english': 'eng',
  'spa': 'spa', 'es': 'spa', 'spanish': 'spa', 'castilian': 'spa', 'espanol': 'spa', 'español': 'spa',
  'fre': 'fre', 'fra': 'fre', 'fr': 'fre', 'french': 'fre', 'francais': 'fre', 'français': 'fre',
  'ger': 'ger', 'deu': 'ger', 'de': 'ger', 'german': 'ger', 'deutsch': 'ger',
  'ita': 'ita', 'it': 'ita', 'italian': 'ita', 'italiano': 'ita',
  'por': 'por', 'pt': 'por', 'portuguese': 'por', 'portugues': 'por', 'português': 'por', 'brazilian': 'por', 'pt-br': 'por', 'pt-pt': 'por',
  'rus': 'rus', 'ru': 'rus', 'russian': 'rus', 'russkiy': 'rus',
  'jpn': 'jpn', 'ja': 'jpn', 'japanese': 'jpn', 'nihongo': 'jpn',
  'kor': 'kor', 'ko': 'kor', 'korean': 'kor', 'hangul': 'kor',
  'chi': 'chi', 'zho': 'chi', 'zh': 'chi', 'chinese': 'chi', 'mandarin': 'chi', 'cantonese': 'chi', 'zh-cn': 'chi', 'zh-tw': 'chi', 'zh-hk': 'chi', 'zh-hans': 'chi', 'zh-hant': 'chi',
  'ara': 'ara', 'ar': 'ara', 'arabic': 'ara',
  'hin': 'hin', 'hi': 'hin', 'hindi': 'hin',
  'tur': 'tur', 'tr': 'tur', 'turkish': 'tur', 'türkçe': 'tur',
  'heb': 'heb', 'he': 'heb', 'hebrew': 'heb', 'iw': 'heb',
  'vie': 'vie', 'vi': 'vie', 'vietnamese': 'vie', 'tieng viet': 'vie', 'tiếng việt': 'vie',
  'pol': 'pol', 'pl': 'pol', 'polish': 'pol', 'polski': 'pol',
  'dut': 'dut', 'nld': 'dut', 'nl': 'dut', 'dutch': 'dut', 'nederlands': 'dut', 'flemish': 'dut',
  'swe': 'swe', 'sv': 'swe', 'swedish': 'swe', 'svenska': 'swe',
  'nor': 'nor', 'no': 'nor', 'nob': 'nor', 'nno': 'nor', 'norwegian': 'nor', 'norsk': 'nor',
  'dan': 'dan', 'da': 'dan', 'danish': 'dan', 'dansk': 'dan',
  'fin': 'fin', 'fi': 'fin', 'finnish': 'fin', 'suomi': 'fin',
  'gre': 'gre', 'ell': 'gre', 'el': 'gre', 'greek': 'gre',
  'cze': 'cze', 'ces': 'cze', 'cs': 'cze', 'czech': 'cze',
  'hun': 'hun', 'hu': 'hun', 'hungarian': 'hun', 'magyar': 'hun',
  'rum': 'rum', 'ron': 'rum', 'ro': 'rum', 'romanian': 'rum',
  'ukr': 'ukr', 'uk': 'ukr', 'ukrainian': 'ukr',
  'tha': 'tha', 'th': 'tha', 'thai': 'tha',
  'ind': 'ind', 'id': 'ind', 'indonesian': 'ind', 'bahasa indonesia': 'ind',
  'per': 'per', 'fas': 'per', 'fa': 'per', 'persian': 'per', 'farsi': 'per',
  'hrv': 'hrv', 'hr': 'hrv', 'croatian': 'hrv', 'hrvatski': 'hrv',
  'ice': 'ice', 'isl': 'ice', 'is': 'ice', 'icelandic': 'ice', 'islenska': 'ice', 'íslenska': 'ice',
  'lit': 'lit', 'lt': 'lit', 'lithuanian': 'lit', 'lietuviu': 'lit', 'lietuvių': 'lit',
  'lav': 'lav', 'lv': 'lav', 'latvian': 'lav', 'latviesu': 'lav', 'latviešu': 'lav',
  'mac': 'mac', 'mkd': 'mac', 'mk': 'mac', 'macedonian': 'mac', 'makedonski': 'mac',
  'may': 'may', 'msa': 'may', 'ms': 'may', 'malay': 'may', 'bahasa melayu': 'may',
  'slv': 'slv', 'sl': 'slv', 'slovenian': 'slv', 'slovenski': 'slv', 'slovenščina': 'slv',
  'srp': 'srp', 'scc': 'srp', 'sr': 'srp', 'serbian': 'srp', 'srpski': 'srp', 'montenegrin': 'srp', 'cnr': 'srp'
};

/**
 * Country-to-language mappings for major global film and television producing nations.
 * Used during audio track probing and transcoding to select authentic native audio streams.
 */
export const countryToLanguageMap: Record<string, string[]> = {
  // English-speaking
  'united states': ['eng', 'en', 'english', 'spa', 'es', 'spanish'],
  'usa': ['eng', 'en', 'english', 'spa', 'es', 'spanish'],
  'us': ['eng', 'en', 'english', 'spa', 'es', 'spanish'],
  'united states of america': ['eng', 'en', 'english', 'spa', 'es', 'spanish'],
  'america': ['eng', 'en', 'english', 'spa', 'es', 'spanish'],
  'united kingdom': ['eng', 'en', 'english'],
  'uk': ['eng', 'en', 'english'],
  'great britain': ['eng', 'en', 'english'],
  'england': ['eng', 'en', 'english'],
  'scotland': ['eng', 'en', 'english'],
  'canada': ['eng', 'en', 'english', 'fre', 'fra', 'fr', 'french'],
  'australia': ['eng', 'en', 'english'],
  'new zealand': ['eng', 'en', 'english'],
  'ireland': ['eng', 'en', 'english'],

  // Spanish-speaking
  'spain': ['spa', 'es', 'spanish'],
  'españa': ['spa', 'es', 'spanish'],
  'mexico': ['spa', 'es', 'spanish'],
  'méxico': ['spa', 'es', 'spanish'],
  'argentina': ['spa', 'es', 'spanish'],
  'colombia': ['spa', 'es', 'spanish'],
  'chile': ['spa', 'es', 'spanish'],
  'cuba': ['spa', 'es', 'spanish'],
  'peru': ['spa', 'es', 'spanish'],

  // French-speaking
  'france': ['fre', 'fra', 'fr', 'french'],
  'belgium': ['fre', 'fra', 'fr', 'french', 'dut', 'nld', 'nl', 'dutch'],
  'switzerland': ['ger', 'deu', 'de', 'german', 'fre', 'fra', 'fr', 'french', 'ita', 'it', 'italian'],

  // German-speaking
  'germany': ['ger', 'deu', 'de', 'german'],
  'deutschland': ['ger', 'deu', 'de', 'german'],
  'austria': ['ger', 'deu', 'de', 'german'],

  // Italian
  'italy': ['ita', 'it', 'italian'],
  'italia': ['ita', 'it', 'italian'],

  // Portuguese
  'brazil': ['por', 'pt', 'portuguese', 'brazilian'],
  'brasil': ['por', 'pt', 'portuguese', 'brazilian'],
  'portugal': ['por', 'pt', 'portuguese'],

  // East Asia
  'japan': ['jpn', 'ja', 'japanese'],
  'south korea': ['kor', 'ko', 'korean'],
  'korea': ['kor', 'ko', 'korean'],
  'china': ['chi', 'zho', 'zh', 'chinese', 'mandarin'],
  'taiwan': ['chi', 'zho', 'zh', 'chinese', 'mandarin'],
  'hong kong': ['chi', 'zho', 'zh', 'chinese', 'cantonese', 'eng', 'en', 'english'],

  // South & Southeast Asia
  'india': ['hin', 'hi', 'hindi', 'eng', 'en', 'english', 'tam', 'ta', 'tamil', 'tel', 'te', 'telugu'],
  'thailand': ['tha', 'th', 'thai'],
  'vietnam': ['vie', 'vi', 'vietnamese'],
  'indonesia': ['ind', 'id', 'indonesian'],
  'philippines': ['eng', 'en', 'english', 'tgl', 'fil', 'tl', 'tagalog'],

  // Northern Europe (Nordic)
  'sweden': ['swe', 'sv', 'swedish'],
  'norway': ['nor', 'no', 'nob', 'nno', 'norwegian'],
  'denmark': ['dan', 'da', 'danish'],
  'finland': ['fin', 'fi', 'finnish'],
  'iceland': ['ice', 'is', 'icelandic'],
  'netherlands': ['dut', 'nld', 'nl', 'dutch'],
  'holland': ['dut', 'nld', 'nl', 'dutch'],

  // Eastern & Central Europe
  'russia': ['rus', 'ru', 'russian'],
  'russian federation': ['rus', 'ru', 'russian'],
  'soviet union': ['rus', 'ru', 'russian'],
  'ukraine': ['ukr', 'uk', 'ukrainian', 'rus', 'ru', 'russian'],
  'poland': ['pol', 'pl', 'polish'],
  'czech republic': ['cze', 'ces', 'cs', 'czech'],
  'czechia': ['cze', 'ces', 'cs', 'czech'],
  'hungary': ['hun', 'hu', 'hungarian'],
  'romania': ['rum', 'ron', 'ro', 'romanian'],
  'greece': ['gre', 'ell', 'el', 'greek'],
  'croatia': ['hrv', 'hr', 'croatian'],
  'slovenia': ['slv', 'sl', 'slovenian'],
  'slovenija': ['slv', 'sl', 'slovenian'],
  'serbia': ['srp', 'scc', 'sr', 'serbian'],
  'srbija': ['srp', 'scc', 'sr', 'serbian'],
  'montenegro': ['srp', 'sr', 'serbian'],
  'north macedonia': ['mac', 'mkd', 'mk', 'macedonian'],
  'macedonia': ['mac', 'mkd', 'mk', 'macedonian'],
  'lithuania': ['lit', 'lt', 'lithuanian'],
  'latvia': ['lav', 'lv', 'latvian'],
  'malaysia': ['may', 'msa', 'ms', 'malay', 'eng', 'en', 'english'],

  // Middle East & Turkey
  'turkey': ['tur', 'tr', 'turkish'],
  'türkiye': ['tur', 'tr', 'turkish'],
  'iran': ['per', 'fas', 'fa', 'persian', 'farsi'],
  'egypt': ['ara', 'ar', 'arabic'],
  'israel': ['heb', 'he', 'hebrew', 'ara', 'ar', 'arabic', 'eng', 'en', 'english'],
  'saudi arabia': ['ara', 'ar', 'arabic'],
  'united arab emirates': ['ara', 'ar', 'arabic', 'eng', 'en', 'english'],
  'uae': ['ara', 'ar', 'arabic', 'eng', 'en', 'english']
};
