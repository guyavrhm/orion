import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Tv, Play, Check, Star, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { Skeleton } from '../components/common/Skeleton.js';
import { ImageWithSkeleton } from '../components/common/ImageWithSkeleton.js';
import { calculateProgressPercent, parseDisplayFileId, getShowTargetEpisode } from '../utils/formatters.js';
import type { HeaderPillShowContext } from '../components/HeaderPill.js';

interface MediaDetailViewProps {
  media: MovieMetadata | ShowMetadata;
  progressMap: Record<string, Progress>;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
  isCached?: boolean;
  onBack: () => void;
  onPlayMedia: (info: PlayingMediaInfo) => void;
  onRequestMedia: (fileId: string, episodeMeta?: EpisodeMetadata) => Promise<void>;
  onCacheMediaDetails?: (media: MovieMetadata | ShowMetadata) => void;
  onUpdateProgressMap?: (progress: Record<string, Progress>) => void;
  onUpdateReadyMap?: (ready: Record<string, Stream>) => void;
  onShowNavContextChange?: (ctx: HeaderPillShowContext | null) => void;
}

export function MediaDetailView({
  media,
  progressMap,
  readyMap,
  activeRequests,
  isCached = false,
  onBack,
  onPlayMedia,
  onRequestMedia,
  onCacheMediaDetails,
  onUpdateProgressMap,
  onUpdateReadyMap,
  onShowNavContextChange,
}: MediaDetailViewProps) {
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [detailedMedia, setDetailedMedia] = useState<MovieMetadata | ShowMetadata>(media);
  const [userSelectedSeason, setUserSelectedSeason] = useState<number | null>(null);
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false);
  const [useDropdown, setUseDropdown] = useState(false);
  const [isFetchCompleted, setIsFetchCompleted] = useState<boolean>(isCached);
  const headerRowRef = useRef<HTMLDivElement | null>(null);
  const activeSeasonItemRef = useRef<HTMLButtonElement | null>(null);

  // Scroll to active season inside dropdown ONLY once when opened
  useEffect(() => {
    if (showSeasonDropdown) {
      requestAnimationFrame(() => {
        activeSeasonItemRef.current?.scrollIntoView({
          block: 'nearest',
          behavior: 'instant' as ScrollBehavior,
        });
      });
    }
  }, [showSeasonDropdown]);

  // Scroll to top on mount / media change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    setUserSelectedSeason(null);
  }, [media.id]);

  // Dismiss season dropdown on Escape
  useEffect(() => {
    if (!showSeasonDropdown) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSeasonDropdown(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSeasonDropdown]);

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
    const ratingDisplay = typeof current.rating === 'number' ? current.rating.toFixed(1) : current.rating;
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

    // Calculate target position before DOM height changes from episode re-rendering
    if (headerRowRef.current) {
      const rect = headerRowRef.current.getBoundingClientRect();
      const pillHeader = document.querySelector('header');
      const navBottom = pillHeader ? Math.round(pillHeader.getBoundingClientRect().bottom) : 64;
      const targetY = Math.max(0, window.scrollY + rect.top - (navBottom + 12));

      // Scroll if the user is scrolled past or at the episodes header
      if (rect.top <= navBottom + 20 || window.scrollY > targetY) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        });
      }
    }
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
    <div className="min-h-screen text-zinc-100 animate-in fade-in duration-300 pb-28">
      {/* 1. Full-Bleed Cinematic Hero Banner */}
      <div className="relative w-full h-[58vh] sm:h-[60vh] min-h-[460px] sm:min-h-[500px] max-h-[640px] bg-zinc-950 overflow-hidden">
        <ImageWithSkeleton
          src={current.background || current.poster}
          alt={current.title}
          priority={true}
          className="w-full h-full object-cover object-[center_20%] sm:object-center opacity-45 scale-105"
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
                    <button
                      type="button"
                      onClick={() => setShowSeasonDropdown((prev) => !prev)}
                      className="flex items-center gap-2 px-4 py-2 rounded-2xl glass-panel bg-zinc-900/90 hover:bg-zinc-800 border border-white/10 text-xs font-bold text-white transition backdrop-blur-md cursor-pointer"
                    >
                      <span>Season {activeSeason}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                          showSeasonDropdown ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

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
                              {seasons.map((s) => (
                                <button
                                  key={s}
                                  ref={activeSeason === s ? activeSeasonItemRef : null}
                                  type="button"
                                  onClick={() => {
                                    handleSelectSeason(s);
                                    setShowSeasonDropdown(false);
                                  }}
                                  className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                                    activeSeason === s
                                      ? 'bg-red-600 text-white'
                                      : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <span>Season {s}</span>
                                  {activeSeason === s && <Check className="w-3.5 h-3.5" />}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1 rounded-2xl border border-white/10 backdrop-blur-md overflow-x-auto scrollbar-none flex-shrink-0">
                    {seasons.map((s) => {
                      const isActive = activeSeason === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            handleSelectSeason(s);
                          }}
                          className={`relative px-4 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                            isActive
                              ? 'text-white'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="activeSeasonIndicator"
                              className="absolute inset-0 bg-red-600 rounded-xl shadow-md"
                              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10">Season {s}</span>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* Episode Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-8 sm:gap-y-10">
              {currentSeasonEpisodes.length === 0 && !isFetchCompleted ? (
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
                currentSeasonEpisodes.map((ep) => {
                  const epFileId = `${current.id}_s${ep.season}_e${ep.episode}`;
                  const isEpReady = !!readyMap[epFileId] || activeRequests[epFileId]?.status === 'ready';
                  const epReq = activeRequests[epFileId];
                  const epProg = progressMap[epFileId];
                  const epPercent = calculateProgressPercent(epProg);
                  return (
                    <motion.div
                      key={ep.id}
                      whileHover={{ y: -4 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="group relative flex flex-col justify-between space-y-3 rounded-2xl select-none"
                    >
                      {/* Top: 16:9 Landscape Episode Thumbnail */}
                      <div
                        onClick={() => {
                          if (isEpReady) {
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
                          }
                        }}
                        className={`w-full aspect-video rounded-2xl overflow-hidden bg-zinc-900 relative border border-white/10 group-hover:border-white/25 shadow-lg transition-all duration-300 ${
                          isEpReady ? 'cursor-pointer' : ''
                        }`}
                      >
                        <ImageWithSkeleton
                          src={ep.thumbnail}
                          alt={ep.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
                          fallback={
                            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-600">
                              <Tv className="w-6 h-6 mb-1" />
                              <span className="text-[10px] font-bold">EP {ep.episode}</span>
                            </div>
                          }
                        />

                        {/* Ambient Shadow Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

                        {/* Hover action overlay (Play when ready) */}
                        {isEpReady && (
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                            <div className="p-3.5 rounded-full bg-red-600 text-white transform group-hover:scale-110 transition-transform shadow-lg flex items-center justify-center">
                              <Play className="w-4 h-4 fill-current ml-0.5" />
                            </div>
                          </div>
                        )}

                        {/* Ready checkmark badge on episode thumbnail */}
                        {isEpReady && (
                          <span className="absolute top-2 right-2 p-1 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center z-10">
                            <Check className="w-3 h-3 stroke-[2.5]" />
                          </span>
                        )}

                        {ep.runtime && (
                          <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-black/80 text-zinc-300 border border-white/5 backdrop-blur-md z-10">
                            {ep.runtime}m
                          </span>
                        )}

                        {epPercent > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/70 z-10">
                            <div
                              className="h-full bg-red-600 rounded-r-full transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(5, epPercent))}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Episode Content: Title Row (with right-aligned request button for unready episodes) and Description */}
                      <div className="space-y-1.5 px-0.5 flex-1">
                        <div
                          className={`flex items-center justify-between gap-3 min-w-0 ${isEpReady ? 'cursor-pointer' : ''}`}
                          onClick={() => {
                            if (isEpReady) {
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
                            }
                          }}
                        >
                          <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-red-400 transition-colors min-w-0">
                            <span className="mr-1.5">{ep.episode}.</span>
                            <span>{ep.title || `Episode ${ep.episode}`}</span>
                          </h4>

                          {!isEpReady && (
                            <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                              <StreamActionButton
                                isReady={false}
                                activeRequest={epReq}
                                isRequesting={requestingId === epFileId}
                                hasProgress={epPercent > 0}
                                size="sm"
                                onPlay={() => {}}
                                onRequest={() => {
                                  setRequestingId(epFileId);
                                  onRequestMedia(epFileId, ep).finally(() => setRequestingId(null));
                                }}
                              />
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                          {ep.description || 'No episode synopsis provided.'}
                        </p>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default MediaDetailView;
