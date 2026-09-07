import React from 'react';
import { Play, PlusCircle, RotateCcw, Film, Tv } from 'lucide-react';
import type { MovieMetadata, ShowMetadata, Progress, Stream, UserActiveMediaState } from '../../main/types/index.js';
import type { PlayingMediaInfo } from '../types/ui.js';
import { MediaCard } from '../components/common/MediaCard.js';
import { RatingBadge } from '../components/common/RatingBadge.js';
import { calculateProgressPercent, parseDisplayFileId } from '../utils/formatters.js';

interface ExploreViewProps {
  movies: MovieMetadata[];
  shows: ShowMetadata[];
  continueWatching?: (MovieMetadata | ShowMetadata)[];
  progressMap: Record<string, Progress>;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
  onSelectMedia: (media: MovieMetadata | ShowMetadata) => void;
  onPlayDirect: (info: PlayingMediaInfo) => void;
}

export function ExploreView({
  movies,
  shows,
  continueWatching = [],
  progressMap,
  readyMap,
  activeRequests,
  onSelectMedia,
  onPlayDirect,
}: ExploreViewProps) {
  // Hero Movie
  const heroMovie = movies[0];
  const isHeroMovieReady = heroMovie
    ? !!readyMap[heroMovie.id] || activeRequests[heroMovie.id]?.status === 'ready'
    : false;

  // Helper to check ready status for any media item
  const isMediaReady = (item: MovieMetadata | ShowMetadata) => {
    if (item.type === 'movie') {
      return !!readyMap[item.id] || activeRequests[item.id]?.status === 'ready';
    }
    // For show, check if the show or any of its episodes is marked ready
    const hasShowStream =
      !!readyMap[item.id] ||
      activeRequests[item.id]?.status === 'ready' ||
      ('episodes' in item &&
        Array.isArray(item.episodes) &&
        item.episodes.some(
          (ep) =>
            !!readyMap[`${item.id}_s${ep.season}_e${ep.episode}`] ||
            activeRequests[`${item.id}_s${ep.season}_e${ep.episode}`]?.status === 'ready'
        ));
    return hasShowStream;
  };

  // Featured TV Show
  const heroShow = shows[0];
  const otherMovies = movies.slice(1);
  const otherShows = shows.slice(1);

  return (
    <div className="min-h-screen max-w-7xl mx-auto px-4 sm:px-8 py-8 pb-28 space-y-10 animate-in fade-in duration-300">
      {/* 1. Hero Section: Featured Movie & Show */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Large Hero Feature Movie Tile */}
        {heroMovie && (
          <div
            onClick={() => onSelectMedia(heroMovie)}
            className="md:col-span-2 relative h-80 sm:h-96 rounded-3xl overflow-hidden glass-panel border border-zinc-800 p-6 sm:p-8 flex flex-col justify-between group cursor-pointer transition-all duration-300"
          >
            <div className="absolute inset-0 -z-10 bg-zinc-950">
              {heroMovie.background || heroMovie.poster ? (
                <img
                  src={heroMovie.background || heroMovie.poster || ''}
                  alt={heroMovie.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-40"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
            </div>

            <div className="flex items-center justify-end">
              <RatingBadge rating={heroMovie.rating} size="md" />
            </div>

            <div className="space-y-3">
              {heroMovie.logo ? (
                <div className="pb-1">
                  <img
                    src={heroMovie.logo}
                    alt={heroMovie.title}
                    className="max-h-14 sm:max-h-20 w-auto max-w-sm object-contain"
                  />
                </div>
              ) : (
                <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
                  {heroMovie.title}
                </h2>
              )}
              <p className="text-xs sm:text-sm text-zinc-300 line-clamp-2 max-w-xl">
                {heroMovie.description}
              </p>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isHeroMovieReady) {
                      onPlayDirect({
                        fileId: heroMovie.id,
                        mediaId: heroMovie.id,
                        title: heroMovie.title,
                        type: 'movie',
                        poster: heroMovie.poster,
                        background: heroMovie.background,
                      });
                    } else {
                      onSelectMedia(heroMovie);
                    }
                  }}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
                >
                  {isHeroMovieReady ? <Play className="w-4 h-4 fill-current" /> : <PlusCircle className="w-4 h-4" />}
                  <span>{isHeroMovieReady ? 'Play' : 'Request'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Side Highlight Tile: Featured Show */}
        {heroShow && (
          <div
            onClick={() => onSelectMedia(heroShow)}
            className="relative h-80 sm:h-96 rounded-3xl overflow-hidden glass-panel border border-zinc-800 p-6 flex flex-col justify-between group cursor-pointer transition-all duration-300"
          >
            <div className="absolute inset-0 -z-10 bg-zinc-950">
              {heroShow.background || heroShow.poster ? (
                <img
                  src={heroShow.background || heroShow.poster || ''}
                  alt={heroShow.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 opacity-40"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
            </div>

            <div className="flex items-center justify-end gap-2">
              {heroShow.year && <span className="text-xs font-bold text-zinc-300">{heroShow.year}</span>}
            </div>

            <div className="space-y-2">
              {heroShow.logo ? (
                <div className="pb-1">
                  <img
                    src={heroShow.logo}
                    alt={heroShow.title}
                    className="max-h-10 sm:max-h-14 w-auto max-w-xs object-contain"
                  />
                </div>
              ) : (
                <h3 className="text-xl font-black text-white tracking-tight line-clamp-2">
                  {heroShow.title}
                </h3>
              )}
              <p className="text-xs text-zinc-400 line-clamp-2">
                {heroShow.description || 'Watch full seasons with automated subtitle sync.'}
              </p>
              <div className="pt-2">
                <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-400 group-hover:text-indigo-300">
                  Explore →
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 2. Continue Watching Shelf */}
      {continueWatching.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-indigo-400" />
            <span>Continue Watching</span>
          </h3>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 pt-1">
            {continueWatching.map((item) => {
              const isMovie = item.type === 'movie';
              const isReady = isMediaReady(item);
              const showEp = !isMovie && 'episodes' in item && Array.isArray(item.episodes) && item.episodes.length > 0 ? item.episodes[0] : null;
              const epId = showEp ? (showEp.id || `${item.id}_s${showEp.season}_e${showEp.episode}`) : null;
              const progObj = isMovie
                ? progressMap[item.id]
                : (epId && progressMap[epId]) || Object.entries(progressMap).find(([k]) => k.startsWith(`${item.id}_s`))?.[1] || progressMap[item.id];
              const percent = calculateProgressPercent(progObj);

              const showEpInfo = (() => {
                if (isMovie) return null;
                if (showEp && showEp.season && showEp.episode) {
                  return { season: showEp.season, episode: showEp.episode };
                }
                const matchedKey = Object.keys(progressMap).find((k) => k.startsWith(`${item.id}_s`));
                if (matchedKey) {
                  const parsed = parseDisplayFileId(matchedKey);
                  if (parsed.season && parsed.episode) {
                    return { season: parsed.season, episode: parsed.episode };
                  }
                }
                return null;
              })();

              const subtitle = isMovie 
                ? item.year 
                : showEpInfo 
                  ? `S${showEpInfo.season} E${showEpInfo.episode}` 
                  : (item.year || 'Show');

              return (
                <MediaCard
                  key={`continue-${item.id}`}
                  className="w-36 sm:w-44 flex-shrink-0"
                  title={item.title}
                  poster={item.poster}
                  type={item.type}
                  year={item.year}
                  subtitle={subtitle}
                  isReady={isReady}
                  progressPercent={percent}
                  onClick={() => {
                    if (isMovie && isReady) {
                      onPlayDirect({
                        fileId: item.id,
                        mediaId: item.id,
                        title: item.title,
                        type: 'movie',
                        poster: item.poster,
                        background: item.background,
                      });
                    } else {
                      onSelectMedia(item);
                    }
                  }}
                  onPlayDirect={
                    isMovie && isReady
                      ? () =>
                          onPlayDirect({
                            fileId: item.id,
                            mediaId: item.id,
                            title: item.title,
                            type: 'movie',
                            poster: item.poster,
                            background: item.background,
                          })
                      : undefined
                  }
                />
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Horizontal Row of Popular Movies */}
      <section className="space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Film className="w-4 h-4 text-indigo-400" />
          <span>Popular Movies</span>
        </h3>
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 pt-1">
          {otherMovies.map((m) => {
            const isReady = isMediaReady(m);
            const percent = calculateProgressPercent(progressMap[m.id]);

            return (
              <MediaCard
                key={m.id}
                className="w-36 sm:w-44 flex-shrink-0"
                title={m.title}
                poster={m.poster}
                type={m.type}
                year={m.year}
                isReady={isReady}
                progressPercent={percent}
                onClick={() => onSelectMedia(m)}
              />
            );
          })}
        </div>
      </section>

      {/* 4. Horizontal Row of Trending TV Shows */}
      <section className="space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Tv className="w-4 h-4 text-indigo-400" />
          <span>Trending TV Shows</span>
        </h3>
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 pt-1">
          {otherShows.map((s) => {
            const isReady = isMediaReady(s);

            return (
              <MediaCard
                key={s.id}
                className="w-36 sm:w-44 flex-shrink-0"
                title={s.title}
                poster={s.poster}
                type={s.type}
                year={s.year}
                isReady={isReady}
                onClick={() => onSelectMedia(s)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
