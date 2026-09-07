import React from 'react';
import { Film, Tv, Check, Play, Loader2, Clock } from 'lucide-react';
import type { UserActiveMediaState } from '../../main/types/index.js';

interface MediaCardProps {
  title: string;
  poster?: string | null;
  type: 'movie' | 'show';
  year?: string | null;
  subtitle?: string | null;
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  showReadyBadge?: boolean;
  progressPercent?: number;
  onClick: () => void;
  onPlayDirect?: () => void;
  className?: string;
}

export function MediaCard({
  title,
  poster,
  type,
  year,
  subtitle,
  isReady = false,
  activeRequest,
  showReadyBadge = false,
  progressPercent = 0,
  onClick,
  onPlayDirect,
  className = '',
}: MediaCardProps) {
  const isMovie = type === 'movie';
  const isQueued = activeRequest?.status === 'queued';
  const isPreparing = activeRequest && activeRequest.status !== 'ready' && !isQueued;
  const shouldShowCheck = isReady && (showReadyBadge || isMovie);

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-2xl overflow-hidden glass-panel border border-zinc-800 hover:border-zinc-700 p-2.5 transition-all duration-200 cursor-pointer transform hover:-translate-y-1 ${className}`}
    >
      {/* Poster with aspect ratio */}
      <div className="aspect-[2/3] w-full rounded-xl overflow-hidden bg-zinc-900 mb-2 relative flex items-center justify-center">
        {poster ? (
          <img
            src={poster}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
            {isMovie ? <Film className="w-8 h-8 mb-1" /> : <Tv className="w-8 h-8 mb-1" />}
            <span className="text-[10px] uppercase font-mono">{isMovie ? 'Movie' : 'Show'}</span>
          </div>
        )}

        {/* Optional Play hover trigger */}
        {onPlayDirect && isReady && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onPlayDirect();
            }}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            <div className="p-3 rounded-full bg-red-600 text-white transform group-hover:scale-110 transition-transform">
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </div>
          </div>
        )}

        {/* Top-Right Status Badge */}
        {isQueued ? (
          <span className="absolute top-1.5 right-1.5 p-1 rounded-full glass-panel bg-black/70 border border-white/15 text-amber-400 shadow-md flex items-center justify-center backdrop-blur-md">
            <Clock className="w-3 h-3 stroke-[2.2]" />
          </span>
        ) : isPreparing ? (
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full glass-panel bg-black/70 border border-white/15 text-white shadow-md flex items-center gap-1 backdrop-blur-md">
            <Loader2 className="w-2.5 h-2.5 animate-spin text-red-400" />
            <span className="text-[10px] font-mono font-bold leading-none">
              {Math.round(parseFloat(activeRequest.progress || '0'))}%
            </span>
          </div>
        ) : shouldShowCheck ? (
          <span className="absolute top-1.5 right-1.5 p-1 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center">
            <Check className="w-3 h-3 stroke-[2.5]" />
          </span>
        ) : null}

        {/* Progress bar overlay */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
            <div
              className="h-full bg-red-600 rounded-r-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, progressPercent))}%` }}
            />
          </div>
        )}
      </div>

      {/* Card Info */}
      <h4 className="text-xs font-bold text-white truncate group-hover:text-red-400 transition">
        {title}
      </h4>

      <div className="flex items-center text-[10px] text-zinc-400 mt-0.5">
        <span>{subtitle || year || (isMovie ? 'Movie' : 'Show')}</span>
      </div>
    </div>
  );
}
