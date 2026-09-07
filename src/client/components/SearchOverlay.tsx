import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Film, Tv, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { MovieMetadata, ShowMetadata, Stream, UserActiveMediaState } from '../../main/types/index.js';
import { ApiClient } from '../services/api.js';
import { RatingBadge } from './common/RatingBadge.js';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMedia: (media: MovieMetadata | ShowMetadata) => void;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
}

export function SearchOverlay({
  isOpen,
  onClose,
  onSelectMedia,
  readyMap,
  activeRequests,
}: SearchOverlayProps) {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [searchResultsReady, setSearchResultsReady] = useState<Record<string, Stream>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
      setSearchResultsReady({});
    }
  }, [isOpen]);

  // Debounced search query
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
    }, 300);

    return () => clearTimeout(handler);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-start justify-center pt-16 sm:pt-24 p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl glass-panel rounded-3xl overflow-hidden shadow-2xl border border-zinc-700/60 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
          <Search className="w-5 h-5 text-indigo-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, TV shows, genres, actors..."
            className="flex-1 bg-transparent text-white placeholder-zinc-500 text-base font-medium focus:outline-none"
          />
          {loading && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
          {query && !loading && (
            <button
              onClick={() => setQuery('')}
              className="p-1 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs font-semibold text-zinc-400 hover:text-white px-2 py-1 rounded-lg bg-zinc-800"
          >
            Esc
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-3 space-y-1.5">
          {results.length > 0 ? (
            results.map((item) => {
              const isMovie = item.type === 'movie';
              const isReady = !!readyMap[item.id] || !!searchResultsReady[item.id] || activeRequests[item.id]?.status === 'ready';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectMedia(item);
                    onClose();
                  }}
                  className="group flex items-center justify-between gap-4 p-3 rounded-2xl hover:bg-zinc-800/80 transition cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-16 rounded-xl bg-zinc-800 overflow-hidden flex-shrink-0">
                      {item.poster ? (
                        <img
                          src={item.poster}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          {isMovie ? <Film className="w-6 h-6" /> : <Tv className="w-6 h-6" />}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white group-hover:text-indigo-300 transition truncate">
                          {item.title}
                        </h4>
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-white/5">
                          {isMovie ? 'Movie' : 'Show'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs text-zinc-400 mt-1.5">
                        <span className="font-mono">{item.year || 'N/A'}</span>
                        <RatingBadge rating={item.rating} size="sm" />
                        {isReady && isMovie && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-zinc-900 px-2 py-0.5 rounded-lg border border-zinc-800">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Ready
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-white transition transform group-hover:translate-x-1" />
                </div>
              );
            })
          ) : query.trim() && !loading ? (
            <div className="text-center py-12 text-zinc-500 text-sm font-medium">
              No titles found for &quot;{query}&quot;
            </div>
          ) : (
            <div className="text-center py-10 text-zinc-500 text-xs">
              Search by title, IMDB ID, or actor
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
