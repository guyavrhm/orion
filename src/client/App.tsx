import React, { useState, useEffect, useCallback } from 'react';
import type {
  MovieMetadata,
  ShowMetadata,
  Progress,
  Stream,
} from '../main/types/index.js';
import type {
  NavigationTab,
  PlayingMediaInfo,
} from './types/ui.js';
import { ApiClient } from './services/api.js';
import { useSSE } from './hooks/useSSE.js';

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

// Views & Pages
import { ExploreView } from './views/ExploreView.js';

// Core UI Components
import { SidebarNav } from './components/SidebarNav.js';
import { MediaDetailModal } from './components/MediaDetailModal.js';
import { QueueDrawer } from './components/QueueDrawer.js';
import { SearchOverlay } from './components/SearchOverlay.js';
import { HlsPlayer } from './components/HlsPlayer.js';

export function App() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('explore');

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
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isQueueOpen, setIsQueueOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

  // SSE Real-time Updates Hook
  const { activeRequests, refreshQueue, setActiveRequests } = useSSE();

  // Initial Catalogs Data Loading
  const loadCatalogs = useCallback(async () => {
    setLoading(true);
    try {
      const [moviesRes, showsRes, contRes] = await Promise.all([
        ApiClient.getMovies(20).catch(() => ({ metadata: [], progress: {}, ready: {} })),
        ApiClient.getShows(20).catch(() => ({ metadata: [], progress: {}, ready: {} })),
        ApiClient.getContinueWatching(10).catch(() => ({ metadata: [], progress: {}, ready: {} })),
      ]);

      setMovies(moviesRes.metadata || []);
      setShows(showsRes.metadata || []);
      setContinueWatching(contRes.metadata || []);

      setProgressMap({
        ...(moviesRes.progress || {}),
        ...(showsRes.progress || {}),
        ...(contRes.progress || {}),
      });

      setReadyMap({
        ...(moviesRes.ready || {}),
        ...(showsRes.ready || {}),
        ...(contRes.ready || {}),
      });
    } catch (err) {
      console.error('Failed to load initial catalogs:', err);
    } finally {
      setLoading(false);
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
      await refreshQueue();
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
    } catch (err) {
      console.error(`Failed to update progress for ${fileId}:`, err);
    }
  };

  // Keyboard Shortcuts (Cmd+K / Ctrl+K for search, Escape to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        if (isSearchOpen) setIsSearchOpen(false);
        else if (isQueueOpen) setIsQueueOpen(false);
        else if (selectedMedia) setSelectedMedia(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, isQueueOpen, selectedMedia]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* 1. Vertical Side Rail Navigation */}
      <SidebarNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSearch={() => setIsSearchOpen(true)}
        onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
        activeRequests={activeRequests}
      />

      {/* 2. Main Screen Area */}
      <main className="flex-1 pl-16 sm:pl-20 transition-all">
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

      {/* 4. Spotlight Search Overlay */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectMedia={setSelectedMedia}
        readyMap={readyMap}
        activeRequests={activeRequests}
      />

      {/* 5. Active Queue Drawer */}
      <QueueDrawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        activeRequests={activeRequests}
        onRefresh={refreshQueue}
        onPlayMedia={setPlayingMedia}
      />

      {/* 6. Custom Netflix-Grade HLS Video Player */}
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
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-zinc-900/95 border shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-5 duration-200 ${
            toast.type === 'success'
              ? 'border-emerald-500/40 text-emerald-200'
              : toast.type === 'info'
              ? 'border-indigo-500/40 text-indigo-200'
              : 'border-red-500/40 text-red-200'
          }`}
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
