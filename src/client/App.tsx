import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  MovieMetadata,
  ShowMetadata,
  EpisodeMetadata,
  Progress,
  Stream,
} from '../main/types/index.js';
import type {
  PlayingMediaInfo,
} from './types/ui.js';
import { ApiClient } from './services/api.js';
import { useSSE } from './hooks/useSSE.js';
import { parseDisplayFileId, getFriendlyErrorMessage, getNextEpisode } from './utils/formatters.js';

import { AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Views & Pages
import { ExploreView } from './views/ExploreView.js';
import { ExploreSkeleton } from './views/ExploreSkeleton.js';
import { MediaDetailView } from './views/MediaDetailView.js';

import { HeaderPill, type HeaderPillShowContext } from './components/HeaderPill.js';
import { HlsPlayer } from './components/HlsPlayer.js';
import { SpatialNavigationProvider, useSpatialNavigation } from './context/SpatialNavigationContext.js';

function AppContent() {
  const { popZone } = useSpatialNavigation();
  // Catalogs & Playback Data State
  const [movies, setMovies] = useState<MovieMetadata[]>([]);
  const [shows, setShows] = useState<ShowMetadata[]>([]);
  const [spotlightItems, setSpotlightItems] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [heroIndex, setHeroIndex] = useState<number>(0);
  const [continueWatching, setContinueWatching] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  const [readyMap, setReadyMap] = useState<Record<string, Stream>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // Modals & Overlays State
  const [selectedMedia, setSelectedMedia] = useState<MovieMetadata | ShowMetadata | null>(null);
  const [playingMedia, setPlayingMedia] = useState<PlayingMediaInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showNavContext, setShowNavContext] = useState<HeaderPillShowContext | null>(null);
  const [detailDragProgress, setDetailDragProgress] = useState<number>(0);

  // In-Memory cache for fully resolved show & movie details and scroll restoration
  const mediaDetailsCacheRef = useRef<Record<string, MovieMetadata | ShowMetadata>>({});
  const exploreScrollYRef = useRef<number>(0);

  // SSE Real-time Updates Hook
  const { activeRequests, setActiveRequests } = useSSE();

  // Initial Catalogs Data Loading
  const loadCatalogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [moviesRes, showsRes, contRes] = await Promise.all([
        ApiClient.getMovies(20).catch(() => ({ metadata: [], progress: {}, ready: {} })),
        ApiClient.getShows(20).catch(() => ({ metadata: [], progress: {}, ready: {} })),
        ApiClient.getContinueWatching(10).catch(() => ({ metadata: [], progress: {}, ready: {} })),
      ]);

      const mList = moviesRes.metadata || [];
      const sList = showsRes.metadata || [];
      setMovies(mList);
      setShows(sList);
      setContinueWatching(contRes.metadata || []);

      setSpotlightItems((prev) => {
        if (prev.length > 0) return prev;
        const combined = [...mList, ...sList].filter(
          (item) => Boolean(item && (item.background || item.poster))
        );
        if (combined.length === 0) return [];
        return [...combined].sort(() => Math.random() - 0.5).slice(0, 5);
      });

      setProgressMap((prev) => ({
        ...prev,
        ...(moviesRes.progress || {}),
        ...(showsRes.progress || {}),
        ...(contRes.progress || {}),
      }));

      setReadyMap((prev) => ({
        ...prev,
        ...(moviesRes.ready || {}),
        ...(showsRes.ready || {}),
        ...(contRes.ready || {}),
      }));
    } catch (err) {
      console.error('Failed to load initial catalogs:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs]);

  // Globally prevent dragging images, media, or links
  useEffect(() => {
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'IMG' ||
        target?.tagName === 'A' ||
        target?.tagName === 'VIDEO' ||
        target?.closest('img, a, video')
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('dragstart', handleDragStart);
    return () => document.removeEventListener('dragstart', handleDragStart);
  }, []);

  // Auto-dismiss Toast Notifications
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Request Media on-demand stream: update state on successful server confirmation
  const handleRequestMedia = async (fileId: string, episodeMeta?: EpisodeMetadata) => {
    try {
      const res = await ApiClient.requestMedia(fileId);
      if (!res) return;

      const parsed = parseDisplayFileId(fileId);

      // 1. Update active requests with server response
      setActiveRequests((prev) => ({
        ...prev,
        [fileId]: {
          fileId: res.id,
          status: res.status,
          progress: res.progress,
        },
      }));

      // 2. Add to continue watching shelf and progress map
      const mediaItem = selectedMedia || movies.find((m) => m.id === parsed.mediaId) || shows.find((s) => s.id === parsed.mediaId);
      if (mediaItem) {
        const now = Date.now();
        const cachedShow = mediaDetailsCacheRef.current[parsed.mediaId] as ShowMetadata | undefined;
        const allKnownEpisodes = cachedShow?.episodes || (mediaItem as ShowMetadata).episodes || [];
        const updatedMediaItem =
          mediaItem.type === 'show' && episodeMeta
            ? {
                ...mediaItem,
                episodes: [
                  episodeMeta,
                  ...(allKnownEpisodes.filter(
                    (e: EpisodeMetadata) => !(e.season === episodeMeta.season && e.episode === episodeMeta.episode)
                  )),
                ],
              }
            : mediaItem;

        setContinueWatching((prev) => [updatedMediaItem, ...prev.filter((item) => item.id !== mediaItem.id)]);
        setProgressMap((prev) => ({
          ...prev,
          [fileId]: prev[fileId] || {
            id: fileId,
            fileId,
            show_id: parsed.isEpisode ? parsed.mediaId : null,
            timestamp: 0,
            runtime: episodeMeta?.runtime ? episodeMeta.runtime * 60 : 0,
            progressPercent: 0,
            duration: episodeMeta?.runtime ? episodeMeta.runtime * 60 : 0,
            last_updated: now,
          },
        }));
      }
    } catch (err: unknown) {
      console.error(`Failed to request media ${fileId}:`, err);
      const friendlyMsg = getFriendlyErrorMessage(err);
      if (friendlyMsg) {
        setToast(friendlyMsg);
      }
    }
  };

  // Pre-validate stream availability before opening player to prevent pre-playback crashes
  const handlePlayMedia = useCallback(async (info: PlayingMediaInfo) => {
    try {
      if (!selectedMedia) {
        // Save current explore view scroll position before entering player directly
        exploreScrollYRef.current = window.scrollY;
      }
      const streamInfo = await ApiClient.getStreamInfo(info.fileId);
      if (streamInfo && streamInfo.url) {
        setPlayingMedia(info);
      }
    } catch (err: unknown) {
      console.error(`Failed to initiate playback for ${info.fileId}:`, err);
      const friendlyMsg = getFriendlyErrorMessage(err);
      if (friendlyMsg) {
        setToast(friendlyMsg);
      }
    }
  }, [selectedMedia]);

  // Update Playback Progress
  const handleProgressUpdate = useCallback(async (fileId: string, timestamp: number, duration: number) => {
    try {
      const percent = duration > 0 ? (timestamp / duration) * 100 : 0;
      const now = Date.now();
      const parsed = parseDisplayFileId(fileId);
      const mediaId = parsed.mediaId;

      setProgressMap((prev) => ({
        ...prev,
        [fileId]: {
          id: fileId,
          fileId,
          show_id: parsed.isEpisode ? mediaId : null,
          timestamp,
          runtime: duration,
          progressPercent: percent,
          duration,
          last_updated: now,
        },
      }));

      // Keep the most recently watched title at the top of Continue Watching
      setContinueWatching((prev) => {
        const item = prev.find((i) => i.id === mediaId) || shows.find((s) => s.id === mediaId) || selectedMedia;
        if (!item) return prev;
        const filtered = prev.filter((i) => i.id !== mediaId);

        let updatedItem = item;
        if (item.type === 'show' && parsed.isEpisode) {
          const cachedShow = mediaDetailsCacheRef.current[mediaId] as ShowMetadata | undefined;
          const currentEp = cachedShow?.episodes?.find((e) => e.season === parsed.season && e.episode === parsed.episode);
          if (currentEp) {
            updatedItem = {
              ...item,
              episodes: [
                currentEp,
                ...((item.episodes || []).filter((e) => !(e.season === currentEp.season && e.episode === currentEp.episode))),
              ],
            };
          }
        }
        return [updatedItem, ...filtered];
      });
    } catch (err) {
      console.error(`Failed to update progress for ${fileId}:`, err);
    }
  }, [selectedMedia, shows]);

  // Resolve next episode metadata for current active playback
  const nextEpisodeMeta = useMemo(() => {
    if (!playingMedia || playingMedia.type !== 'show') return null;
    const activeShowMeta =
      (mediaDetailsCacheRef.current[playingMedia.mediaId] as ShowMetadata | undefined) ||
      (selectedMedia?.id === playingMedia.mediaId ? (selectedMedia as ShowMetadata) : undefined) ||
      shows.find((s) => s.id === playingMedia.mediaId);

    return activeShowMeta
      ? getNextEpisode(activeShowMeta.episodes || [], playingMedia.season, playingMedia.episode)
      : null;
  }, [playingMedia, selectedMedia, shows]);

  const handleNextEpisode = useCallback(() => {
    if (!playingMedia || !nextEpisodeMeta) return;

    const nextFileId = nextEpisodeMeta.id;
    const isReady = !!readyMap[nextFileId] || activeRequests[nextFileId]?.status === 'ready';
    const isPreparing =
      activeRequests[nextFileId]?.status === 'preparing' ||
      activeRequests[nextFileId]?.status === 'queued';

    if (isReady) {
      handleProgressUpdate(
        nextFileId,
        0,
        nextEpisodeMeta.runtime ? nextEpisodeMeta.runtime * 60 : 0
      );
      handlePlayMedia({
        fileId: nextFileId,
        mediaId: playingMedia.mediaId,
        title: playingMedia.title,
        subtitle: nextEpisodeMeta.title
          ? `S${nextEpisodeMeta.season}:E${nextEpisodeMeta.episode} "${nextEpisodeMeta.title}"`
          : `S${nextEpisodeMeta.season}:E${nextEpisodeMeta.episode}`,
        type: 'show',
        season: nextEpisodeMeta.season,
        episode: nextEpisodeMeta.episode,
        poster: nextEpisodeMeta.thumbnail || playingMedia.poster,
        background: playingMedia.background,
      });
    } else {
      // Close player first, then initiate download/transcode request if not in progress
      setPlayingMedia(null);
      if (!isPreparing) {
        handleRequestMedia(nextFileId, nextEpisodeMeta);
      }
    }
  }, [playingMedia, nextEpisodeMeta, readyMap, activeRequests, handleProgressUpdate, handlePlayMedia, handleRequestMedia]);

  const handleCacheMediaDetails = useCallback((meta: MovieMetadata | ShowMetadata) => {
    mediaDetailsCacheRef.current[meta.id] = meta;
    setSelectedMedia((prev) => (prev?.id === meta.id ? meta : prev));
  }, []);

  const handleUpdateProgressMap = useCallback((newProgress: Record<string, Progress>) => {
    setProgressMap((prev) => {
      const merged = { ...prev };
      for (const [key, val] of Object.entries(newProgress)) {
        if (!merged[key] || (val.last_updated && (!merged[key].last_updated || val.last_updated > (merged[key].last_updated || 0)))) {
          merged[key] = val;
        }
      }
      return merged;
    });
  }, []);

  const handleUpdateReadyMap = useCallback((newReady: Record<string, Stream>) => {
    setReadyMap((prev) => ({ ...prev, ...newReady }));
  }, []);

  // Lock background body/html scroll when detail view or player is active
  useEffect(() => {
    if (!selectedMedia && !playingMedia) return;

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      if (exploreScrollYRef.current > 0) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: exploreScrollYRef.current, behavior: 'instant' as ScrollBehavior });
        });
      }
    };
  }, [Boolean(selectedMedia || playingMedia)]);

  const handleSelectMedia = useCallback((media: MovieMetadata | ShowMetadata) => {
    setShowNavContext(null);
    setDetailDragProgress(0);
    if (!selectedMedia) {
      // Save current explore view scroll position before entering detail view
      exploreScrollYRef.current = window.scrollY;
    }
    const cached = mediaDetailsCacheRef.current[media.id] || media;
    setSelectedMedia(cached);
  }, [selectedMedia]);

  const handleShowNavContextChange = useCallback((ctx: HeaderPillShowContext | null) => {
    setShowNavContext((prev) => {
      if (!prev && !ctx) return prev;
      if (
        prev &&
        ctx &&
        prev.title === ctx.title &&
        prev.logo === ctx.logo &&
        prev.activeSeason === ctx.activeSeason &&
        prev.isScrolledPast === ctx.isScrolledPast &&
        prev.seasons.length === ctx.seasons.length &&
        prev.seasons.every((s, i) => s === ctx.seasons[i])
      ) {
        return prev;
      }
      return ctx;
    });
  }, []);

  const handleDragProgress = useCallback((progress: number) => {
    setDetailDragProgress((prev) => {
      if (prev === progress) return prev;
      if (Math.abs(prev - progress) < 0.02 && progress !== 0 && progress !== 1) return prev;
      return progress;
    });
  }, []);

  const handleBack = useCallback(() => {
    setShowNavContext(null);
    setDetailDragProgress(0);
    popZone('detail');
    setSelectedMedia(null);
  }, [popZone]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-red-600 selection:text-white overflow-x-hidden">
      {/* 1. Floating Top Glossy Header Pill with Search, Dynamic Back & Alert HUD */}
      <HeaderPill
        onSelectMedia={handleSelectMedia}
        onBack={selectedMedia ? handleBack : undefined}
        readyMap={readyMap}
        activeRequests={activeRequests}
        toast={toast}
        onClearToast={() => setToast(null)}
        showContext={showNavContext}
        dragProgress={selectedMedia ? detailDragProgress : 0}
      />

      {/* 2. Main Screen Area (Explore View + Stacked Media Detail Page) */}
      <main className="flex-1 overflow-x-hidden">
        {loading ? (
          <div className="pt-[calc(env(safe-area-inset-top,0px)+5.75rem)] sm:pt-[104px]">
            <ExploreSkeleton />
          </div>
        ) : (
          <>
            {/* Base Layer: Explore Screen (Always preserved underneath) */}
            <div
              className={`pt-[calc(env(safe-area-inset-top,0px)+5.75rem)] sm:pt-[104px] ${
                selectedMedia ? 'pointer-events-none select-none' : ''
              }`}
            >
              <ExploreView
                movies={movies}
                shows={shows}
                spotlightItems={spotlightItems}
                heroIndex={heroIndex}
                onHeroIndexChange={setHeroIndex}
                continueWatching={continueWatching}
                progressMap={progressMap}
                readyMap={readyMap}
                activeRequests={activeRequests}
                onSelectMedia={handleSelectMedia}
                onPlayDirect={handlePlayMedia}
              />
            </div>

            {/* Stacked Layer: Media Detail View Modal / Sheet */}
            <AnimatePresence>
              {selectedMedia && (
                <MediaDetailView
                  key={`media-detail-${selectedMedia.id}`}
                  media={selectedMedia}
                  progressMap={progressMap}
                  readyMap={readyMap}
                  activeRequests={activeRequests}
                  isCached={!!mediaDetailsCacheRef.current[selectedMedia.id]}
                  isActive={!playingMedia}
                  onBack={handleBack}
                  onPlayMedia={handlePlayMedia}
                  onRequestMedia={handleRequestMedia}
                  onCacheMediaDetails={handleCacheMediaDetails}
                  onUpdateProgressMap={handleUpdateProgressMap}
                  onUpdateReadyMap={handleUpdateReadyMap}
                  onShowNavContextChange={handleShowNavContextChange}
                  onDragProgress={handleDragProgress}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </main>

      {/* 4. Custom Netflix-Grade HLS Video Player */}
      <AnimatePresence>
        {playingMedia && (
          <motion.div
            key="hls-player-overlay"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[60] bg-black"
          >
            <HlsPlayer
              key={playingMedia.fileId}
              media={playingMedia}
              initialTimestamp={progressMap[playingMedia.fileId]?.timestamp || 0}
              onClose={() => {
                popZone('player');
                setPlayingMedia(null);
              }}
              onProgressUpdate={handleProgressUpdate}
              onNextEpisode={nextEpisodeMeta ? handleNextEpisode : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function App() {
  return (
    <SpatialNavigationProvider initialZone="explore">
      <AppContent />
    </SpatialNavigationProvider>
  );
}

export default App;
