import React from 'react';
import { Film, Tv, Play } from 'lucide-react';
import { motion } from 'motion/react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { ImageWithSkeleton } from './ImageWithSkeleton.js';
import { MediaStatusBadge } from './MediaStatusBadge.js';

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

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`group relative flex flex-col flex-shrink-0 cursor-pointer select-none space-y-2 ${className}`}
    >
      {/* Poster with aspect ratio & borderless container */}
      <div className="aspect-[2/3] w-full rounded-2xl overflow-hidden bg-zinc-900 relative shadow-md group-hover:shadow-xl border border-white/5 group-hover:border-white/20 transition-all duration-300">
        <ImageWithSkeleton
          src={poster}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-600">
              {isMovie ? <Film className="w-8 h-8 mb-1" /> : <Tv className="w-8 h-8 mb-1" />}
              <span className="text-[10px] uppercase font-bold tracking-wider">{isMovie ? 'Movie' : 'Series'}</span>
            </div>
          }
        />

        {/* Subtle Ambient Shadow Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

        {/* Hover action button (Play if ready & onPlayDirect) */}
        {onPlayDirect && isReady && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onPlayDirect();
            }}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]"
          >
            <div className="p-3.5 rounded-full bg-red-600 text-white transform group-hover:scale-110 transition-transform shadow-lg flex items-center justify-center">
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </div>
          </div>
        )}

        {/* Top-Right Status Badge */}
        <MediaStatusBadge
          activeRequest={activeRequest}
          isReady={isReady}
          showReadyBadge={showReadyBadge || isMovie}
          className="absolute top-2 right-2 z-10"
        />

        {/* Progress bar overlay */}
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/70 z-10">
            <div
              className="h-full bg-red-600 rounded-r-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(5, progressPercent))}%` }}
            />
          </div>
        )}
      </div>

      {/* Card Info */}
      <div className="space-y-0.5 px-0.5">
        <h4 className="text-xs font-bold text-white truncate group-hover:text-red-400 transition-colors">
          {title}
        </h4>
        <div className="flex items-center text-[11px] text-zinc-400 font-medium">
          <span className="truncate">{subtitle || year || (isMovie ? 'Movie' : 'Series')}</span>
        </div>
      </div>
    </motion.div>
  );
}
