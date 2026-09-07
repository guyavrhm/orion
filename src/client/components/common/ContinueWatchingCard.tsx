import React from 'react';
import { Film, Tv, Check, Play, Loader2, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { ImageWithSkeleton } from './ImageWithSkeleton.js';

interface ContinueWatchingCardProps {
  title: string;
  subtitle?: string | null;
  thumbnail?: string | null;
  type: 'movie' | 'show';
  progressPercent?: number;
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  onClick: () => void;
  onPlayDirect?: () => void;
  className?: string;
}

export function ContinueWatchingCard({
  title,
  subtitle,
  thumbnail,
  type,
  progressPercent = 0,
  isReady = false,
  activeRequest,
  onClick,
  onPlayDirect,
  className = '',
}: ContinueWatchingCardProps) {
  const isMovie = type === 'movie';
  const isQueued = activeRequest?.status === 'queued';
  const isPreparing = activeRequest && activeRequest.status !== 'ready' && !isQueued;
  const shouldShowCheck = isReady;

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`group relative flex-shrink-0 cursor-pointer flex flex-col space-y-2 select-none ${className}`}
    >
      {/* 16:9 Landscape Artwork Container */}
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-zinc-900 relative border border-white/10 group-hover:border-white/25 shadow-lg group-hover:shadow-2xl transition-all duration-300">
        <ImageWithSkeleton
          src={thumbnail}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-600">
              {isMovie ? <Film className="w-8 h-8 mb-1" /> : <Tv className="w-8 h-8 mb-1" />}
              <span className="text-[10px] uppercase font-bold tracking-wider">{isMovie ? 'Movie' : 'Series'}</span>
            </div>
          }
        />

        {/* Subtle Ambient Shadow Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

        {/* Center Hover Play Button (when ready) */}
        {isReady && (
          <div
            onClick={(e) => {
              if (onPlayDirect) {
                e.stopPropagation();
                onPlayDirect();
              }
            }}
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px]"
          >
            <div className="p-3.5 rounded-full bg-red-600 text-white transform group-hover:scale-110 transition-transform shadow-lg flex items-center justify-center">
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </div>
          </div>
        )}

        {/* Top-Right Status Badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
          {isQueued ? (
            <span className="p-1 rounded-full glass-panel bg-black/70 border border-white/15 text-amber-400 shadow-md flex items-center justify-center backdrop-blur-md">
              <Clock className="w-3 h-3 stroke-[2.2]" />
            </span>
          ) : isPreparing ? (
            <div className="px-2 py-0.5 rounded-full glass-panel bg-black/80 border border-white/15 text-white shadow-md flex items-center gap-1 backdrop-blur-md">
              <Loader2 className="w-2.5 h-2.5 animate-spin text-red-400" />
              <span className="text-[10px] font-bold tabular-nums leading-none">
                {Math.round(parseFloat(activeRequest.progress || '0'))}%
              </span>
            </div>
          ) : shouldShowCheck ? (
            <span className="p-1 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center">
              <Check className="w-3 h-3 stroke-[2.5]" />
            </span>
          ) : null}
        </div>

        {/* Red Progress Bar along bottom */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/70 z-10">
            <div
              className="h-full bg-red-600 rounded-r-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, progressPercent))}%` }}
            />
          </div>
        )}
      </div>

      {/* Card Typography */}
      <div className="space-y-0.5 px-0.5">
        <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-red-400 transition-colors">
          {title}
        </h4>
        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-medium">
          <span className="truncate">{subtitle || (isMovie ? 'Movie' : 'Series')}</span>
          {progressPercent > 0 && (
            <span className="text-[10px] text-zinc-500 font-semibold tabular-nums ml-2 flex-shrink-0">
              {Math.round(progressPercent)}%
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default ContinueWatchingCard;
