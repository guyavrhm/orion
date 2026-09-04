/**
 * BullMQ job data and result type definitions for all background queue workers.
 */

import type { ParsedTorrentCandidate } from './clients.js';
import type { MediaType } from './models.js';

// ==========================================
// 1. Download Job Types
// ==========================================

export interface DownloadJobData {
  fileId: string;
  type: MediaType;
  candidates?: ParsedTorrentCandidate[];
  magnetUrl?: string;
  hash?: string;
  fileIdx?: number;
  quality?: string;
  size_bytes?: number;
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
}

// ==========================================
// 4. Finalize Job Types
// ==========================================

export interface FinalizeJobData {
  fileId: string;
  rawTempDir?: string | null;
  quality?: string;
}

export interface FinalizeJobResult {
  fileId: string;
  hlsDir: string;
  size_bytes: number;
}

// ==========================================
// 5. Media Processing DAG Flow Payload
// ==========================================

export interface MediaProcessingFlowData {
  fileId: string;
  sourcePath: string;
  rawTempDir?: string | null;
  fileHash?: string | null;
  fileSize?: number | null;
  targetFileName?: string;
  quality?: string;
  codec?: string;
}

