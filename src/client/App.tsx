import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  MovieMetadata,
  ShowMetadata,
  Progress,
  Stream,
} from '../main/types/index.js';
import type {
  PlayingMediaInfo,
} from './types/ui.js';
import { ApiClient } from './services/api.js';
import { useSSE } from './hooks/useSSE.js';
import { parseDisplayFileId } from './utils/formatters.js';

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

// Views & Pages
import { ExploreView } from './views/ExploreView.js';
import { MediaDetailView } from './views/MediaDetailView.js';

// Core UI Components
import { HeaderPill } from './components/HeaderPill.js';
import { HlsPlayer } from './components/HlsPlayer.js';

export function App() {
  // Catalogs & Playback Data State
  const [movies, setMovies] = useState<MovieMetadata[]>([]);
  const [shows, setShows] = useState<ShowMetadata[]>([]);
  const [continueWatching, setContinueWatching] = useState<(MovieMetadata | ShowMetadata)[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
  const [readyMap, setReadyMap] = useState<Record<string, Stream>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // Modals & Overlays State
  const [selectedMedia, setSelectedMedia] = useState<MovieMetadata | ShowMetadata | null>(null);
  const [playingMedia, setPlayingMedia] = useState<PlayingMediaInfo | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

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

      setMovies(moviesRes.metadata || []);
      setShows(showsRes.metadata || []);
      setContinueWatching(contRes.metadata || []);

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

  // Auto-dismiss Toast Notifications
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Request Media on-demand stream with optimistic update
  const handleRequestMedia = async (fileId: string) => {
    // 1. Optimistic immediate state update so user sees queued indicator instantly
    setActiveRequests((prev) => ({
      ...prev,
      [fileId]: {
        fileId,
        status: 'queued',
        progress: '0.00',
        updatedAt: Date.now(),
      },
    }));

    // 2. Optimistically add to continue watching shelf and progress map
    const parsed = parseDisplayFileId(fileId);
    const mediaItem = selectedMedia || movies.find((m) => m.id === parsed.mediaId) || shows.find((s) => s.id === parsed.mediaId);
    if (mediaItem) {
      const now = Date.now();
      setContinueWatching((prev) => {
        const filtered = prev.filter((item) => item.id !== mediaItem.id);
        return [mediaItem, ...filtered];
      });
      setProgressMap((prev) => ({
        ...prev,
        [fileId]: prev[fileId] || {
          id: fileId,
          fileId,
          show_id: parsed.isEpisode ? parsed.mediaId : null,
          timestamp: 0,
          runtime: 0,
          progressPercent: 0,
          duration: 0,
          last_updated: now,
          updatedAt: new Date(now).toISOString(),
        },
      }));
    }

    try {
      const res = await ApiClient.requestMedia(fileId);
      if (res) {
        setActiveRequests((prev) => ({
          ...prev,
          [fileId]: {
            fileId: res.id,
            status: res.status,
            progress: res.progress,
            updatedAt: Date.now(),
          },
        }));
      }
    } catch (err: unknown) {
      console.error(`Failed to request media ${fileId}:`, err);
      // Revert optimistic state upon failure
      setActiveRequests((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      const errorMsg = err instanceof Error ? err.message : 'Failed to request stream';
      setToast({ message: errorMsg, type: 'error' });
    }
  };

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
          updatedAt: new Date(now).toISOString(),
        },
      }));

      // Keep the most recently watched title at the top of Continue Watching
      setContinueWatching((prev) => {
        const item = prev.find((i) => i.id === mediaId) || shows.find((s) => s.id === mediaId) || selectedMedia;
        if (!item) return prev;
        const filtered = prev.filter((i) => i.id !== mediaId);
        return [item, ...filtered];
      });
    } catch (err) {
      console.error(`Failed to update progress for ${fileId}:`, err);
    }
  }, [selectedMedia, shows]);

  // In-Memory cache for fully resolved show & movie details
  const mediaDetailsCacheRef = useRef<Record<string, MovieMetadata | ShowMetadata>>({});

  const handleCacheMediaDetails = useCallback((meta: MovieMetadata | ShowMetadata) => {
    mediaDetailsCacheRef.current[meta.id] = meta;
  }, []);

  // Scroll Restoration for Explore / Detail navigation
  const exploreScrollYRef = useRef<number>(0);

  const handleSelectMedia = useCallback((media: MovieMetadata | ShowMetadata) => {
    if (!selectedMedia) {
      // Save current explore view scroll position before entering detail view
      exploreScrollYRef.current = window.scrollY;
    }
    const cached = mediaDetailsCacheRef.current[media.id] || media;
    setSelectedMedia(cached);
  }, [selectedMedia]);

  const handleBack = useCallback(() => {
    setSelectedMedia(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: exploreScrollYRef.current, behavior: 'instant' as ScrollBehavior });
    });
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-red-600 selection:text-white">
      {/* 1. Floating Top Glossy Header Pill with Search & Dynamic Back */}
      <HeaderPill
        onSelectMedia={handleSelectMedia}
        onBack={selectedMedia ? handleBack : undefined}
        activeRequests={activeRequests}
      />

      {/* 2. Main Screen Area (Explore View or Media Detail Page) */}
      <main className="flex-1 transition-all">
        {loading ? (
          <div className="min-h-[60vh] pt-28 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm font-semibold tracking-wide text-zinc-400">Loading Orion Catalog...</span>
          </div>
        ) : selectedMedia ? (
          <MediaDetailView
            media={selectedMedia}
            progressMap={progressMap}
            readyMap={readyMap}
            activeRequests={activeRequests}
            isCached={!!mediaDetailsCacheRef.current[selectedMedia.id]}
            onBack={handleBack}
            onPlayMedia={setPlayingMedia}
            onRequestMedia={handleRequestMedia}
            onCacheMediaDetails={handleCacheMediaDetails}
          />
        ) : (
          <div className="pt-16 sm:pt-20">
            <ExploreView
              movies={movies}
              shows={shows}
              continueWatching={continueWatching}
              progressMap={progressMap}
              readyMap={readyMap}
              activeRequests={activeRequests}
              onSelectMedia={handleSelectMedia}
              onPlayDirect={setPlayingMedia}
            />
          </div>
        )}
      </main>

      {/* 4. Custom Netflix-Grade HLS Video Player */}
      {playingMedia && (
        <HlsPlayer
          media={playingMedia}
          initialTimestamp={progressMap[playingMedia.fileId]?.timestamp || 0}
          onClose={() => setPlayingMedia(null)}
          onProgressUpdate={handleProgressUpdate}
        />
      )}

      {/* 7. Floating Toast Alerts */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 backdrop-blur-xl animate-in slide-in-from-bottom-5 duration-200"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          ) : toast.type === 'info' ? (
            <Info className="w-5 h-5 text-zinc-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          )}
          <span className="text-xs font-semibold">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
