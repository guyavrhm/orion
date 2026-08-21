/**
 * Types and interfaces for external API clients:
 * Cinemeta, Metahub, Torrent Provider, and OpenSubtitles.
 */

// ==========================================
// 1. Cinemeta API Models
// ==========================================

export interface CinemetaVideo {
  id: string;
  name?: string;
  title?: string;
  season: number;
  episode: number;
  number?: number;
  firstAired?: string;
  released?: string;
  tvdb_id?: number | string | null;
  rating?: string | number | null;
  overview?: string;
  description?: string;
  thumbnail?: string;
  runtime?: number | string | null;
  is_downloaded?: boolean;
}

export interface CinemetaMeta {
  id: string;
  imdb_id?: string;
  type: 'movie' | 'series';
  name?: string;
  title?: string;
  year?: string;
  released?: string;
  genres?: string[];
  genre?: string[];
  poster?: string;
  background?: string;
  logo?: string;
  imdbRating?: string;
  runtime?: string | number;
  description?: string;
  awards?: string;
  cast?: string[] | string;
  director?: string[] | string;
  writer?: string[] | string;
  country?: string;
  status?: string;
  dvdRelease?: string;
  tvdb_id?: number | string | null;
  moviedb_id?: number | string | null;
  popularity?: number | null;
  videos?: CinemetaVideo[];
}

export interface CinemetaCatalogResponse {
  metas: CinemetaMeta[];
}

export interface CinemetaDetailResponse {
  meta: CinemetaMeta;
}

// ==========================================
// 2. Metahub API Models
// ==========================================

export interface MetahubEpisode {
  id?: string;
  name?: string;
  title?: string;
  season: number;
  episode: number;
  number?: number;
  thumbnail?: string;
  overview?: string;
  description?: string;
  released?: string;
  rating?: string | number;
  tvdb_id?: number | string;
  runtime?: number | string;
}

export interface MetahubItem {
  id: string;
  imdb_id?: string;
  name?: string;
  title?: string;
  type?: 'movie' | 'series';
  year?: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  genres?: string[];
  genre?: string[];
  [key: string]: unknown;
}

export type MetahubResponse = MetahubItem[];

// ==========================================
// 3. Torrent Provider Models
// ==========================================

export interface StreamInfo {
  quality: string;
  size: string;
  sizeGB: number;
  peers: number;
  title: string;
  hash: string;
  fileIdx?: number;
  codec?: 'h264' | 'hevc' | 'av1' | 'other';
}

export interface ParsedTorrentCandidate {
  hash: string;
  magnetUrl: string;
  fileIdx?: number;
  quality: string;
  sizeBytes: number;
  title: string;
  peers?: number;
  peakSpeedKB?: number;
  codec?: 'h264' | 'hevc' | 'av1' | 'other';
}

// ==========================================
// 4. OpenSubtitles API Models
// ==========================================

export interface OpenSubtitlesRawItem {
  id?: string;
  idSubMovieHash?: string;
  idSubImdb?: string;
  lang: string;
  m?: string;
  url: string;
  format?: string;
  encoding?: string;
  fps?: number;
  [key: string]: unknown;
}

export interface OpenSubtitleItem {
  id: string;
  idSubMovieHash?: string;
  idSubImdb?: string;
  lang: string;
  m?: string;
  matchType?: string;
  url: string;
  format: string;
  encoding?: string;
  fps?: number;
  [key: string]: unknown;
}

export interface OpenSubtitlesResponse {
  subtitles?: OpenSubtitleItem[];
}
