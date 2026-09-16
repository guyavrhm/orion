import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Film, Tv, Loader2, Star, Check, ArrowRight, ArrowLeft, AlertCircle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { MovieMetadata, ShowMetadata, Stream, UserActiveMediaState } from '../../main/types/index.js';
import { ApiClient } from '../services/api.js';
import { ImageWithSkeleton } from './common/ImageWithSkeleton.js';

export interface HeaderPillShowContext {
  title: string;
  logo: string | null;
  seasons: number[];
  activeSeason: number;
  onSelectSeason: (season: number) => void;
  isScrolledPast: boolean;
}

interface HeaderPillProps {
  onSelectMedia: (media: MovieMetadata | ShowMetadata) => void;
  readyMap?: Record<string, Stream>;
  activeRequests?: Record<string, UserActiveMediaState>;
  onBack?: () => void;
  toast?: string | null;
  onClearToast?: () => void;
  showContext?: HeaderPillShowContext | null;
  dragProgress?: number;
}

function interleaveSearchResults(items: (MovieMetadata | ShowMetadata)[]): (MovieMetadata | ShowMetadata)[] {
  const movies = items.filter((item) => item.type === 'movie');
  const shows = items.filter((item) => item.type === 'show');

  const interleaved: (MovieMetadata | ShowMetadata)[] = [];
  const maxLen = Math.max(movies.length, shows.length);

  for (let i = 0; i < maxLen; i++) {
    if (i < movies.length) {
      interleaved.push(movies[i]);
    }
    if (i < shows.length) {
      interleaved.push(shows[i]);
    }
  }

  return interleaved;
}

