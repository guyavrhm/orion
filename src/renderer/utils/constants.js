/**
 * Frontend constants and mappings.
 */

/**
 * Mapping of canonical ISO 639-2 subtitle language codes to English display names.
 */
export const LANG_MAP = Object.freeze({
  eng: 'English',
  spa: 'Spanish',
  fre: 'French',
  ger: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  rus: 'Russian',
  jpn: 'Japanese',
  kor: 'Korean',
  chi: 'Chinese',
  ara: 'Arabic',
  hin: 'Hindi',
  tur: 'Turkish',
  heb: 'Hebrew',
  vie: 'Vietnamese',
  pol: 'Polish',
  dut: 'Dutch',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  gre: 'Greek',
  cze: 'Czech',
  hun: 'Hungarian',
  rum: 'Romanian',
  ukr: 'Ukrainian',
  tha: 'Thai',
  ind: 'Indonesian',
  per: 'Persian',
  hrv: 'Croatian',
  ice: 'Icelandic',
  lit: 'Lithuanian',
  lav: 'Latvian',
  mac: 'Macedonian',
  may: 'Malay',
  slv: 'Slovenian',
  srp: 'Serbian'
});

export const ErrorCode = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  MEDIA_NOT_DOWNLOADED: 'MEDIA_NOT_DOWNLOADED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NO_STREAMS_FOUND: 'NO_STREAMS_FOUND',
  SERVICE_ERROR: 'SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});
