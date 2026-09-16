import React from 'react';
import { motion } from 'motion/react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { CardMediaArtwork } from './CardMediaArtwork.js';
import { useFocusable } from '../../context/SpatialNavigationContext.js';

export interface ContinueWatchingCardProps {
  title: string;
  subtitle?: string | null;
  thumbnail?: string | null;
  type: 'movie' | 'show';
  season?: number;
  episode?: number;
  progressPercent?: number;
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  onClick: () => void;
  onPlayDirect?: () => void;
  className?: string;
  focusId?: string;
  zone?: string;
  section?: string;
  index?: number;
}

export function ContinueWatchingCard({
  title,
  subtitle,
  thumbnail,
  type,
  season,
  episode,
  progressPercent = 0,
  isReady = false,
  activeRequest,
  onClick,
  onPlayDirect,
  className = '',
  focusId,
  zone = 'explore',
  section,
  index,
}: ContinueWatchingCardProps) {
  const isMovie = type === 'movie';

  const { ref: focusRef, isSpatialFocused, isKeyboardNav } = useFocusable<HTMLDivElement>({
    id: focusId || `continue-card-${title}`,
    zone,
    section,
    index,
    disabled: !focusId,
    onEnter: onClick,
  });

  return (
    <motion.div
      ref={focusId ? (focusRef as any) : undefined}
      onClick={onClick}
      whileHover={isKeyboardNav ? undefined : { y: -4 }}
      animate={isSpatialFocused ? { y: -4 } : { y: 0 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`group relative flex-shrink-0 cursor-pointer flex flex-col space-y-2 select-none rounded-2xl ${className}`}
    >
      {/* 16:9 Landscape Artwork Container with Unified Effects */}
      <CardMediaArtwork
        src={thumbnail}
        alt={title}
        aspect="video"
        type={type}
        fallbackText={episode ? `EP ${episode}` : isMovie ? 'Movie' : 'Series'}
        isReady={isReady}
        activeRequest={activeRequest}
        showReadyBadge={true}
        progressPercent={progressPercent}
        onPlayDirect={onPlayDirect}
        isFocused={isSpatialFocused}
      />

      {/* Card Typography */}
      <div className="space-y-0.5 px-0.5">
        <h4
          className={`text-xs sm:text-sm font-bold ${
            isSpatialFocused ? 'text-red-400' : 'text-white'
          } truncate group-hover:text-red-400 transition-colors`}
        >
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
