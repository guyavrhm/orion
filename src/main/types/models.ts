/**
 * Database models, domain entities, and data transfer objects (DTOs)
 * for the Orion backend.
 */

import type { CinemetaVideo } from './clients.js';

// ==========================================
// 1. Raw SQLite Database Row Types
// ==========================================

export interface MovieMetadataRow {
  id: string;
  title: string | null;
  year: string | null;
  released: string | null;
  genres: string | null;
  poster: string | null;
  background: string | null;
  logo: string | null;
  imdb_rating: string | null;
  runtime: string | null;
  description: string | null;
  awards: string | null;
  cast: string | null;
  director: string | null;
  writer: string | null;
  country: string | null;
  dvdRelease: string | null;
  moviedb_id: number | null;
  popularity: number | null;
  last_fetched: number | null;
}

export interface ShowMetadataRow {
  id: string;
  title: string | null;
  year: string | null;
  released: string | null;
  genres: string | null;
  poster: string | null;
  background: string | null;
  logo: string | null;
  imdb_rating: string | null;
  runtime: string | null;
  description: string | null;
  awards: string | null;
  cast: string | null;
  director: string | null;
  writer: string | null;
  country: string | null;
  status: string | null;
  tvdb_id: number | null;
  moviedb_id: number | null;
  popularity: number | null;
  last_fetched: number | null;
}

export interface EpisodeMetadataRow {
  id: string;
  show_id: string;
  season: number;
  episode: number;
  name: string | null;
  description: string | null;
  thumbnail: string | null;
  released: string | null;
  rating: string | null;
  tvdb_id: number | null;
  runtime: number | null;
}

export interface MovieProgressRow {
  movie_id: string;
  timestamp: number;
  runtime: number;
  last_updated: number;
}

export interface EpisodeProgressRow {
  episode_id: string;
  timestamp: number;
  runtime: number;
  last_updated: number;
}

export interface MovieDownloadRow {
  movie_id: string;
  fileName: string | null;
  torrentHash: string | null;
  fileHash: string | null;
  fileIdx: number | null;
  quality: string | null;
  sizeBytes: number | null;
  downloadTime: number | null;
}

export interface EpisodeDownloadRow {
  episode_id: string;
  fileName: string | null;
  torrentHash: string | null;
  fileHash: string | null;
  fileIdx: number | null;
  quality: string | null;
  sizeBytes: number | null;
  downloadTime: number | null;
}

export interface SubtitlePreferenceRow {
  media_id: string;
  subtitle_lang: string | null;
}

// ==========================================
// 2. Domain Models (Reconstructed & Hydrated)
// ==========================================

export interface MovieMetadata {
  id: string;
  type: 'movie';
  name?: string;
  title?: string;
  year?: string;
  released?: string;
  genres: string[];
  poster?: string;
  background?: string;
  logo?: string;
  imdbRating?: string;
  runtime?: string | number;
  description?: string;
  awards?: string;
  cast: string[];
  director: string[];
  writer: string[];
  country?: string;
  dvdRelease?: string;
  moviedb_id?: number | null;
  popularity?: number | null;
}

export interface EpisodeMetadata {
  id: string;
  show_id?: string;
  name: string;
  season: number;
  episode: number;
  number?: number;
  firstAired?: string;
  released?: string;
  tvdb_id?: number | null;
  rating?: string | null;
  overview?: string;
  description?: string;
  thumbnail?: string;
  runtime?: number | null;
  is_downloaded?: boolean;
}

export interface ShowMetadata {
  id: string;
  type: 'series';
  name?: string;
  title?: string;
  year?: string;
  released?: string;
  genres: string[];
  poster?: string;
  background?: string;
  logo?: string;
  imdbRating?: string;
  runtime?: string | number;
  description?: string;
  awards?: string;
  cast: string[];
  director: string[];
  writer: string[];
  country?: string;
  status?: string;
  tvdb_id?: number | null;
  moviedb_id?: number | null;
  popularity?: number | null;
  videos: CinemetaVideo[];
}

export interface CachedMetadataResult {
  id: string;
  type: 'movie' | 'series';
  metadata: MovieMetadata | ShowMetadata | null;
  status?: string | null;
  last_fetched?: number | null;
}

// ==========================================
// 3. Progress Models
// ==========================================

export interface MovieProgress {
  id: string;
  timestamp: number;
  runtime: number;
  last_updated?: number | null;
  [key: string]: unknown;
}

