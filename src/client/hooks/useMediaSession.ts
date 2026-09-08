import { useEffect, useRef } from 'react';
import type { PlayingMediaInfo } from '../types/ui.js';

interface MediaSessionOptions {
  media: PlayingMediaInfo | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
}

export function useMediaSession({ media, isPlaying, onPlay, onPause, onSeek }: MediaSessionOptions) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 1. Screen Wake Lock
  useEffect(() => {
    if (!isPlaying) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch {
        // WakeLock request failed or disallowed
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [isPlaying]);

  // 2. Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator) || !media) return;

    const artwork = [];
    if (media.poster) {
      artwork.push({ src: media.poster, sizes: '512x512', type: 'image/jpeg' });
    }
    if (media.background) {
      artwork.push({ src: media.background, sizes: '1920x1080', type: 'image/jpeg' });
    }
    if (artwork.length === 0) {
      artwork.push({ src: '/assets/images/orion.jpg', sizes: '512x512', type: 'image/jpeg' });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: media.title,
      artist: 'Orion',
      album: media.subtitle || (media.type === 'show' ? `S${media.season}:E${media.episode}` : 'Movie'),
      artwork,
    });

    navigator.mediaSession.setActionHandler('play', onPlay);
    navigator.mediaSession.setActionHandler('pause', onPause);
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      onSeek(details.seekOffset || 10);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      onSeek(-(details.seekOffset || 10));
    });

    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        try {
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('seekforward', null);
          navigator.mediaSession.setActionHandler('seekbackward', null);
        } catch {
          // Ignore
        }
      }
    };
  }, [media, onPlay, onPause, onSeek]);
}
