/**
 * Canonical Domain Models, Playback Entities, and DTOs for Orion.
 * Single deterministic source of truth for media, progress, and stream representations.
 * All properties are explicitly defined (no optional '?' markers), using 'null' for absent values
 * and empty arrays for collections.
 */

export type MediaType = 'movie' | 'show';

// ==========================================
// 1. Media Metadata Domain Models
// ==========================================

export interface MovieMetadata {
  id: string;
  type: 'movie';
  title: string;
  year: string | null;
  released: string | null;
  genres: string[];
  poster: string | null;
  background: string | null;
  logo: string | null;
  rating: string | null;
  runtime: number | null;
  description: string | null;
  awards: string | null;
  cast: string[];
  director: string[];
  writer: string[];
  country: string | null;
  dvdRelease: string | null;
  moviedb_id: number | null;
  popularity: number | null;
  last_fetched: number | null;
}

export interface EpisodeMetadata {
  id: string;
  show_id: string;
  season: number;
  episode: number;
  title: string;
  description: string | null;
  thumbnail: string | null;
  released: string | null;
  rating: string | null;
  tvdb_id: number | null;
  runtime: number | null;
}

export interface ShowMetadata {
  id: string;
  type: 'show';
  title: string;
  year: string | null;
  released: string | null;
  genres: string[];
  poster: string | null;
  background: string | null;
  logo: string | null;
  rating: string | null;
  runtime: number | null;
  description: string | null;
  awards: string | null;
  cast: string[];
  director: string[];
  writer: string[];
  country: string | null;
  status: string | null;
  tvdb_id: number | null;
  moviedb_id: number | null;
  popularity: number | null;
  episodes: EpisodeMetadata[];
  last_fetched: number | null;
}

// ==========================================
// 2. Playback & Watch Progress Models
// ==========================================

export interface Progress {
  id: string;
  show_id: string | null;
  timestamp: number;
  runtime: number;
  last_updated: number;
}

export interface ProgressUpdate {
  timestamp: number;
  runtime: number;
}

// ==========================================
// 3. Stream & Subtitle Models
// ==========================================

export interface Stream {
  id: string;
  show_id: string | null;
  quality: string | null;
  size_bytes: number;
  ready_at: number;
}

export interface SubtitlePreference {
  id: string;
  subtitle_lang: string | null;
}

export interface SubtitleTrack {
  lang: string;
  url: string;
}

// ==========================================
// 4. Universal API Envelope
// ==========================================

export interface MediaResponse<T> {
  metadata: T;
  progress: Record<string, Progress>;
  ready: Record<string, Stream>;
}
