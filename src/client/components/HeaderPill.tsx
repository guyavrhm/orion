import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Film, Tv, Loader2, Star, Check, ArrowRight, ArrowLeft, AlertCircle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { MovieMetadata, ShowMetadata, Stream, UserActiveMediaState } from '../../main/types/index.js';
import { ApiClient } from '../services/api.js';
import { ImageWithSkeleton } from './common/ImageWithSkeleton.js';
import { useSpatialNavigation, useFocusable, useZoneBack } from '../context/SpatialNavigationContext.js';
import { SeasonDropdownList } from '../views/MediaDetailView.js';

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
  const { pushZone, popZone, setFocused, activeZone } = useSpatialNavigation();
  const isDetail = Boolean(onBack);
  const headerZone = isDetail ? 'detail' : 'explore';
  const headerSection = isDetail ? 'detail-header' : 'header';

  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [searchResultsReady, setSearchResultsReady] = useState<Record<string, Stream>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [showNavSeasonDropdown, setShowNavSeasonDropdown] = useState<boolean>(false);
  const [logoError, setLogoError] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openSearch = useCallback((e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setShowNavSeasonDropdown(false);
    setIsSearching(true);
    pushZone('search');
    // Synchronously focus the input within the user touch/click gesture tick for iOS/Android
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [pushZone]);

  const closeSearch = useCallback((e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    inputRef.current?.blur();
    setIsSearching(false);
    popZone('search');
  }, [popZone]);

  const handleDismissNavSeasonDropdown = useCallback(() => {
    popZone('season-menu');
    setShowNavSeasonDropdown(false);
    setFocused('header-season-dropdown-btn', true);
  }, [popZone, setFocused]);

  const isNavSeasonVisible = Boolean(showContext?.isScrolledPast && showContext.seasons.length > 1);

  const { ref: navSeasonBtnRef, isSpatialFocused: isNavSeasonBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'header-season-dropdown-btn',
    zone: headerZone,
    section: headerSection,
    index: isDetail ? 1 : 0,
    disabled: !isNavSeasonVisible,
    onEnter: () => setShowNavSeasonDropdown((prev) => !prev),
  });

  const { ref: searchBtnRef, isSpatialFocused: isSearchBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'header-search-trigger',
    zone: headerZone,
    section: headerSection,
    index: isDetail ? 1 : 0,
    disabled: isNavSeasonVisible,
    onEnter: openSearch,
  });

  const { ref: backBtnRef, isSpatialFocused: isBackBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'header-back-btn',
    zone: 'detail',
    section: 'detail-header',
    index: 0,
    disabled: !onBack,
    onEnter: onBack,
  });

  const { ref: inputFocusRef, isSpatialFocused: isInputFocused } = useFocusable<HTMLInputElement>({
    id: 'search-input',
    zone: 'search',
    section: 'search-header',
    index: 0,
    priority: 100,
    onFocus: () => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    },
    onBlur: () => {
      if (inputRef.current && document.activeElement === inputRef.current) {
        inputRef.current.blur();
      }
    },
  });

  const setCombinedInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
      inputFocusRef(el);
    },
    [inputFocusRef]
  );

  const { ref: closeBtnFocusRef, isSpatialFocused: isCloseBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'search-close-btn',
    zone: 'search',
    section: 'search-header',
    index: 1,
    priority: 0,
    onEnter: closeSearch,
  });

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

  // Deterministic stack-based zone back handlers
  useZoneBack('search', closeSearch, isSearching);
  useZoneBack('season-menu', handleDismissNavSeasonDropdown, showNavSeasonDropdown);

  // Global Keyboard Shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openSearch]);

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

  // Synchronize navbar season dropdown modal zone with spatial navigation
  useEffect(() => {
    if (!showNavSeasonDropdown || !showContext) return;
    pushZone('season-menu', `detail-dropdown-season-${showContext.activeSeason}`);
    return () => {
      popZone('season-menu');
    };
  }, [showNavSeasonDropdown, showContext?.activeSeason, pushZone, popZone]);

  const handleSelect = (item: MovieMetadata | ShowMetadata) => {
    closeSearch();
    onSelectMedia(item);
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
            onClick={closeSearch}
            className="fixed inset-0 z-[45] bg-black/60 backdrop-blur-md touch-none overscroll-none"
          />
        )}
      </AnimatePresence>

      {/* Floating Header Pill Container (Uniform width & height in all states) */}
      <div
        ref={containerRef}
        className="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-xl"
      >
        <header
          className={`relative flex items-center justify-between rounded-full glass-panel backdrop-blur-2xl border shadow-2xl px-4 h-12 w-full transition-colors duration-200 ${
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
                            width: dragProgress > 0 ? Math.max(0, (1 - dragProgress) * 52) : 'auto',
                          }}
                          exit={{ opacity: 0, width: 0 }}
                          transition={dragProgress > 0 ? { duration: 0 } : { duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                          className="flex items-center flex-shrink-0"
                        >
                          <div className="flex items-center gap-2 pr-2.5 flex-shrink-0">
                            <button
                              ref={backBtnRef as any}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onBack();
                              }}
                              className={`p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer ${
                                isBackBtnFocused ? 'spatial-focus-pill bg-white/20 text-white ring-2 ring-white/90' : ''
                              }`}
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
                          ref={navSeasonBtnRef as any}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowNavSeasonDropdown((prev) => !prev);
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                            isNavSeasonBtnFocused
                              ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white'
                              : showNavSeasonDropdown
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
                        ref={searchBtnRef as any}
                        key="pill-search-trigger"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        type="button"
                        onClick={openSearch}
                        className={`p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer flex items-center justify-center ${
                          isSearchBtnFocused ? 'spatial-focus-pill bg-white/20 text-white ring-2 ring-white/90' : ''
                        }`}
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
                    ref={setCombinedInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                      if (activeZone === 'search') {
                        setFocused('search-input', false);
                      }
                    }}
                    placeholder="Search movies, TV shows, actors..."
                    className="flex-1 bg-transparent text-white placeholder-zinc-500 text-sm font-medium focus:outline-none min-w-0"
                  />

                  <button
                    ref={closeBtnFocusRef as any}
                    type="button"
                    onClick={closeSearch}
                    className={`p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer ${
                      isCloseBtnFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
                    }`}
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
                <SeasonDropdownList
                  seasons={showContext.seasons}
                  activeSeason={showContext.activeSeason}
                  onSelectSeason={(s) => {
                    showContext.onSelectSeason(s);
                    setShowNavSeasonDropdown(false);
                  }}
                  onDismiss={handleDismissNavSeasonDropdown}
                />
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
                  results.map((item, index) => {
                    return (
                      <SearchResultItem
                        key={item.id}
                        item={item}
                        index={index}
                        isReady={
                          !!readyMap[item.id] ||
                          !!searchResultsReady[item.id] ||
                          activeRequests[item.id]?.status === 'ready'
                        }
                        onSelect={() => handleSelect(item)}
                      />
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

interface SearchResultItemProps {
  item: MovieMetadata | ShowMetadata;
  index: number;
  isReady: boolean;
  onSelect: () => void;
}

function SearchResultItem({ item, index, isReady, onSelect }: SearchResultItemProps) {
  const isMovie = item.type === 'movie';
  const { ref, isSpatialFocused } = useFocusable<HTMLDivElement>({
    id: `search-result-${item.id}`,
    zone: 'search',
    section: 'search-results',
    index,
    onEnter: onSelect,
  });

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`group flex items-center justify-between gap-3 p-2.5 rounded-2xl cursor-pointer ${
        isSpatialFocused
          ? 'bg-zinc-800 ring-2 ring-white/90 shadow-lg'
          : 'hover:bg-zinc-800/80'
      }`}
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
            <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-red-400 truncate">
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

      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white flex-shrink-0 mr-1" />
    </div>
  );
}

export default HeaderPill;
