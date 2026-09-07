import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Film, Tv, Loader2, Star, Check, ArrowRight, ArrowLeft } from 'lucide-react';
import type { MovieMetadata, ShowMetadata, Stream, UserActiveMediaState } from '../../main/types/index.js';
import { ApiClient } from '../services/api.js';

interface HeaderPillProps {
  onSelectMedia: (media: MovieMetadata | ShowMetadata) => void;
  readyMap?: Record<string, Stream>;
  activeRequests?: Record<string, UserActiveMediaState>;
  onBack?: () => void;
}

export function HeaderPill({
  onSelectMedia,
  readyMap = {},
  activeRequests = {},
  onBack,
}: HeaderPillProps) {
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [searchResultsReady, setSearchResultsReady] = useState<Record<string, Stream>>({});
  const [loading, setLoading] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opening search
  useEffect(() => {
    if (isSearching) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
      setSearchResultsReady({});
      setLoading(false);
    }
  }, [isSearching]);

  // Debounced Search Query
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchResultsReady({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const handler = setTimeout(() => {
      ApiClient.search(query)
        .then((res) => {
          setResults(res.metadata || []);
          if (res.ready) setSearchResultsReady(res.ready);
          setLoading(false);
        })
        .catch(() => {
          setResults([]);
          setSearchResultsReady({});
          setLoading(false);
        });
    }, 280);

    return () => clearTimeout(handler);
  }, [query]);

  // Global Keyboard Shortcuts (Cmd+K / Ctrl+K and Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearching(true);
      }
      if (e.key === 'Escape') {
        if (isSearching) {
          setIsSearching(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearching]);

  // Click Outside to Dismiss
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsSearching(false);
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
      {isSearching && (
        <div
          onClick={() => setIsSearching(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-200"
        />
      )}

      {/* Floating Header Pill Container (Uniform width & height in both states) */}
      <div
        ref={containerRef}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-xl transition-all duration-300"
      >
        <header
          className={`flex items-center justify-between rounded-full glass-panel bg-zinc-900/80 backdrop-blur-2xl border transition-all duration-300 shadow-2xl px-4 h-12 w-full ${
            isSearching
              ? 'border-white/20 bg-zinc-900/95'
              : 'border-white/10'
          }`}
        >
          {isSearching ? (
            /* Active Search Mode: Takes over the entire pill */
            <div className="flex-1 flex items-center gap-3 min-w-0 h-full">
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (query) {
                    setQuery('');
                    setResults([]);
                    inputRef.current?.focus();
                  } else {
                    setIsSearching(false);
                  }
                }}
                className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer"
                title={query ? 'Clear' : 'Close (Esc)'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            /* Clean Initial State: Optional Back Button + Divider + Logo on left, Search on right */
            <>
              {/* Left: Dynamic Back button + Divider + Brand Icon */}
              <div className="flex items-center gap-2.5">
                {onBack && (
                  <>
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
                  </>
                )}

                <div className="flex items-center gap-2 pl-0.5 pr-1 py-1 select-none flex-shrink-0">
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
                </div>
              </div>

              {/* Right: Search Icon Button */}
              <button
                type="button"
                onClick={() => setIsSearching(true)}
                className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition flex-shrink-0 cursor-pointer flex items-center justify-center"
                title="Search (⌘K)"
              >
                <Search className="w-4 h-4" />
              </button>
            </>
          )}
        </header>

        {/* Dropdown Results Anchored to Pill */}
        {isSearching && (query.trim().length > 0 || results.length > 0 || loading) && (
          <div className="mt-2 w-full glass-panel bg-zinc-900/95 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="max-h-[60vh] overflow-y-auto p-2.5 space-y-1">
              {results.length > 0 ? (
                results.map((item) => {
                  const isMovie = item.type === 'movie';
                  const isReady =
                    !!readyMap[item.id] ||
                    !!searchResultsReady[item.id] ||
                    activeRequests[item.id]?.status === 'ready';

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="group flex items-center justify-between gap-3 p-2.5 rounded-2xl hover:bg-zinc-800/80 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Poster Thumbnail */}
                        <div className="w-10 h-14 rounded-xl bg-zinc-800 overflow-hidden flex-shrink-0">
                          {item.poster ? (
                            <img
                              src={item.poster}
                              alt={item.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600">
                              {isMovie ? <Film className="w-5 h-5" /> : <Tv className="w-5 h-5" />}
                            </div>
                          )}
                        </div>

                        {/* Title & Metadata */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs sm:text-sm font-bold text-white group-hover:text-red-400 transition truncate">
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
                            {item.year && <span className="font-mono text-[11px]">{item.year}</span>}
                            {item.rating && (
                              <span className="flex items-center gap-1 text-amber-400 font-semibold text-[11px]">
                                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                <span>{item.rating}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition transform group-hover:translate-x-1 flex-shrink-0 mr-1" />
                    </div>
                  );
                })
              ) : query.trim() && !loading ? (
                <div className="text-center py-8 text-zinc-500 text-xs sm:text-sm font-medium">
                  No titles found for &quot;{query}&quot;
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default HeaderPill;
