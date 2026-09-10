import React from 'react';
import { Check, Loader2, Clock } from 'lucide-react';
import type { UserActiveMediaState } from '../../../main/types/index.js';

export interface MediaStatusBadgeProps {
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  showReadyBadge?: boolean;
  className?: string;
}

export function MediaStatusBadge({
  isReady = false,
  activeRequest,
  showReadyBadge = true,
  className = '',
}: MediaStatusBadgeProps) {
  const isQueued = activeRequest?.status === 'queued';
  const isPreparing = activeRequest && activeRequest.status !== 'ready' && !isQueued;
  const shouldShowCheck = isReady && showReadyBadge;

  if (isQueued) {
    return (
      <div
        className={`p-1 rounded-full glass-panel bg-black/70 border border-white/15 text-amber-400 shadow-md flex items-center justify-center backdrop-blur-md ${className}`}
        title="Queued"
        aria-label="Queued"
      >
        <Clock className="w-3 h-3 stroke-[2.2]" />
      </div>
    );
  }

  if (isPreparing) {
    return (
      <div
        className={`px-2 py-0.5 rounded-full glass-panel bg-black/80 border border-white/15 text-white shadow-md flex items-center gap-1 backdrop-blur-md ${className}`}
        title={`Preparing (${Math.round(parseFloat(activeRequest.progress || '0'))}%)`}
        aria-label={`Preparing ${Math.round(parseFloat(activeRequest.progress || '0'))}%`}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin text-red-400" />
        <span className="text-[10px] font-bold tabular-nums leading-none">
          {Math.round(parseFloat(activeRequest.progress || '0'))}%
        </span>
      </div>
    );
  }

  if (shouldShowCheck) {
    return (
      <div
        className={`p-1 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center ${className}`}
        title="Ready to play"
        aria-label="Ready to play"
      >
        <Check className="w-3 h-3 stroke-[2.5]" />
      </div>
    );
  }

  return null;
}

export default MediaStatusBadge;
