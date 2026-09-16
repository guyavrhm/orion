import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Film, Tv, Play, Check, Star, ChevronDown, PlusCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import type {
  MovieMetadata,
  ShowMetadata,
  EpisodeMetadata,
  Progress,
  Stream,
  UserActiveMediaState,
} from '../../main/types/index.js';
import type { PlayingMediaInfo } from '../types/ui.js';
import { ApiClient } from '../services/api.js';
import { StreamActionButton } from '../components/common/StreamActionButton.js';
import { MediaStatusBadge } from '../components/common/MediaStatusBadge.js';
import { Skeleton } from '../components/common/Skeleton.js';
import { ImageWithSkeleton } from '../components/common/ImageWithSkeleton.js';
import { EpisodeCard } from '../components/common/EpisodeCard.js';
import { calculateProgressPercent, parseDisplayFileId, getShowTargetEpisode } from '../utils/formatters.js';
import type { HeaderPillShowContext } from '../components/HeaderPill.js';
import { useSpatialNavigation, useFocusable, useZoneBack } from '../context/SpatialNavigationContext.js';

interface MediaDetailViewProps {
  media: MovieMetadata | ShowMetadata;
  progressMap: Record<string, Progress>;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
  isCached?: boolean;
  isActive?: boolean;
  onBack: () => void;
  onPlayMedia: (info: PlayingMediaInfo) => void;
  onRequestMedia: (fileId: string, episodeMeta?: EpisodeMetadata) => Promise<void>;
  onCacheMediaDetails?: (media: MovieMetadata | ShowMetadata) => void;
  onUpdateProgressMap?: (progress: Record<string, Progress>) => void;
  onUpdateReadyMap?: (ready: Record<string, Stream>) => void;
  onShowNavContextChange?: (ctx: HeaderPillShowContext | null) => void;
  onDragProgress?: (progress: number) => void;
}

