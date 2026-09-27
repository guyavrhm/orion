import React from 'react';
import { Play, PlusCircle, Loader2, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import type { UserActiveMediaState } from '../../../main/types/index.js';
import { useFocusable } from '../../context/SpatialNavigationContext.js';

export interface StreamActionButtonProps {
  isReady: boolean;
  activeRequest?: UserActiveMediaState;
  isRequesting?: boolean;
  hasProgress?: boolean;
  progressTimestampFormatted?: string;
  onPlay: () => void;
  onRequest: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  focusId?: string;
  zone?: string;
  autoFocus?: boolean;
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
  focusId,
  zone = 'detail',
  autoFocus = false,
}: StreamActionButtonProps) {
  const isPreparing = activeRequest && activeRequest.status !== 'ready';
  const progressVal = activeRequest ? Math.round(parseFloat(activeRequest.progress || '0')) : 0;

  const handleAction = () => {
    if (isReady) {
      onPlay();
    } else if (!isPreparing && !isRequesting) {
      onRequest();
    }
  };

  const buttonId = focusId || 'detail-stream-action-btn';

  const { ref: focusRef, isSpatialFocused } = useFocusable<HTMLElement>({
    id: buttonId,
    zone,
    section: 'detail-hero-action',
    index: 0,
    autoFocus,
    priority: 100,
    onEnter: handleAction,
  });

  const sizeClasses = {
    sm: 'px-3.5 py-1.5 text-xs rounded-xl gap-1.5',
    md: 'px-6 py-2.5 text-xs rounded-xl gap-2 font-bold',
    lg: 'px-8 py-3 text-xs rounded-xl gap-2 font-bold',
  };

  const iconSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-4 h-4',
  };

  if (isPreparing) {
    const isQueued = activeRequest.status === 'queued';
    return (
      <div
        id={buttonId}
        ref={focusRef}
        tabIndex={-1}
        className={`inline-flex items-center rounded-xl glass-panel bg-zinc-900/80 border border-white/10 text-zinc-300 text-xs font-semibold backdrop-blur-md cursor-default select-none spatial-focus-indicator ${
          isSpatialFocused ? 'spatial-focus-active ring-2 ring-white/90 shadow-2xl bg-white/20 text-white' : ''
        } ${sizeClasses[size]} ${className}`}
      >
        {isQueued ? (
          <Clock className={`${iconSizes[size]} text-amber-400`} />
        ) : (
          <Loader2 className={`${iconSizes[size]} animate-spin text-red-400`} />
        )}
        <span className="tabular-nums">
          {isQueued ? 'Queued' : `Preparing (${progressVal}%)`}
        </span>
      </div>
    );
  }

  if (isReady) {
    return (
      <motion.button
        id={buttonId}
        ref={focusRef}
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        onClick={onPlay}
        className={`inline-flex items-center bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer shadow-md spatial-focus-indicator ${
          isSpatialFocused ? 'spatial-focus-active ring-2 ring-white/90 shadow-2xl' : ''
        } ${sizeClasses[size]} ${className}`}
      >
        <Play className={`${iconSizes[size]} fill-current`} />
        <span>Play</span>
      </motion.button>
    );
  }

  return (
    <motion.button
      id={buttonId}
      ref={focusRef}
      type="button"
      whileHover={{ scale: isRequesting ? 1 : 1.02 }}
      whileTap={{ scale: isRequesting ? 1 : 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      onClick={onRequest}
      disabled={isRequesting}
      className={`inline-flex items-center glass-panel bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-white/10 backdrop-blur-md transition-colors cursor-pointer disabled:opacity-50 spatial-focus-indicator ${
        isSpatialFocused ? 'spatial-focus-active ring-2 ring-white/90 shadow-2xl' : ''
      } ${sizeClasses[size]} ${className}`}
    >
      {isRequesting ? (
        <Loader2 className={`${iconSizes[size]} animate-spin`} />
      ) : (
        <PlusCircle className={iconSizes[size]} />
      )}
      <span>{isRequesting ? 'Requesting...' : 'Request'}</span>
    </motion.button>
  );
}
