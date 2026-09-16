import React from 'react';
import { motion } from 'motion/react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { CardMediaArtwork } from './CardMediaArtwork.js';
import { useFocusable } from '../../context/SpatialNavigationContext.js';

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
  focusId?: string;
  zone?: string;
  section?: string;
  index?: number;
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
  focusId,
  zone = 'explore',
  section,
  index,
}: MediaCardProps) {
  const isMovie = type === 'movie';

  const { ref: focusRef, isSpatialFocused, isKeyboardNav } = useFocusable<HTMLDivElement>({
    id: focusId || `media-card-${title}-${year || ''}`,
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
      className={`group relative flex flex-col flex-shrink-0 cursor-pointer select-none space-y-2 rounded-2xl ${className}`}
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
        isFocused={isSpatialFocused}
      />

      {/* Card Info */}
      <div className="space-y-0.5 px-0.5">
        <h4
          className={`text-xs font-bold ${
            isSpatialFocused ? 'text-red-400' : 'text-white'
          } truncate group-hover:text-red-400 transition-colors`}
        >
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
