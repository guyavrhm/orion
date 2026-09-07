import React from 'react';
import { Play, PlusCircle, Loader2, RotateCcw } from 'lucide-react';
import type { UserActiveMediaState } from '../../../main/types/index.js';

interface StreamActionButtonProps {
  isReady: boolean;
  activeRequest?: UserActiveMediaState;
  isRequesting?: boolean;
  hasProgress?: boolean;
  progressTimestampFormatted?: string;
  onPlay: () => void;
  onRequest: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StreamActionButton({
  isReady,
  activeRequest,
  isRequesting = false,
  hasProgress = false,
  progressTimestampFormatted,
  onPlay,
  onRequest,
  size = 'md',
  className = '',
}: StreamActionButtonProps) {
  const isPreparing = activeRequest && activeRequest.status !== 'ready';

  const sizeClasses = {
    sm: 'px-3.5 py-1.5 text-xs rounded-xl gap-1.5',
    md: 'px-6 py-2.5 text-xs rounded-xl gap-2 font-bold',
    lg: 'px-8 py-3 text-xs rounded-xl gap-2 font-bold',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-4 h-4',
  };

  if (isPreparing) {
    const isQueued = activeRequest.status === 'queued';
    return (
      <div
        className={`inline-flex items-center rounded-xl bg-indigo-950/70 border border-indigo-500/30 text-indigo-300 text-xs font-semibold ${sizeClasses[size]} ${className}`}
      >
        <Loader2 className={`${iconSizes[size]} animate-spin text-indigo-400`} />
        <span>{isQueued ? 'Queued' : `Preparing (${activeRequest.progress}%)`}</span>
      </div>
    );
  }

  if (isReady) {
    return (
      <button
        onClick={onPlay}
        className={`inline-flex items-center bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer ${sizeClasses[size]} ${className}`}
      >
        {hasProgress ? (
          <RotateCcw className={iconSizes[size]} />
        ) : (
          <Play className={`${iconSizes[size]} fill-current`} />
        )}
        <span>
          {hasProgress
            ? progressTimestampFormatted
              ? `Resume (${progressTimestampFormatted})`
              : 'Resume'
            : 'Watch'}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={onRequest}
      disabled={isRequesting}
      className={`inline-flex items-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition cursor-pointer disabled:opacity-50 ${sizeClasses[size]} ${className}`}
    >
      {isRequesting ? (
        <Loader2 className={`${iconSizes[size]} animate-spin`} />
      ) : (
        <PlusCircle className={iconSizes[size]} />
      )}
      <span>{isRequesting ? 'Requesting...' : 'Request'}</span>
    </button>
  );
}
