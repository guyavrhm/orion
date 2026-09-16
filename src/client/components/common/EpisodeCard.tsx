import React from 'react';
import { Tv, PlusCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { EpisodeMetadata, UserActiveMediaState } from '../../../main/types/index.js';
import { CardMediaArtwork } from './CardMediaArtwork.js';

export interface EpisodeCardProps {
  episode: EpisodeMetadata;
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  progressPercent?: number;
  isRequesting?: boolean;
  onPlay: () => void;
  onRequest: () => void;
  className?: string;
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
}: EpisodeCardProps) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
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
          <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-red-400 transition-colors min-w-0">
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
                className="text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 p-0.5 flex items-center justify-center"
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

        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
          {episode.description || 'No episode synopsis provided.'}
        </p>
      </div>
    </motion.div>
  );
}

export default EpisodeCard;