export interface EpisodeProgressItem {
  season: number;
  episode: number;
  timestamp: number;
  runtime: number;
  last_updated?: number | null;
}

export interface EpisodeProgress {
  id: string;
  show_id: string;
  season: number;
  episode: number;
  timestamp: number;
  runtime: number;
  last_updated?: number | null;
}

export interface ShowProgress {
  id: string;
  last_season: number;
  last_episode: number;
  last_updated?: number | null;
  episodes: Record<string, EpisodeProgress>;
}

export type WatchProgress = MovieProgress | ShowProgress;

// ==========================================
// 4. Download Models
// ==========================================

export interface MovieDownload {
  movieId?: string;
  movie_id?: string;
  fileId?: string;
  id?: string;
  fileName: string | null;
  torrentHash: string | null;
  fileHash: string | null;
  fileIdx: number | null;
  quality: string | null;
  sizeBytes: number;
  downloadTime?: number | null;
  is_downloaded?: boolean;
}

export interface EpisodeDownload {
  episodeId?: string;
  episode_id?: string;
  fileId?: string;
  id?: string;
  fileName: string | null;
  torrentHash: string | null;
  fileHash: string | null;
  fileIdx: number | null;
  quality: string | null;
  sizeBytes: number;
  downloadTime?: number | null;
  is_downloaded?: boolean;
}

export interface DownloadEntry {
  fileId: string;
  id?: string;
  fileName: string | null;
  torrentHash: string | null;
  fileHash: string | null;
  fileIdx: number | null;
  quality: string | null;
  sizeBytes: number;
  downloadTime?: number | null;
  is_downloaded?: boolean;
}

// ==========================================
// 5. Subtitle Preference & Tracks
// ==========================================

export interface SubtitlePreference {
  media_id: string;
  subtitle_lang: string | null;
}

export interface LocalSubtitleTrack {
  id: string;
  lang: string;
  url: string;
  score: number | null;
}

// ==========================================
// 6. Database Insert / Update DTOs
// ==========================================

export interface MovieMetadataInsert {
  id: string;
  title?: string;
  year?: string;
  genres?: string;
  poster?: string;
  background?: string;
  logo?: string;
  imdb_rating?: string;
  runtime?: string;
  description?: string;
  awards?: string;
  cast?: string;
  director?: string;
  writer?: string;
  country?: string;
  dvdRelease?: string;
  moviedb_id?: number | null;
  popularity?: number | null;
  last_fetched?: number;
}

export interface ShowMetadataInsert {
  id: string;
  title?: string;
  year?: string;
  genres?: string;
  poster?: string;
  background?: string;
  logo?: string;
  imdb_rating?: string;
  runtime?: string;
  description?: string;
  awards?: string;
  cast?: string;
  director?: string;
  writer?: string;
  country?: string;
  status?: string;
  tvdb_id?: number | null;
  moviedb_id?: number | null;
  popularity?: number | null;
  last_fetched?: number;
}

export interface EpisodeMetadataInsert {
  id: string;
  show_id: string;
  season: number;
  episode: number;
  name: string;
  description?: string;
  thumbnail?: string;
  released?: string;
  rating?: string;
  tvdb_id?: number | null;
  runtime?: number;
}

export interface MovieProgressUpdate {
  timestamp?: number;
  runtime?: number;
}

export interface ShowProgressUpdate {
  timestamp?: number;
  last_season?: number;
  last_episode?: number;
  episodes?: Record<string, Partial<EpisodeProgress>>;
}

export interface MovieDownloadInsert {
  movie_id: string;
  fileName?: string | null;
  torrentHash?: string | null;
  fileHash?: string | null;
  fileIdx?: number | null;
  quality?: string | null;
  sizeBytes?: number;
  downloadTime?: number;
}

export interface EpisodeDownloadInsert {
  episode_id: string;
  fileName?: string | null;
  torrentHash?: string | null;
  fileHash?: string | null;
  fileIdx?: number | null;
  quality?: string | null;
  sizeBytes?: number;
  downloadTime?: number;
}

export interface SubtitlePreferenceDTO {
  mediaId: string;
  subtitle_lang: string | null;
}

export interface ContinueWatchingResult {
  metadata: (MovieMetadata | ShowMetadata)[];
  progress: Record<string, MovieProgress | EpisodeProgress>;
  downloads: Record<string, DownloadEntry | MovieDownload | EpisodeDownload>;
}
