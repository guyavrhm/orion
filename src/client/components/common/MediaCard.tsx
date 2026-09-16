import React from 'react';
import { motion } from 'motion/react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { CardMediaArtwork } from './CardMediaArtwork.js';

export interface MediaCardProps {
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
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`group relative flex flex-col flex-shrink-0 cursor-pointer select-none space-y-2 ${className}`}
    >
      {/* 2:3 Aspect Ratio Artwork Container with Unified Effects */}
      <CardMediaArtwork
        src={poster}
        alt={title}
        aspect="poster"
        type={type}
        fallbackText={isMovie ? 'Movie' : 'Series'}
        isReady={isReady}
        activeRequest={activeRequest}
        showReadyBadge={showReadyBadge || isMovie}
        progressPercent={progressPercent}
        onPlayDirect={onPlayDirect}
      />

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

export default MediaCard;
