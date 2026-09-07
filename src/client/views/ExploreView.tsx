import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, Film, Tv } from 'lucide-react';
import type { MovieMetadata, ShowMetadata, Progress, Stream, UserActiveMediaState } from '../../main/types/index.js';
import type { PlayingMediaInfo } from '../types/ui.js';
import { MediaCard } from '../components/common/MediaCard.js';
import { ContinueWatchingCard } from '../components/common/ContinueWatchingCard.js';
import { Hero3DCarousel } from '../components/common/Hero3DCarousel.js';
import { calculateProgressPercent, parseDisplayFileId } from '../utils/formatters.js';

interface MediaCarouselRowProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function MediaCarouselRow({ title, icon, children }: MediaCarouselRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = rowRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, children]);

  const handleScroll = (direction: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.75;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <section className="space-y-4 group/carousel relative">
      <div className="flex items-center justify-between">
        <h3 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2.5">
          {icon}
          <span>{title}</span>
        </h3>

        {/* Small header navigation chevrons on hover */}
        <div className="hidden sm:flex items-center gap-1.5 opacity-0 group-hover/carousel:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => handleScroll('left')}
            disabled={!canScrollLeft}
            className={`p-1.5 rounded-full border border-white/10 glass-panel bg-zinc-900/80 transition cursor-pointer ${
              canScrollLeft ? 'text-white hover:bg-white/20' : 'text-zinc-600 opacity-30 cursor-not-allowed'
            }`}
            title="Scroll Left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleScroll('right')}
            disabled={!canScrollRight}
            className={`p-1.5 rounded-full border border-white/10 glass-panel bg-zinc-900/80 transition cursor-pointer ${
              canScrollRight ? 'text-white hover:bg-white/20' : 'text-zinc-600 opacity-30 cursor-not-allowed'
            }`}
            title="Scroll Right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative">
        {/* Scroll Container */}
        <div
          ref={rowRef}
          className="flex gap-4 sm:gap-5 overflow-x-auto no-scrollbar pb-3 pt-1 scroll-smooth"
        >
          {children}
        </div>
      </div>
    </section>
  );
}

