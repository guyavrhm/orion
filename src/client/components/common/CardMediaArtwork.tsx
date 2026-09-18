import React from 'react';
import { Film, Tv, Play } from 'lucide-react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { ImageWithSkeleton } from './ImageWithSkeleton.js';
import { MediaStatusBadge } from './MediaStatusBadge.js';

export interface CardMediaArtworkProps {
  src?: string | null;
  alt: string;
  aspect?: 'poster' | 'video';
  type?: 'movie' | 'show';
  fallbackText?: string | null;
  isReady?: boolean;
  activeRequest?: UserActiveMediaState;
  showReadyBadge?: boolean;
  progressPercent?: number;
  onPlayDirect?: () => void;
  bottomRightBadge?: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
  isFocused?: boolean;
}

export const CardMediaArtwork = React.memo(function CardMediaArtwork({
  src,
  alt,
  aspect = 'poster',
  type = 'movie',
  fallbackText,
  isReady = false,
  activeRequest,
  showReadyBadge = false,
  progressPercent = 0,
  onPlayDirect,
  bottomRightBadge,
  fallback,
  className = '',
  isFocused = false,
}: CardMediaArtworkProps) {
  const isMovie = type === 'movie';

  const defaultFallback = (
    <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-600">
      {isMovie ? (
        <>
          <Film className="w-8 h-8 mb-1" />
          <span className="text-[10px] uppercase font-bold tracking-wider">
            {fallbackText || 'Movie'}
          </span>
        </>
      ) : (
        <>
          <Tv className="w-8 h-8 mb-1" />
          <span className="text-[10px] uppercase font-bold tracking-wider">
            {fallbackText || 'Series'}
          </span>
        </>
      )}
    </div>
  );

  return (
    <div
      className={`${
        aspect === 'poster' ? 'aspect-[2/3]' : 'aspect-video'
      } w-full rounded-2xl overflow-hidden bg-zinc-900 relative border shadow-lg transition-all duration-300 ${
        isFocused
          ? 'border-white/90 ring-2 ring-white/90 shadow-2xl'
          : 'border-white/10 group-hover:border-white/25 group-hover:shadow-2xl'
      } ${className}`}
    >
      <ImageWithSkeleton
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-transform duration-500 ${
          isFocused ? 'scale-105 opacity-100' : 'opacity-90 group-hover:scale-105 group-hover:opacity-100'
        }`}
        fallback={fallback || defaultFallback}
      />

      {/* Subtle Ambient Shadow Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

      {/* Center Hover Action Button (Play if ready & onPlayDirect) */}
      {isReady && onPlayDirect && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onPlayDirect();
          }}
          className={`absolute inset-0 bg-black/40 transition-opacity flex items-center justify-center backdrop-blur-[2px] ${
            isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div
            className={`p-3.5 rounded-full bg-red-600 text-white transform transition-transform shadow-lg flex items-center justify-center ${
              isFocused ? 'scale-110' : 'group-hover:scale-110'
            }`}
          >
            <Play className="w-4 h-4 fill-current ml-0.5" />
          </div>
        </div>
      )}

      {/* Top-Right Status Badge */}
      <MediaStatusBadge
        activeRequest={activeRequest}
        isReady={isReady}
        showReadyBadge={showReadyBadge}
        className="absolute top-2 right-2 z-10"
      />

      {/* Bottom-Right Custom Badge (e.g. Runtime) */}
      {bottomRightBadge && (
        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-black/80 text-zinc-300 border border-white/5 backdrop-blur-md z-10">
          {bottomRightBadge}
        </span>
      )}

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
  );
});

export default CardMediaArtwork;
