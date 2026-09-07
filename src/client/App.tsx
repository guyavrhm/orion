import React, { useState, useEffect, useCallback } from 'react';
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

// Core UI Components
import { HeaderPill } from './components/HeaderPill.js';
import { MediaDetailModal } from './components/MediaDetailModal.js';
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
      setContinueWatching((prev) => {
        const filtered = prev.filter((item) => item.id !== mediaItem.id);
        return [mediaItem, ...filtered];
      });
      setProgressMap((prev) => ({
        ...prev,
        [fileId]: prev[fileId] || {
          fileId,
          timestamp: 0,
          progressPercent: 0,
          duration: 0,
          updatedAt: new Date().toISOString(),
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
  const handleProgressUpdate = async (fileId: string, timestamp: number, duration: number) => {
    try {
      const percent = duration > 0 ? (timestamp / duration) * 100 : 0;
      setProgressMap((prev) => ({
        ...prev,
        [fileId]: {
          fileId,
          timestamp,
          progressPercent: percent,
          duration,
          updatedAt: new Date().toISOString(),
        },
      }));

      // Keep the most recently watched title at the top of Continue Watching
      const parsed = parseDisplayFileId(fileId);
      const mediaId = parsed.mediaId;
      setContinueWatching((prev) => {
        const itemIdx = prev.findIndex((item) => item.id === mediaId);
        if (itemIdx <= 0) return prev;
        const item = prev[itemIdx];
        const next = [...prev];
        next.splice(itemIdx, 1);
        return [item, ...next];
      });
    } catch (err) {
      console.error(`Failed to update progress for ${fileId}:`, err);
    }
  };

  // Keyboard Shortcuts (Escape to close details modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedMedia) setSelectedMedia(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMedia]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* 1. Floating Top Glossy Header Pill with Search */}
      <HeaderPill
        onSelectMedia={setSelectedMedia}
        readyMap={readyMap}
        activeRequests={activeRequests}
      />

      {/* 2. Main Screen Area */}
      <main className="flex-1 pt-16 sm:pt-20 transition-all">
        {loading ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm font-semibold tracking-wide text-zinc-400">Loading Orion Catalog...</span>
          </div>
        ) : (
          <ExploreView
            movies={movies}
            shows={shows}
            continueWatching={continueWatching}
            progressMap={progressMap}
            readyMap={readyMap}
            activeRequests={activeRequests}
            onSelectMedia={setSelectedMedia}
            onPlayDirect={setPlayingMedia}
          />
        )}
      </main>

      {/* 3. Media Info & Description View */}
      <MediaDetailModal
        media={selectedMedia}
        progressMap={progressMap}
        readyMap={readyMap}
        activeRequests={activeRequests}
        onClose={() => setSelectedMedia(null)}
        onPlayMedia={setPlayingMedia}
        onRequestMedia={handleRequestMedia}
      />

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
            <Info className="w-5 h-5 text-indigo-400 flex-shrink-0" />
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
