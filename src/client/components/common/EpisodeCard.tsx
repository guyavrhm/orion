import React from 'react';
import { Tv, PlusCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { EpisodeMetadata, UserActiveMediaState } from '../../../main/types/index.js';
import { CardMediaArtwork } from './CardMediaArtwork.js';
import { useFocusable } from '../../context/SpatialNavigationContext.js';

export interface EpisodeCardProps {
  episode: EpisodeMetadata;
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  progressPercent?: number;
  isRequesting?: boolean;
  onPlay: () => void;
  onRequest: () => void;
  className?: string;
  focusId?: string;
  zone?: string;
  section?: string;
  index?: number;
}

export function EpisodeCard({
  episode,
  isReady = false,
  activeRequest,
  progressPercent = 0,
  isRequesting = false,
  onPlay,
  onRequest,
  className = '',
  focusId,
  zone = 'detail',
  section = 'detail-episodes',
  index,
}: EpisodeCardProps) {
  const handleAction = () => {
    if (isReady) {
      onPlay();
    } else if (!isRequesting && (!activeRequest || activeRequest.status === 'ready' || activeRequest.status === 'failed')) {
      onRequest();
    }
  };

  const { ref: focusRef, isSpatialFocused, isKeyboardNav } = useFocusable<HTMLDivElement>({
    id: focusId || `episode-card-${episode.id || `${episode.season}_${episode.episode}`}`,
    zone,
    section,
    index,
    disabled: !focusId,
    onEnter: handleAction,
  });

  return (
    <motion.div
      ref={focusId ? (focusRef as any) : undefined}
      whileHover={isKeyboardNav ? undefined : { y: -4 }}
      animate={isSpatialFocused ? { y: -4 } : { y: 0 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`group relative flex flex-col justify-between space-y-3 rounded-2xl select-none ${className}`}
    >
      {/* Top: 16:9 Landscape Episode Thumbnail */}
      <div
        onClick={() => {
          if (isReady) {
            onPlay();
          }
        }}
        className={isReady ? 'cursor-pointer' : ''}
      >
        <CardMediaArtwork
          src={episode.thumbnail}
          alt={episode.title || `Episode ${episode.episode}`}
          aspect="video"
          type="show"
          fallbackText={`EP ${episode.episode}`}
          isReady={isReady}
          activeRequest={activeRequest}
          showReadyBadge={true}
          progressPercent={progressPercent}
          onPlayDirect={isReady ? onPlay : undefined}
          bottomRightBadge={episode.runtime ? `${episode.runtime}m` : undefined}
          isFocused={isReady && isSpatialFocused}
          fallback={
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-600">
              <Tv className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-bold">EP {episode.episode}</span>
            </div>
          }
        />
      </div>

      {/* Episode Content: Title Row & Synopsis */}
      <div className="space-y-1.5 px-0.5 flex-1">
        <div
          className={`flex items-center justify-between gap-3 min-w-0 ${isReady ? 'cursor-pointer' : ''}`}
          onClick={() => {
            if (isReady) {
              onPlay();
            }
          }}
        >
          <h4
            className={`text-xs sm:text-sm font-bold ${
              isSpatialFocused ? 'text-red-400' : 'text-white'
            } truncate group-hover:text-red-400 transition-colors min-w-0`}
          >
            <span className="mr-1.5">{episode.episode}.</span>
            <span>{episode.title || `Episode ${episode.episode}`}</span>
          </h4>

          {!isReady && (!activeRequest || activeRequest.status === 'ready' || activeRequest.status === 'failed') && (
            <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <motion.button
                type="button"
                whileHover={{ scale: isRequesting ? 1 : 1.15 }}
                whileTap={{ scale: isRequesting ? 1 : 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                onClick={onRequest}
                disabled={isRequesting}
                className={`transition-all cursor-pointer disabled:opacity-50 p-1 rounded-full flex items-center justify-center ${
                  isSpatialFocused
                    ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white scale-110'
                    : 'text-zinc-400 hover:text-white hover:bg-white/10'
                }`}
                title={isRequesting ? 'Requesting...' : 'Request Episode'}
                aria-label="Request episode"
              >
                {isRequesting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                ) : (
                  <PlusCircle className="w-4 h-4" />
                )}
              </motion.button>
            </div>
          )}
        </div>

        {episode.description && (
          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
            {episode.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}

export default EpisodeCard;