export function HeaderPill({
  onSelectMedia,
  readyMap = {},
  activeRequests = {},
  onBack,
  toast,
  onClearToast,
  showContext = null,
  dragProgress = 0,
}: HeaderPillProps) {
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [searchResultsReady, setSearchResultsReady] = useState<Record<string, Stream>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [showNavSeasonDropdown, setShowNavSeasonDropdown] = useState<boolean>(false);
  const [logoError, setLogoError] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeNavSeasonItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setLogoError(false);
  }, [showContext?.logo]);

  // Scroll to active season inside nav dropdown ONLY once when opened
  useEffect(() => {
    if (showNavSeasonDropdown) {
      requestAnimationFrame(() => {
        activeNavSeasonItemRef.current?.scrollIntoView({
          block: 'nearest',
          behavior: 'instant' as ScrollBehavior,
        });
      });
    }
  }, [showNavSeasonDropdown]);

  // Close nav season dropdown on Escape
  useEffect(() => {
    if (!showNavSeasonDropdown) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNavSeasonDropdown(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showNavSeasonDropdown]);

  // Close nav season dropdown if scrolled back up
  useEffect(() => {
    if (!showContext?.isScrolledPast) {
      setShowNavSeasonDropdown(false);
    }
  }, [showContext?.isScrolledPast]);

  const openSearch = useCallback((e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setShowNavSeasonDropdown(false);
    setIsSearching(true);
    // Synchronously focus the input within the user touch/click gesture tick for iOS/Android
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const closeSearch = useCallback((e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    inputRef.current?.blur();
    setIsSearching(false);
  }, []);

  // Clear query and search results when closed
  useEffect(() => {
    if (!isSearching) {
      setQuery('');
      setResults([]);
      setSearchResultsReady({});
      setLoading(false);
    }
  }, [isSearching]);

  // Debounced Search Query with In-Flight Cancellation
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchResultsReady({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    const handler = setTimeout(() => {
      ApiClient.search(query, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          const raw = res.metadata || [];
          setResults(interleaveSearchResults(raw));
          if (res.ready) setSearchResultsReady(res.ready);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError')) {
            return;
          }
          setResults([]);
          setSearchResultsReady({});
          setLoading(false);
        });
    }, 350);

    return () => {
      clearTimeout(handler);
      controller.abort();
    };
  }, [query]);

  // Global Keyboard Shortcuts (Cmd+K / Ctrl+K and Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
      }
      if (e.key === 'Escape') {
        if (isSearching) {
          e.preventDefault();
          e.stopPropagation();
          closeSearch();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearching, openSearch, closeSearch]);

  // Lock background body scroll when search is active & preserve scroll position
  useEffect(() => {
    if (!isSearching) return;

    const scrollY = window.scrollY;
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    const preventTouch = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.overflow-y-auto')) return;
      if (e.cancelable) e.preventDefault();
    };

    const preventWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.overflow-y-auto')) return;
      e.preventDefault();
    };

    document.addEventListener('touchmove', preventTouch, { passive: false });
    document.addEventListener('wheel', preventWheel, { passive: false });

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
      document.removeEventListener('touchmove', preventTouch);
      document.removeEventListener('wheel', preventWheel);
      if (window.scrollY !== scrollY) {
        window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior });
      }
    };
  }, [isSearching]);

  // Click Outside to Dismiss
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsSearching(false);
        setShowNavSeasonDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (item: MovieMetadata | ShowMetadata) => {
    onSelectMedia(item);
    setIsSearching(false);
  };

  return (
    <>
      {/* Dimmed backdrop scrim when search is active */}
      <AnimatePresence>
        {isSearching && (
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setIsSearching(false)}
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm touch-none overscroll-none"
          />
        )}
      </AnimatePresence>

      {/* Floating Header Pill Container (Uniform width & height in all states) */}
      <div
        ref={containerRef}
        className="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-xl transition-all duration-300"
      >
        <header
          className={`relative flex items-center justify-between rounded-full glass-panel backdrop-blur-2xl border shadow-2xl px-4 h-12 w-full transition-colors duration-200 overflow-hidden ${
            toast
              ? 'border-white/10 bg-zinc-900/90'
              : isSearching
              ? 'border-white/20 bg-zinc-900/95'
              : 'border-white/10 bg-zinc-900/80'
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {toast ? (
              /* Toast Alert Mode: Dynamic Island Morph */
              <motion.div
                key="toast-hud"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="flex-1 flex items-center justify-between gap-3 min-w-0 h-full"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span className="text-xs font-medium text-zinc-200 truncate">{toast}</span>
                </div>
                <button
                  type="button"
                  onClick={onClearToast}
                  className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white flex-shrink-0 cursor-pointer"
                  title="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="header-default"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="flex-1 flex items-center justify-between min-w-0 h-full"
              >
                {/* Brand Mode: Left Brand + Right Action with Smooth Morph Animation */}
                <motion.div
                  initial={false}
                  animate={{
                    opacity: isSearching ? 0 : 1,
                    scale: isSearching ? 0.96 : 1,
                  }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={`flex-1 flex items-center justify-between min-w-0 h-full ${
                    isSearching ? 'pointer-events-none' : 'pointer-events-auto'
                  }`}
                >
                  {/* Left: Dynamic Back button + Divider + (Orion Brand OR Show Logo/Title) */}
                  <div className="flex items-center min-w-0 flex-1 mr-2">
                    <AnimatePresence initial={false}>
                      {onBack && (
                        <motion.div
                          key="pill-back-container"
                          initial={{ opacity: 0, width: 0 }}
                          animate={{
                            opacity: dragProgress > 0 ? Math.max(0, 1 - dragProgress) : 1,
                            width: dragProgress > 0 ? Math.max(0, (1 - dragProgress) * 44) : 44,
                          }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={dragProgress > 0 ? { duration: 0 } : { duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                          className="flex items-center overflow-hidden flex-shrink-0"
                        >
                          <div className="flex items-center gap-2 pr-2.5 flex-shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onBack();
                              }}
                              className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer"
                              title="Back (Esc)"
                            >
                              <ArrowLeft className="w-4 h-4" />
                            </button>
                            <div className="w-px h-4 bg-zinc-800 flex-shrink-0" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <AnimatePresence mode="wait" initial={false}>
                      {showContext?.isScrolledPast && showContext.seasons.length > 1 ? (
                        <motion.div
                          key="show-brand-content"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: dragProgress > 0 ? Math.max(0, 1 - dragProgress) : 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={dragProgress > 0 ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
                          className="flex items-center gap-2 pl-0.5 pr-1 py-1 select-none min-w-0"
                        >
                          {showContext.logo && !logoError ? (
                            <img
                              src={showContext.logo}
                              alt={showContext.title}
                              onError={() => setLogoError(true)}
                              className="max-h-5 max-w-[130px] sm:max-w-[200px] object-contain"
                            />
                          ) : (
                            <span className="text-xs font-black tracking-wide text-white truncate">
                              {showContext.title}
                            </span>
                          )}
                        </motion.div>
                      ) : (
                        <motion.div
                          key="orion-brand-content"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="flex items-center gap-2 pl-0.5 pr-1 py-1 select-none flex-shrink-0"
                        >
                          <div className="w-6 h-6 flex items-center justify-center">
                            <img
                              src="/assets/images/orion-nobackground.png"
                              alt="Orion"
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <span className="text-xs font-black tracking-wider text-white">
                            ORION
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Right: Search Icon Button OR Morphed Season Picker Dropdown Trigger */}
                  <AnimatePresence mode="wait" initial={false}>
                    {showContext?.isScrolledPast && showContext.seasons.length > 1 ? (
                      <motion.div
                        key="pill-season-trigger"
                        initial={{ opacity: 0, y: -6, scale: 0.9 }}
                        animate={{ opacity: dragProgress > 0 ? Math.max(0, 1 - dragProgress) : 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.9 }}
                        transition={dragProgress > 0 ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
                        className="relative flex-shrink-0"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowNavSeasonDropdown((prev) => !prev);
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                            showNavSeasonDropdown
                              ? 'bg-white/10 text-white'
                              : 'hover:bg-white/10 text-zinc-300 hover:text-white'
                          }`}
                          title="Select Season"
                        >
                          <span>Season {showContext.activeSeason}</span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                              showNavSeasonDropdown ? 'rotate-180 text-white' : 'group-hover:text-white'
                            }`}
                          />
                        </button>
                      </motion.div>
                    ) : (
                      <motion.button
                        key="pill-search-trigger"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        type="button"
                        onClick={openSearch}
                        className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer flex items-center justify-center"
                        title="Search (⌘K)"
                      >
                        <Search className="w-4 h-4" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Active Search Mode: Persistent DOM Input with Fluid Motion Morph */}
                <motion.div
                  initial={false}
                  animate={{
                    opacity: isSearching ? 1 : 0,
                    scale: isSearching ? 1 : 0.96,
                  }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={`absolute inset-0 px-4 flex items-center gap-3 min-w-0 h-full ${
                    isSearching ? 'pointer-events-auto z-10' : 'pointer-events-none z-0'
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 text-zinc-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  )}

                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search movies, TV shows, actors..."
                    className="flex-1 bg-transparent text-white placeholder-zinc-500 text-sm font-medium focus:outline-none min-w-0"
                  />

                  <button
                    type="button"
                    onClick={closeSearch}
                    className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer"
                    title="Close (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        {/* Season Picker Dropdown anchored to Nav Pill */}
        <AnimatePresence>
          {showNavSeasonDropdown && showContext?.isScrolledPast && showContext.seasons.length > 1 && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowNavSeasonDropdown(false)}
              />
              <motion.div
                key="nav-season-dropdown"
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute right-0 top-14 z-40 w-44 glass-panel bg-zinc-900/95 rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
              >
                <div className="max-h-60 overflow-y-auto overscroll-contain p-1.5 space-y-0.5">
                  {showContext.seasons.map((s) => (
                    <button
                      key={s}
                      ref={showContext.activeSeason === s ? activeNavSeasonItemRef : null}
                      type="button"
                      onClick={() => {
                        showContext.onSelectSeason(s);
                        setShowNavSeasonDropdown(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                        showContext.activeSeason === s
                          ? 'bg-red-600 text-white'
                          : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <span>Season {s}</span>
                      {showContext.activeSeason === s && <Check className="w-3.5 h-3.5" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Dropdown Results Anchored to Pill */}
        <AnimatePresence>
          {isSearching && (results.length > 0 || (!loading && query.trim().length > 0)) && (
            <motion.div
              key="search-results-dropdown"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              className="mt-2 w-full glass-panel bg-zinc-900/95 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
            >
              <div
                onWheel={(e) => e.stopPropagation()}
                className="max-h-[60vh] overflow-y-auto overscroll-contain p-2.5 space-y-1"
              >
                {results.length > 0 ? (
                  results.map((item) => {
                    const isMovie = item.type === 'movie';
                    const isReady =
                      !!readyMap[item.id] ||
                      !!searchResultsReady[item.id] ||
                      activeRequests[item.id]?.status === 'ready';

                    return (
                      <motion.div
                        key={item.id}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
                        onClick={() => handleSelect(item)}
                        className="group flex items-center justify-between gap-3 p-2.5 rounded-2xl hover:bg-zinc-800/80 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Poster Thumbnail */}
                          <div className="w-10 h-14 rounded-xl bg-zinc-800 overflow-hidden flex-shrink-0">
                            <ImageWithSkeleton
                              src={item.poster}
                              alt={item.title}
                              fallback={
                                <div className="w-full h-full flex items-center justify-center text-zinc-600">
                                  {isMovie ? <Film className="w-5 h-5" /> : <Tv className="w-5 h-5" />}
                                </div>
                              }
                            />
                          </div>

                          {/* Title & Metadata */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-red-400 transition-colors truncate">
                                {item.title}
                              </h4>
                              <span className="px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-white/5 flex-shrink-0">
                                {isMovie ? 'Movie' : 'Show'}
                              </span>
                              {isReady && isMovie && (
                                <span className="p-0.5 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
                                  <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2.5 text-xs text-zinc-400 mt-1">
                              {item.year && <span className="text-[11px] font-medium">{item.year}</span>}
                              {item.rating && (
                                <span className="flex items-center gap-1 text-amber-400 font-semibold text-[11px]">
                                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                  <span>{item.rating}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors flex-shrink-0 mr-1" />
                      </motion.div>
                    );
                  })
                ) : query.trim() && !loading ? (
                  <div className="text-center py-8 text-zinc-500 text-xs sm:text-sm font-medium">
                    No titles found for &quot;{query}&quot;
                  </div>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

export default HeaderPill;