interface ExploreViewProps {
  movies: MovieMetadata[];
  shows: ShowMetadata[];
  spotlightItems?: (MovieMetadata | ShowMetadata)[];
  heroIndex?: number;
  onHeroIndexChange?: (index: number) => void;
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
  spotlightItems,
  heroIndex,
  onHeroIndexChange,
  continueWatching = [],
  progressMap,
  readyMap,
  activeRequests,
  onSelectMedia,
  onPlayDirect,
}: ExploreViewProps) {
  // Curate 5 spotlight titles (use persistent spotlight items from props, or compute fallback)
  const spotlightList = useMemo(() => {
    if (spotlightItems && spotlightItems.length > 0) {
      return spotlightItems;
    }
    const combined = [...movies, ...shows].filter(
      (item) => Boolean(item && (item.background || item.poster))
    );
    if (combined.length === 0) return [];
    return combined.slice(0, 5);
  }, [spotlightItems, movies, shows]);

  // Helper to check ready status for any media item
  const isMediaReady = useCallback(
    (item: MovieMetadata | ShowMetadata) => {
      if (!item) return false;
      if (item.type === 'movie') {
        return !!readyMap[item.id] || activeRequests[item.id]?.status === 'ready';
      }
      return (
        !!readyMap[item.id] ||
        activeRequests[item.id]?.status === 'ready' ||
        ('episodes' in item &&
          Array.isArray(item.episodes) &&
          item.episodes.some(
            (ep) =>
              !!readyMap[`${item.id}_s${ep.season}_e${ep.episode}`] ||
              activeRequests[`${item.id}_s${ep.season}_e${ep.episode}`]?.status === 'ready'
          ))
      );
    },
    [readyMap, activeRequests]
  );

  return (
    <div className="min-h-screen pb-28 space-y-8 sm:space-y-10 animate-in fade-in duration-300 overflow-x-hidden">
      {/* 1. Full-Bleed 3D Cover Flow Hero Carousel reaching edge of screen */}
      {spotlightList.length > 0 && (
        <div className="w-full overflow-hidden">
          <Hero3DCarousel
            items={spotlightList}
            activeIndex={heroIndex}
            onActiveIndexChange={onHeroIndexChange}
            onSelectMedia={onSelectMedia}
          />
        </div>
      )}

      {/* 2. Main Content Sections Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-10">
        {/* 2.1 Widescreen 16:9 Landscape "Continue Watching" Shelf */}
        {continueWatching.length > 0 && (
          <MediaCarouselRow
            title="Continue Watching"
            icon={<RotateCcw className="w-4 h-4 text-red-400" />}
          >
          {continueWatching.map((item) => {
            const isMovie = item.type === 'movie';

            if (isMovie) {
              const isReady = isMediaReady(item);
              const progObj = progressMap[item.id];
              const percent = calculateProgressPercent(progObj);
              const activeRequest = activeRequests[item.id];
              const subtitle = item.year || 'Movie';

              return (
                <ContinueWatchingCard
                  key={`continue-${item.id}`}
                  className="w-56 sm:w-72"
                  title={item.title}
                  subtitle={subtitle}
                  thumbnail={item.background || item.poster}
                  type="movie"
                  progressPercent={percent}
                  isReady={isReady}
                  activeRequest={activeRequest}
                  onClick={() => {
                    if (isReady) {
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
                    isReady
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
            }

            // TV Show Handling: Find the latest active episode strictly by recent progress
            const showProgressEntries = Object.entries(progressMap)
              .filter(([k, v]) => v && (v.show_id === item.id || k.startsWith(`${item.id}_s`)))
              .map(([k, v]) => {
                const parsed = parseDisplayFileId(k);
                const lastUpdated = v.last_updated || (v.updatedAt ? new Date(v.updatedAt).getTime() : 0) || 0;
                return { key: k, parsed, progress: v, lastUpdated };
              })
              .sort((a, b) => b.lastUpdated - a.lastUpdated);

            const latestProgress = showProgressEntries[0];
            const fallbackEp =
              'episodes' in item && Array.isArray(item.episodes) && item.episodes.length > 0
                ? item.episodes[0]
                : null;

            const activeEpFileId =
              latestProgress?.key ||
              (fallbackEp ? fallbackEp.id || `${item.id}_s${fallbackEp.season}_e${fallbackEp.episode}` : null);
            const activeSeason = latestProgress?.parsed?.season || fallbackEp?.season || 1;
            const activeEpisode = latestProgress?.parsed?.episode || fallbackEp?.episode || 1;
            const activeProgObj = latestProgress?.progress || (activeEpFileId ? progressMap[activeEpFileId] : null);
            const percent = calculateProgressPercent(activeProgObj);

            const isReady = activeEpFileId
              ? !!readyMap[activeEpFileId] || activeRequests[activeEpFileId]?.status === 'ready'
              : false;

            const activeRequest = activeEpFileId ? activeRequests[activeEpFileId] : undefined;

            const epMeta =
              ('episodes' in item && Array.isArray(item.episodes)
                ? item.episodes.find((ep) => ep.season === activeSeason && ep.episode === activeEpisode)
                : null) || fallbackEp;

            const subtitle = epMeta?.title
              ? `S${activeSeason}:E${activeEpisode} "${epMeta.title}"`
              : `Season ${activeSeason} • Episode ${activeEpisode}`;

            return (
              <ContinueWatchingCard
                key={`continue-${item.id}`}
                className="w-56 sm:w-72"
                title={item.title}
                subtitle={subtitle}
                thumbnail={epMeta?.thumbnail || item.background || item.poster}
                type="show"
                progressPercent={percent}
                isReady={isReady}
                activeRequest={activeRequest}
                onClick={() => onSelectMedia(item)}
                onPlayDirect={
                  isReady && activeEpFileId
                    ? () =>
                        onPlayDirect({
                          fileId: activeEpFileId,
                          mediaId: item.id,
                          title: item.title,
                          subtitle: epMeta?.title
                            ? `S${activeSeason}E${activeEpisode}: ${epMeta.title}`
                            : `S${activeSeason}E${activeEpisode}`,
                          type: 'show',
                          season: activeSeason,
                          episode: activeEpisode,
                          poster: epMeta?.thumbnail || item.poster,
                          background: item.background,
                        })
                    : undefined
                }
              />
            );
          })}
        </MediaCarouselRow>
      )}

      {/* 3. Popular Movies Row */}
      {movies.length > 0 && (
        <MediaCarouselRow
          title="Popular Movies"
          icon={<Film className="w-4 h-4 text-red-400" />}
        >
          {movies.map((m) => {
            const isReady = isMediaReady(m);
            const percent = calculateProgressPercent(progressMap[m.id]);

            return (
              <MediaCard
                key={m.id}
                className="w-36 sm:w-44"
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
        </MediaCarouselRow>
      )}

      {/* 4. Trending TV Shows Row */}
      {shows.length > 0 && (
        <MediaCarouselRow
          title="Trending TV Shows"
          icon={<Tv className="w-4 h-4 text-red-400" />}
        >
          {shows.map((s) => {
            const isReady = isMediaReady(s);

            return (
              <MediaCard
                key={s.id}
                className="w-36 sm:w-44"
                title={s.title}
                poster={s.poster}
                type={s.type}
                year={s.year}
                isReady={isReady}
                onClick={() => onSelectMedia(s)}
              />
            );
          })}
        </MediaCarouselRow>
      )}
      </div>
    </div>
  );
}

export default ExploreView;

