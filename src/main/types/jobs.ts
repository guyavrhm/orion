/**
 * BullMQ job data and result type definitions for all background queue workers.
 */

import type { ParsedTorrentCandidate } from './clients.js';

// ==========================================
// 1. Download Job Types
// ==========================================

export interface DownloadJobData {
  fileId: string;
  type: 'movie' | 'series';
  candidates?: ParsedTorrentCandidate[];
  magnetUrl?: string;
  hash?: string;
  fileIdx?: number;
  quality?: string;
  sizeBytes?: number;
  lockedCandidateHash?: string;
  failedCandidates?: string[];
  accumulatedDeadDuration?: number;
  wasStalled?: boolean;
}

export interface DownloadJobProgress {
  percent: number;
  speedMB: string;
  peers: number;
  wasStalled: boolean;
  activeCandidate: string;
}

export interface DownloadJobResult {
  fileId: string;
  status: string;
  sourcePath?: string;
  rawTempDir?: string | null;
  fileHash?: string | null;
  fileSize?: number | null;
  nextCandidate?: string;
  wasStalled?: boolean;
}

// ==========================================
// 2. Transcode Job Types
// ==========================================

export interface TranscodeJobData {
  fileId: string;
  sourcePath: string;
  codec?: string;
}

export interface TranscodeJobResult {
  fileId: string;
  status: string;
}

// ==========================================
// 3. Subtitle Job Types
// ==========================================

export interface SubtitleJobData {
  fileId: string;
  sourcePath: string;
  fileHash?: string | null;
  fileSize?: number | null;
  targetFileName?: string;
}

export interface SubtitleJobResult {
  fileId: string;
  status: string;
}

// ==========================================
// 4. Finalize Job Types
// ==========================================

export interface FinalizeJobData {
  fileId: string;
  sourcePath: string;
  rawTempDir?: string | null;
  hash: string;
  fileHash?: string | null;
  fileIdx?: number | null;
  targetFileName?: string;
  quality: string;
  sizeBytes?: number;
}

export interface FinalizeJobResult {
  fileId: string;
  status: string;
  hlsDir: string;
  sizeBytes: number;
}

// ==========================================
// 5. Media Processing DAG Flow Payload
// ==========================================

export interface MediaProcessingFlowData {
  fileId: string;
  sourcePath: string;
  rawTempDir?: string | null;
  hash: string;
  fileHash?: string | null;
  fileSize?: number | null;
  type: 'movie' | 'series';
  fileIdx?: number | null;
  targetFileName?: string;
  quality?: string;
  sizeBytes?: number;
  codec?: string;
}