export function MediaDetailView({
  media,
  progressMap,
  readyMap,
  activeRequests,
  isCached = false,
  isActive = true,
  onBack,
  onPlayMedia,
  onRequestMedia,
  onCacheMediaDetails,
  onUpdateProgressMap,
  onUpdateReadyMap,
  onShowNavContextChange,
  onDragProgress,
}: MediaDetailViewProps) {
  const { pushZone, popZone, activeZone, setFocused } = useSpatialNavigation();
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [detailedMedia, setDetailedMedia] = useState<MovieMetadata | ShowMetadata>(media);
  const [userSelectedSeason, setUserSelectedSeason] = useState<number | null>(null);
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);
  const [useDropdown, setUseDropdown] = useState(false);
  const [isFetchCompleted, setIsFetchCompleted] = useState<boolean>(isCached);

  const handleDismissSeasonDropdown = useCallback(() => {
    popZone('season-menu');
    setShowSeasonDropdown(false);
    setFocused('detail-season-dropdown-btn', true);
  }, [popZone, setFocused]);

  // Manage spatial navigation detail zone on view mount/unmount
  useEffect(() => {
    pushZone('detail', 'detail-stream-action-btn');
    return () => {
      popZone('detail');
    };
  }, [pushZone, popZone]);

  // Deterministic stack-based zone back handlers
  useZoneBack('detail', onBack, isActive);
  useZoneBack('season-menu', handleDismissSeasonDropdown, showSeasonDropdown);
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Reset selected season on media change
  useEffect(() => {
    setUserSelectedSeason(null);
  }, [media.id]);

  // Interactive Netflix/Disney+ Grade Drag-to-Dismiss gesture (Mobile Only)
  const dragX = useMotionValue(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const isHorizontalGestureRef = useRef<boolean | null>(null);

  // Synchronize dragProgress 1:1 with motion value
  useEffect(() => {
    const unsubscribe = dragX.on('change', (latestX) => {
      const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 375;
      const progress = Math.min(1, Math.max(0, latestX / screenWidth));
      onDragProgress?.(progress);
    });
    return () => {
      unsubscribe();
      onDragProgress?.(0);
    };
  }, [dragX, onDragProgress]);

  useEffect(() => {
    if (!isMobile || !isActive) {
      dragX.set(0);
      return;
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const clientX = e.touches[0].clientX;

      // Restrict gesture initiation strictly to the far left edge of the screen (iOS/Netflix standard)
      const maxEdgeDistance = 40;
      if (clientX > maxEdgeDistance) return;

      const target = e.target as HTMLElement | null;
      if (target?.closest('.overflow-x-auto, input, textarea, button, a, [role="button"]')) return;

      const clientY = e.touches[0].clientY;

      dragStartXRef.current = clientX;
      dragStartYRef.current = clientY;
      isHorizontalGestureRef.current = null;
      isDraggingRef.current = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = currentX - dragStartXRef.current;
      const deltaY = currentY - dragStartYRef.current;

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Lock in gesture orientation on first significant movement
      if (isHorizontalGestureRef.current === null) {
        if (absX > 6 || absY > 6) {
          // Must be strictly rightward from left edge AND horizontal-dominant (angle < 35 deg)
          if (deltaX > 6 && deltaX > absY * 1.4) {
            isHorizontalGestureRef.current = true;
          } else {
            // Predominantly vertical or leftward motion: yield to native vertical scroll permanently for this touch
            isHorizontalGestureRef.current = false;
            isDraggingRef.current = false;
            return;
          }
        } else {
          return;
        }
      }

      if (isHorizontalGestureRef.current && deltaX > 0) {
        // Freeze native vertical page scroll when actively performing a horizontal dismiss swipe
        if (e.cancelable) {
          e.preventDefault();
        }
        dragX.set(deltaX);
      }
    };

    const handleTouchEnd = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      const currentDrag = dragX.get();
      const threshold = Math.min(130, window.innerWidth * 0.26);

      if (isHorizontalGestureRef.current && currentDrag >= threshold) {
        // Fluidly fling off screen to the right and call onBack()
        animate(dragX, window.innerWidth, {
          duration: 0.22,
          ease: [0.32, 0.72, 0, 1],
        }).then(() => {
          onBack();
        });
      } else if (currentDrag > 0) {
        // Spring smoothly back to original position
        animate(dragX, 0, {
          type: 'spring',
          stiffness: 450,
          damping: 32,
        });
      }

      isHorizontalGestureRef.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isMobile, isActive, onBack, dragX]);


  useEffect(() => {
    setDetailedMedia(media);
    setIsFetchCompleted(isCached);

    if (media.type === 'movie') {
      if (!isCached && !media.description && !media.cast?.length) {
        ApiClient.getMovieDetails(media.id)
          .then((res) => {
            if (res.metadata) {
              setDetailedMedia(res.metadata as MovieMetadata);
              onCacheMediaDetails?.(res.metadata);
            }
            if (res.progress) onUpdateProgressMap?.(res.progress);
            if (res.ready) onUpdateReadyMap?.(res.ready);
          })
          .catch(() => {})
          .finally(() => setIsFetchCompleted(true));
      } else {
        setIsFetchCompleted(true);
      }
    } else {
      if (!isCached) {
        ApiClient.getShowDetails(media.id)
          .then((res) => {
            if (res.metadata) {
              setDetailedMedia(res.metadata as ShowMetadata);
              onCacheMediaDetails?.(res.metadata);
            }
            if (res.progress) onUpdateProgressMap?.(res.progress);
            if (res.ready) onUpdateReadyMap?.(res.ready);
          })
          .catch(() => {})
          .finally(() => setIsFetchCompleted(true));
      } else {
        setIsFetchCompleted(true);
      }
    }
  }, [media.id]);

  const current = detailedMedia || media;
  const isMovie = current.type === 'movie';
  const showMeta = isMovie ? null : (current as ShowMetadata);
  const episodes = showMeta?.episodes || [];
  const seasons = Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b);

  // Dynamic layout measurement: detect if season pills fit on the single header line
  useEffect(() => {
    if (seasons.length <= 1) {
      setUseDropdown(false);
      return;
    }

    const checkFit = () => {
      const headerEl = headerRowRef.current;
      if (!headerEl) return;
      // Space available in the header row after the "Episodes" title & gap
      const availableWidth = headerEl.clientWidth - 170;
      // Required width for full segmented pill tabs: each tab ~88px + 6px gap + 8px container padding
      const neededWidth = seasons.length * 88 + 16;
      setUseDropdown(neededWidth > availableWidth);
    };

    checkFit();

    if (typeof ResizeObserver !== 'undefined' && headerRowRef.current) {
      const observer = new ResizeObserver(checkFit);
      observer.observe(headerRowRef.current);
      return () => observer.disconnect();
    }
  }, [seasons.length]);

  // Movie stream & progress calculation
  const movieFileId = current.id;
  const isMovieReady = isMovie && (!!readyMap[movieFileId] || activeRequests[movieFileId]?.status === 'ready');
  const movieReq = activeRequests[movieFileId];
  const movieProg = progressMap[movieFileId];
  const moviePercent = calculateProgressPercent(movieProg);

  // Clean editorial metadata elements
  const formattedRuntime =
    isMovie && current.runtime
      ? current.runtime >= 60
        ? `${Math.floor(current.runtime / 60)}h${current.runtime % 60 > 0 ? ` ${current.runtime % 60}m` : ''}`
        : `${current.runtime}m`
      : null;

  const seasonsCount =
    !isMovie && seasons.length > 0
      ? `${seasons.length} Season${seasons.length > 1 ? 's' : ''}`
      : null;

  const genresText =
    current.genres && current.genres.length > 0
      ? current.genres.join(', ')
      : null;

  const metaItems: React.ReactNode[] = [];
  if (current.year) {
    metaItems.push(<span key="year">{current.year}</span>);
  }
  if (formattedRuntime) {
    metaItems.push(<span key="runtime">{formattedRuntime}</span>);
  }
  if (seasonsCount) {
    metaItems.push(<span key="seasons">{seasonsCount}</span>);
  }
  if (current.rating) {
    const ratingDisplay = current.rating;
    metaItems.push(
      <span key="rating" className="inline-flex items-center gap-1 text-amber-400 font-semibold">
        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 inline" />
        <span>{ratingDisplay}</span>
      </span>
    );
  }
  if (genresText) {
    metaItems.push(
      <span key="genres" className="text-zinc-400">
        {genresText}
      </span>
    );
  }

  // Target episode resolution for top ActionButton and active season
  const globalTarget = getShowTargetEpisode(current.id, episodes, progressMap);
  const activeSeason = userSelectedSeason ?? globalTarget.season;
  const currentSeasonEpisodes = episodes.filter((e) => e.season === activeSeason);

  const [isPastSeasonPicker, setIsPastSeasonPicker] = useState<boolean>(false);

  // Native high-performance IntersectionObserver with dynamic navbar bottom measurement
  useEffect(() => {
    if (isMovie || seasons.length <= 1) {
      setIsPastSeasonPicker(false);
      return;
    }

    const headerEl = headerRowRef.current;
    if (!headerEl || typeof IntersectionObserver === 'undefined') return;

    // Measure exact rendered navbar bottom on this specific device
    const pillHeader = document.querySelector('header');
    const navBottom = pillHeader ? Math.round(pillHeader.getBoundingClientRect().bottom) : 64;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPastSeasonPicker(entry.boundingClientRect.top <= navBottom && !entry.isIntersecting);
      },
      {
        rootMargin: `-${navBottom}px 0px 0px 0px`,
        threshold: 0,
      }
    );

    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [isMovie, seasons.length]);

  const handleSelectSeason = useCallback((season: number) => {
    setUserSelectedSeason(season);
  }, []);

  // Sync show navigation context to top HeaderPill
  useEffect(() => {
    if (isMovie || seasons.length <= 1) {
      onShowNavContextChange?.(null);
      return;
    }

    onShowNavContextChange?.({
      title: current.title,
      logo: current.logo,
      seasons,
      activeSeason,
      onSelectSeason: handleSelectSeason,
      isScrolledPast: isPastSeasonPicker,
    });
  }, [isMovie, seasons, activeSeason, isPastSeasonPicker, current.title, current.logo, handleSelectSeason, onShowNavContextChange]);

  // Clear show nav context on unmount
  useEffect(() => {
    return () => {
      onShowNavContextChange?.(null);
    };
  }, [onShowNavContextChange]);

  // Synchronize season dropdown modal zone with spatial navigation
  useEffect(() => {
    if (!showSeasonDropdown) return;
    pushZone('season-menu', `detail-dropdown-season-${activeSeason}`);
    return () => {
      popZone('season-menu');
    };
  }, [showSeasonDropdown, activeSeason, pushZone, popZone]);

  const activeSeasonNum = globalTarget.season;
  const activeEpisodeNum = globalTarget.episode;
  const targetEpMeta =
    episodes.find((ep) => ep.season === activeSeasonNum && ep.episode === activeEpisodeNum) ||
    globalTarget.epMeta ||
    episodes[0];
  const targetEpFileId = globalTarget.fileId;
  const isTargetEpReady = !isMovie && (!!readyMap[targetEpFileId] || activeRequests[targetEpFileId]?.status === 'ready');
  const targetEpReq = activeRequests[targetEpFileId];
  const targetEpProg = progressMap[targetEpFileId];

  // Helper renderer for primary StreamActionButton
  const renderActionButton = (size: 'md' | 'lg' = 'lg', className = '') => {
    if (isMovie) {
      return (
        <StreamActionButton
          isReady={isMovieReady}
          activeRequest={movieReq}
          isRequesting={requestingId === movieFileId}
          hasProgress={Boolean(movieProg && movieProg.timestamp > 0)}
          size={size}
          className={className}
          onPlay={() => {
            onPlayMedia({
              fileId: movieFileId,
              mediaId: current.id,
              title: current.title,
              type: 'movie',
              poster: current.poster,
              background: current.background,
            });
          }}
          onRequest={() => {
            setRequestingId(movieFileId);
            onRequestMedia(movieFileId).finally(() => setRequestingId(null));
          }}
        />
      );
    }

    return (
      <StreamActionButton
        isReady={isTargetEpReady}
        activeRequest={targetEpReq}
        isRequesting={requestingId === targetEpFileId}
        hasProgress={Boolean(targetEpProg && targetEpProg.timestamp > 0)}
        size={size}
        className={className}
        onPlay={() => {
          onPlayMedia({
            fileId: targetEpFileId,
            mediaId: current.id,
            title: current.title,
            subtitle: targetEpMeta?.title
              ? `S${activeSeasonNum}:E${activeEpisodeNum} "${targetEpMeta.title}"`
              : `S${activeSeasonNum}:E${activeEpisodeNum}`,
            type: 'show',
            season: activeSeasonNum,
            episode: activeEpisodeNum,
            poster: targetEpMeta?.thumbnail || current.poster,
            background: current.background,
          });
        }}
        onRequest={() => {
          setRequestingId(targetEpFileId);
          onRequestMedia(targetEpFileId, targetEpMeta).finally(() => setRequestingId(null));
        }}
      />
    );
  };

  return (
    <motion.div
      ref={scrollContainerRef}
      style={{ x: isMobile ? dragX : 0 }}
      initial={isMobile ? { x: '100%' } : { opacity: 0 }}
      animate={isMobile ? { x: 0 } : { opacity: 1 }}
      exit={isMobile ? { x: '100%' } : { opacity: 0 }}
      transition={
        isMobile
          ? { type: 'spring', damping: 32, stiffness: 350 }
          : { duration: 0.2, ease: 'easeOut' }
      }
      className={`fixed inset-0 z-40 bg-zinc-950 overflow-y-auto overflow-x-hidden overscroll-contain text-zinc-100 pb-28 will-change-transform ${
        isMobile ? 'shadow-[-20px_0_50px_rgba(0,0,0,0.8)] touch-pan-y' : ''
      }`}
    >
      {/* 1. Full-Bleed Cinematic Hero Banner */}
      <div className="relative w-full h-[58vh] sm:h-[60vh] min-h-[460px] sm:min-h-[500px] max-h-[640px] bg-zinc-950 overflow-hidden">
        <ImageWithSkeleton
          src={current.background || current.poster}
          alt={current.title}
          priority={true}
          className="w-full h-full object-cover object-[center_20%] sm:object-center opacity-100 scale-105"
          fallback={
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 text-zinc-700">
              {isMovie ? <Film className="w-20 h-20 opacity-20" /> : <Tv className="w-20 h-20 opacity-20" />}
            </div>
          }
        />

        {/* Ambient Gradients for smooth fade into page & pill readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/70 via-transparent to-transparent h-32" />

        {/* Hero Title & Primary Metadata Overlay */}
        <div className="absolute bottom-6 sm:bottom-8 left-4 sm:left-8 right-4 sm:right-8 z-10 max-w-5xl space-y-3.5">
          {current.logo ? (
            <img
              src={current.logo}
              alt={current.title}
              className="max-h-16 sm:max-h-24 w-auto max-w-sm sm:max-w-md object-contain drop-shadow-2xl mb-2"
            />
          ) : (
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight drop-shadow-md">
              {current.title}
            </h1>
          )}

          {/* Editorial Metadata Line */}
          {metaItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-zinc-300 font-medium">
              {metaItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-zinc-600 select-none">•</span>}
                  {item}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Main Content Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-8 mt-4">
        {/* Primary Play / Request Action Area */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4">
          <div className="w-full sm:w-auto">
            {renderActionButton('lg', 'w-full sm:w-auto justify-center')}
          </div>
          {!isMovie && (
            <div className="text-xs sm:text-base font-bold text-zinc-300 truncate max-w-md sm:max-w-xl flex items-center gap-1.5 px-0.5">
              <span className="text-white">S{activeSeasonNum}:E{activeEpisodeNum}</span>
              {targetEpMeta?.title && (
                <span className="text-zinc-400 font-medium truncate">
                  "{targetEpMeta.title}"
                </span>
              )}
            </div>
          )}
        </div>

        {/* Overview & Starring Block */}
        <div className="space-y-3 max-w-4xl">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Overview</h3>
          <p className="text-sm sm:text-base text-zinc-300 leading-relaxed">
            {current.description || 'No detailed overview available for this title.'}
          </p>

          {current.cast && current.cast.length > 0 && (
            <div className="pt-1 text-xs sm:text-sm text-zinc-400 leading-relaxed font-medium">
              <span className="text-zinc-300 font-bold mr-1.5">Starring:</span>
              <span>{current.cast.slice(0, 10).join(', ')}</span>
            </div>
          )}
        </div>

        {/* 3. TV Show Episode Browser */}
        {!isMovie && (
          <section className="space-y-6 pt-4 border-t border-zinc-800/80">
            {/* Single-row header: Always strictly on the same line */}
            <div ref={headerRowRef} className="flex items-center justify-between gap-3 min-w-0">
              <h3 className="text-lg font-bold text-white tracking-tight flex-shrink-0">
                Episodes
              </h3>

              {/* Dynamic Season Selector: Dropdown if pills don't fit, Segmented Tabs if they fit */}
              {seasons.length > 1 && (
                useDropdown ? (
                  <div className="relative flex-shrink-0">
                    <SeasonDropdownTrigger
                      activeSeason={activeSeason}
                      isOpen={showSeasonDropdown}
                      onToggle={() => setShowSeasonDropdown((prev) => !prev)}
                    />

                    <AnimatePresence>
                      {showSeasonDropdown && (
                        <>
                          <div
                            className="fixed inset-0 z-30"
                            onClick={() => setShowSeasonDropdown(false)}
                          />
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            className="absolute right-0 top-11 z-40 w-44 glass-panel bg-zinc-900/95 rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
                          >
                            <div className="max-h-60 overflow-y-auto overscroll-contain p-1.5 space-y-0.5">
                              {seasons.map((s, idx) => (
                                <DropdownSeasonItem
                                  key={s}
                                  season={s}
                                  index={idx}
                                  isActive={activeSeason === s}
                                  onSelect={() => {
                                    handleSelectSeason(s);
                                    setShowSeasonDropdown(false);
                                  }}
                                  onDismiss={handleDismissSeasonDropdown}
                                />
                              ))}
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1 rounded-2xl border border-white/10 backdrop-blur-md overflow-x-auto scrollbar-none flex-shrink-0">
                    {seasons.map((s, idx) => (
                      <SeasonTabButton
                        key={s}
                        season={s}
                        index={idx}
                        isActive={activeSeason === s}
                        onSelect={() => handleSelectSeason(s)}
                      />
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Episode Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-8 sm:gap-y-10">
              {!isFetchCompleted ? (
                [1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div
                    key={`ep-skeleton-${i}`}
                    className="flex flex-col space-y-3"
                  >
                    <Skeleton className="w-full aspect-video rounded-2xl" />
                    <div className="space-y-1.5 px-0.5">
                      <div className="flex items-center justify-between gap-3">
                        <Skeleton className="h-4 w-3/5 rounded-md" />
                        <Skeleton className="h-6 w-16 rounded-xl" />
                      </div>
                      <Skeleton className="h-3 w-full rounded-md" />
                      <Skeleton className="h-3 w-4/5 rounded-md" />
                    </div>
                  </div>
                ))
              ) : (
                currentSeasonEpisodes.map((ep, idx) => {
                  const epFileId = `${current.id}_s${ep.season}_e${ep.episode}`;
                  const isEpReady = !!readyMap[epFileId] || activeRequests[epFileId]?.status === 'ready';
                  const epReq = activeRequests[epFileId];
                  const epProg = progressMap[epFileId];
                  const epPercent = calculateProgressPercent(epProg);

                  return (
                    <EpisodeCard
                      key={ep.id}
                      focusId={`detail-ep-${ep.id || `${ep.season}_${ep.episode}`}`}
                      zone="detail"
                      section="detail-episodes"
                      index={idx}
                      episode={ep}
                      isReady={isEpReady}
                      activeRequest={epReq}
                      progressPercent={epPercent}
                      isRequesting={requestingId === epFileId}
                      onPlay={() => {
                        onPlayMedia({
                          fileId: epFileId,
                          mediaId: current.id,
                          title: current.title,
                          subtitle: ep.title ? `S${ep.season}E${ep.episode}: ${ep.title}` : `S${ep.season}E${ep.episode}`,
                          type: 'show',
                          season: ep.season,
                          episode: ep.episode,
                          poster: ep.thumbnail || current.poster,
                          background: current.background,
                        });
                      }}
                      onRequest={() => {
                        setRequestingId(epFileId);
                        onRequestMedia(epFileId, ep).finally(() => setRequestingId(null));
                      }}
                    />
                  );
                })
              )}
            </div>
          </section>
        )}
      </div>
    </motion.div>
  );
}

interface SeasonTabButtonProps {
  season: number;
  index: number;
  isActive: boolean;
  onSelect: () => void;
}

function SeasonTabButton({ season, index, isActive, onSelect }: SeasonTabButtonProps) {
  const { ref, isSpatialFocused } = useFocusable<HTMLButtonElement>({
    id: `detail-season-${season}`,
    zone: 'detail',
    section: 'detail-seasons',
    index,
    priority: isActive ? 50 : 0,
    onEnter: onSelect,
  });

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={`relative px-4 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer spatial-focus-indicator ${
        isSpatialFocused ? 'spatial-focus-pill ring-2 ring-white/90 scale-105' : ''
      } ${isActive ? 'text-white' : 'text-zinc-400 hover:text-white'}`}
    >
      {isActive && (
        <motion.div
          layoutId="activeSeasonIndicator"
          className="absolute inset-0 bg-red-600 rounded-xl shadow-md"
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      )}
      <span className="relative z-10">Season {season}</span>
    </button>
  );
}

function SeasonDropdownTrigger({
  activeSeason,
  isOpen,
  onToggle,
}: {
  activeSeason: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { ref, isSpatialFocused } = useFocusable<HTMLButtonElement>({
    id: 'detail-season-dropdown-btn',
    zone: 'detail',
    section: 'detail-seasons',
    index: 0,
    priority: 50,
    onEnter: onToggle,
  });

  return (
    <button
      ref={ref}
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 px-4 py-2 rounded-2xl glass-panel bg-zinc-900/90 hover:bg-zinc-800 border border-white/10 text-xs font-bold text-white transition backdrop-blur-md cursor-pointer spatial-focus-indicator ${
        isSpatialFocused ? 'spatial-focus-pill ring-2 ring-white/90 scale-105' : ''
      }`}
    >
      <span>Season {activeSeason}</span>
      <ChevronDown
        className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
          isOpen ? 'rotate-180' : ''
        }`}
      />
    </button>
  );
}

export function DropdownSeasonItem({
  season,
  index,
  isActive,
  onSelect,
}: {
  season: number;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  onDismiss?: () => void;
}) {
  const { ref, isSpatialFocused } = useFocusable<HTMLButtonElement>({
    id: `detail-dropdown-season-${season}`,
    zone: 'season-menu',
    section: 'dropdown-items',
    index,
    priority: isActive ? 50 : 0,
    onEnter: onSelect,
  });

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer spatial-focus-indicator ${
        isActive
          ? 'bg-red-600 text-white'
          : isSpatialFocused
          ? 'bg-white/20 text-white'
          : 'text-zinc-300 hover:bg-white/10 hover:text-white'
      } ${isSpatialFocused ? 'spatial-focus-pill ring-2 ring-white/90' : ''}`}
    >
      <span>Season {season}</span>
      {isActive && <Check className="w-3.5 h-3.5" />}
    </button>
  );
}

export default MediaDetailView;
