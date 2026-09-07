import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Subtitles,
  Settings,
  ArrowLeft,
  PictureInPicture2,
  Check,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import type { PlayingMediaInfo } from '../types/ui.js';
import { ApiClient, type StreamInfoResponse } from '../services/api.js';
import { useMediaSession } from '../hooks/useMediaSession.js';
import { formatTime, getFriendlyErrorMessage } from '../utils/formatters.js';
import { parseWebVtt, findActiveCueText, isRtlText, type SubtitleCue } from '../utils/subtitles.js';

interface HlsPlayerProps {
  media: PlayingMediaInfo;
  initialTimestamp?: number;
  onClose: () => void;
  onProgressUpdate?: (fileId: string, timestamp: number, runtime: number) => void;
}

export function HlsPlayer({ media, initialTimestamp = 0, onClose, onProgressUpdate }: HlsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [streamInfo, setStreamInfo] = useState<StreamInfoResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [buffered, setBuffered] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Overlay state
  const [showControls, setShowControls] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subtitles & Audio state
  const [activeSubtitleLang, setActiveSubtitleLang] = useState<string | null>(null);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(0);
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string; lang: string }[]>([]);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string>('');

  const initialTimestampRef = useRef<number>(initialTimestamp);
  const parsedCuesRef = useRef<SubtitleCue[]>([]);

  // 1. Fetch Stream Info & Subtitle Preference
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    Promise.all([
      ApiClient.getStreamInfo(media.fileId),
      ApiClient.getSubtitlePreference(media.mediaId).catch(() => ({ subtitle_lang: null })),
    ])
      .then(([info, prefRes]) => {
        if (!isMounted) return;
        setStreamInfo(info);

        const savedPref = prefRes?.subtitle_lang;
        if (savedPref === 'none') {
          // Explicitly disabled by user
          setActiveSubtitleLang(null);
        } else if (savedPref) {
          // Explicit language preference saved
          setActiveSubtitleLang(savedPref);
        } else if (info.subtitles && info.subtitles.length > 0) {
          // Default to the first available subtitle track for new media
          setActiveSubtitleLang(info.subtitles[0].lang);
        } else {
          setActiveSubtitleLang(null);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(getFriendlyErrorMessage(err) || 'Failed to load media stream');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [media.fileId, media.mediaId]);

  // 3. Initialize HLS
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamInfo) return;

    const streamUrl = streamInfo.url;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLoading(false);
        if (data.audioTracks && data.audioTracks.length > 0) {
          setAudioTracks(
            data.audioTracks.map((t, idx) => ({
              id: idx,
              name: t.name || `Audio ${idx + 1}`,
              lang: t.lang || 'und',
            }))
          );
        }

        if (initialTimestampRef.current > 0) {
          video.currentTime = initialTimestampRef.current;
          initialTimestampRef.current = 0;
        }

        video.play().catch(() => {
          setIsPlaying(false);
        });
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        if (data.audioTracks) {
          setAudioTracks(
            data.audioTracks.map((t, idx) => ({
              id: idx,
              name: t.name || `Audio ${idx + 1}`,
              lang: t.lang || 'und',
            }))
          );
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setError('Fatal playback error encountered.');
              break;
          }
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        if (initialTimestampRef.current > 0) {
          video.currentTime = initialTimestampRef.current;
          initialTimestampRef.current = 0;
        }
        video.play().catch(() => {});
      });
    } else {
      setError('HLS playback is not supported on this browser.');
      setLoading(false);
    }
  }, [streamInfo?.url]);

  // 4. Subtitle WebVTT loading & parsing for custom crisp rendering + RTL support
  useEffect(() => {
    if (!activeSubtitleLang || !streamInfo?.subtitles) {
      parsedCuesRef.current = [];
      setCurrentSubtitleText('');
      return;
    }

    const track = streamInfo.subtitles.find((s) => s.lang === activeSubtitleLang);
    if (!track) {
      parsedCuesRef.current = [];
      setCurrentSubtitleText('');
      return;
    }

    let isSubMounted = true;
    fetch(track.url)
      .then((res) => {
        if (!res.ok) throw new Error(`Subtitle fetch error: ${res.status}`);
        return res.text();
      })
      .then((vttText) => {
        if (!isSubMounted) return;
        const cues = parseWebVtt(vttText);
        parsedCuesRef.current = cues;
        const videoTime = videoRef.current?.currentTime || 0;
        setCurrentSubtitleText(findActiveCueText(cues, videoTime));
      })
      .catch(() => {
        if (!isSubMounted) return;
        parsedCuesRef.current = [];
        setCurrentSubtitleText('');
      });

    return () => {
      isSubMounted = false;
    };
  }, [activeSubtitleLang, streamInfo]);

  const updateBuffer = (video: HTMLVideoElement, time: number) => {
    let activeBufferEnd = time;
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      if (time >= start - 0.5 && time <= end) {
        activeBufferEnd = Math.max(activeBufferEnd, end);
        break;
      }
    }
    setBuffered(activeBufferEnd);
  };

  // 5. Update active subtitle cue on timeupdate
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const time = video.currentTime;
    setCurrentTime(time);
    setDuration(video.duration || 0);

    // Buffer progress: match active buffer chunk around current playhead
    updateBuffer(video, time);

    // Subtitle cue matching
    setCurrentSubtitleText(findActiveCueText(parsedCuesRef.current, time));
  };

  const handleProgress = () => {
    const video = videoRef.current;
    if (video) {
      updateBuffer(video, video.currentTime);
    }
  };

  // 6. Progress sync helper (periodic and explicit on pause/exit)
  const flushProgress = useCallback(() => {
    const video = videoRef.current;
    if (video && video.duration > 0) {
      const curTime = Math.floor(video.currentTime);
      const dur = Math.floor(video.duration);
      ApiClient.saveProgress(media.fileId, curTime, dur).catch(() => {});
      onProgressUpdate?.(media.fileId, curTime, dur);
    }
  }, [media.fileId, onProgressUpdate]);

  const handleClose = useCallback(() => {
    flushProgress();
    onClose();
  }, [flushProgress, onClose]);

  // Periodic progress sync to backend every 5 seconds & on unmount
  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.duration > 0) {
        flushProgress();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      flushProgress();
    };
  }, [flushProgress]);

  // 7. Auto-hide Controls on Inactivity & Tap Toggle
  const dismissControls = useCallback(() => {
    setShowControls(false);
    setShowSubtitleMenu(false);
    setShowSettingsMenu(false);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
  }, []);

  const triggerActivity = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSubtitleMenu && !showSettingsMenu) {
        setShowControls(false);
      }
    }, 3500);
  }, [isPlaying, showSubtitleMenu, showSettingsMenu]);

  const toggleControls = useCallback(() => {
    if (showControls) {
      dismissControls();
    } else {
      triggerActivity();
    }
  }, [showControls, dismissControls, triggerActivity]);

  // 8. Player Actions
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
      flushProgress();
    }
    triggerActivity();
  }, [flushProgress, triggerActivity]);

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
      triggerActivity();
    },
    [triggerActivity]
  );

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(video.duration || 0, time));
    video.currentTime = target;
    setCurrentTime(target);
    updateBuffer(video, target);
    triggerActivity();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    triggerActivity();
  };

  const changeVolume = (val: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = val;
    video.muted = val === 0;
    setVolume(val);
    setIsMuted(val === 0);
    triggerActivity();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
    } else {
      await video.requestPictureInPicture().catch(() => {});
    }
  };

  // 9. MediaSession Hook
  useMediaSession({
    media,
    isPlaying,
    onPlay: () => togglePlay(),
    onPause: () => togglePlay(),
    onSeek: (offset) => seek(offset),
  });

  // 10. Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'KeyJ':
          e.preventDefault();
          seek(-10);
          break;
        case 'ArrowRight':
        case 'KeyL':
          e.preventDefault();
          seek(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyC':
          e.preventDefault();
          // Toggle subtitle off or first available
          if (activeSubtitleLang) {
            setActiveSubtitleLang(null);
          } else if (streamInfo?.subtitles && streamInfo.subtitles.length > 0) {
            setActiveSubtitleLang(streamInfo.subtitles[0].lang);
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (showSubtitleMenu || showSettingsMenu) {
            setShowSubtitleMenu(false);
            setShowSettingsMenu(false);
          } else {
            handleClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    seek,
    volume,
    activeSubtitleLang,
    streamInfo,
    showSubtitleMenu,
    showSettingsMenu,
    handleClose,
  ]);

  const isTouchInteractionRef = useRef<boolean>(false);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') {
        isTouchInteractionRef.current = true;
        return;
      }
      isTouchInteractionRef.current = false;
      triggerActivity();
    },
    [triggerActivity]
  );

  const handleBackdropAction = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // If clicking interactive control (buttons, sliders, dropdown items), do nothing here
      if (target.closest('button, input, select, textarea, [role="button"], a, .interactive-control')) {
        return;
      }

      const native = e.nativeEvent as any;
      const isTouch =
        native?.pointerType === 'touch' ||
        native?.sourceCapabilities?.firesTouchEvents === true ||
        isTouchInteractionRef.current ||
        (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && native?.pointerType !== 'mouse');

      if (isTouch) {
        // Touch (finger tap): only dismiss or reveal controls
        if (showControls) {
          dismissControls();
        } else {
          triggerActivity();
        }
      } else {
        // Physical mouse click: play / pause standard viewer behavior
        togglePlay();
      }
    },
    [showControls, dismissControls, triggerActivity, togglePlay]
  );

  // 11. Lock Body Scroll & Prevent Background Scroll Leaks
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;

    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const preventScroll = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.overflow-y-auto')) return;
      e.preventDefault();
    };

    const preventTouch = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Allow touch events on range sliders, buttons, inputs, and scrollable menus
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'BUTTON' ||
        target.closest('input') ||
        target.closest('button') ||
        target.closest('.overflow-y-auto')
      ) {
        return;
      }
      if (e.cancelable) e.preventDefault();
    };

    container.addEventListener('wheel', preventScroll, { passive: false });
    container.addEventListener('touchmove', preventTouch, { passive: false });

    return () => {
      container.removeEventListener('wheel', preventScroll);
      container.removeEventListener('touchmove', preventTouch);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') {
          isTouchInteractionRef.current = true;
        } else if (e.pointerType === 'mouse') {
          isTouchInteractionRef.current = false;
        }
      }}
      onTouchStart={() => {
        isTouchInteractionRef.current = true;
      }}
      onPointerMove={handlePointerMove}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden overscroll-none"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        onProgress={handleProgress}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          flushProgress();
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onClick={handleBackdropAction}
        onDoubleClick={() => {
          if (!isTouchInteractionRef.current) {
            toggleFullscreen();
          }
        }}
        playsInline
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Loading Spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none z-20">
          <div className="w-14 h-14 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="mt-4 text-sm font-medium tracking-wide text-zinc-300">Buffering...</span>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 z-30 p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-red-400 mb-4">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Playback Error</h2>
          <p className="text-zinc-400 max-w-md text-sm mb-6">{error}</p>
          <button
            onClick={handleClose}
            className="px-6 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition cursor-pointer"
          >
            Back to Library
          </button>
        </div>
      )}

      {/* Custom Subtitles Overlay */}
      {currentSubtitleText && !error && (
        <div
          className={`absolute left-4 right-4 flex justify-center pointer-events-none z-20 text-center transition-all duration-300 ease-out ${
            showControls ? 'bottom-24 sm:bottom-32' : 'bottom-6 sm:bottom-12'
          }`}
          dir={isRtlText(currentSubtitleText) ? 'rtl' : 'ltr'}
        >
          <span
            className="inline-block max-w-[88%] sm:max-w-[75%] text-white font-medium px-3.5 py-1.5 rounded-lg bg-black/80 backdrop-blur-[2px] shadow-2xl leading-snug whitespace-pre-line [box-decoration-break:clone]"
            style={{
              fontSize: 'clamp(0.95rem, 3.2vmin, 2rem)',
              lineHeight: 1.35,
            }}
          >
            {currentSubtitleText}
          </span>
        </div>
      )}

      {/* Modern Netflix-Grade UI Controls Overlay */}
      <div
        onClick={handleBackdropAction}
        onDoubleClick={() => {
          if (!isTouchInteractionRef.current) {
            toggleFullscreen();
          }
        }}
        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/80 flex flex-col justify-between pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pl-[calc(env(safe-area-inset-left,0px)+1rem)] pr-[calc(env(safe-area-inset-right,0px)+1rem)] sm:p-8 transition-opacity duration-300 z-30 ${
          showControls ? 'opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top Bar: Title and Back */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleClose}
              className="p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition backdrop-blur-md cursor-pointer"
              title="Close Player (Esc)"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">{media.title}</h1>
              {media.subtitle && <p className="text-xs sm:text-sm text-zinc-400 font-medium">{media.subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* PiP Button */}
            <button
              onClick={togglePiP}
              className="p-2.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white transition backdrop-blur-md cursor-pointer"
              title="Picture in Picture"
            >
              <PictureInPicture2 className="w-5 h-5" />
            </button>

            {/* Subtitles Menu Trigger */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSubtitleMenu(!showSubtitleMenu);
                  setShowSettingsMenu(false);
                }}
                className={`p-2.5 rounded-full transition backdrop-blur-md cursor-pointer ${
                  activeSubtitleLang
                    ? 'bg-red-600 text-white'
                    : 'bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                }`}
                title="Subtitles & Audio"
              >
                <Subtitles className="w-5 h-5" />
              </button>

              {/* Subtitles & Audio Dropdown Menu */}
              {showSubtitleMenu && (
                <div className="absolute right-0 top-12 w-64 glass-panel bg-zinc-900/95 rounded-2xl shadow-2xl z-40 border border-white/10 overflow-hidden">
                  <div className="p-2 max-h-72 overflow-y-auto overscroll-contain space-y-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 px-2">Subtitles</div>
                      <div className="space-y-0.5">
                        <button
                          onClick={() => {
                            setActiveSubtitleLang(null);
                            ApiClient.saveSubtitlePreference(media.mediaId, 'none');
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                            !activeSubtitleLang
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <span>Off</span>
                          {!activeSubtitleLang && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                        {streamInfo?.subtitles?.map((sub) => (
                          <button
                            key={sub.lang}
                            onClick={() => {
                              setActiveSubtitleLang(sub.lang);
                              ApiClient.saveSubtitlePreference(media.mediaId, sub.lang);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                              activeSubtitleLang === sub.lang
                                ? 'bg-red-600 text-white shadow-sm'
                                : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <span className="capitalize">{sub.lang}</span>
                            {activeSubtitleLang === sub.lang && <Check className="w-3.5 h-3.5 text-white" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Audio Track Selector */}
                    {audioTracks.length > 1 && (
                      <div className="border-t border-white/10 pt-2.5">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 px-2">Audio Track</div>
                        <div className="space-y-0.5 max-h-36 overflow-y-auto overscroll-contain">
                          {audioTracks.map((trk) => (
                            <button
                              key={trk.id}
                              onClick={() => {
                                setActiveAudioTrack(trk.id);
                                if (hlsRef.current) hlsRef.current.audioTrack = trk.id;
                              }}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                                activeAudioTrack === trk.id
                                  ? 'bg-red-600 text-white shadow-sm'
                                  : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              <span>{trk.name} ({trk.lang})</span>
                              {activeAudioTrack === trk.id && <Check className="w-3.5 h-3.5 text-white" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Playback Settings Menu */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSettingsMenu(!showSettingsMenu);
                  setShowSubtitleMenu(false);
                }}
                className="p-2.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white transition backdrop-blur-md cursor-pointer"
                title="Playback Settings"
              >
                <Settings className="w-5 h-5" />
              </button>

              {showSettingsMenu && (
                <div className="absolute right-0 top-12 w-56 glass-panel bg-zinc-900/95 rounded-2xl p-3 shadow-2xl z-40 border border-white/10">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 px-1">Speed</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => {
                          if (videoRef.current) videoRef.current.playbackRate = spd;
                          setPlaybackRate(spd);
                        }}
                        className={`py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                          playbackRate === spd
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Play/Pause Big Trigger Feedback (Hidden when buffering) */}
        <div
          className={`flex items-center justify-center gap-8 transition-opacity duration-200 ${
            loading ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <button
            onClick={() => seek(-10)}
            className="p-3.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white transition backdrop-blur-md cursor-pointer active:scale-95"
            title="Skip back 10s (← / J)"
          >
            <RotateCcw className="w-7 h-7" />
          </button>

          <button
            onClick={togglePlay}
            className="p-5 rounded-full bg-red-600 hover:bg-red-500 text-white transition transform hover:scale-105 active:scale-95 cursor-pointer"
            title="Play / Pause (Space / K)"
          >
            {isPlaying ? <Pause className="w-9 h-9" /> : <Play className="w-9 h-9 fill-current ml-1" />}
          </button>

          <button
            onClick={() => seek(10)}
            className="p-3.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white transition backdrop-blur-md cursor-pointer active:scale-95"
            title="Skip forward 10s (→ / L)"
          >
            <RotateCw className="w-7 h-7" />
          </button>
        </div>

        {/* Bottom Bar: Timeline & Control Trays */}
        <div className="space-y-3">
          {/* Seek Progress Bar */}
          <div className="group relative w-full h-6 flex items-center cursor-pointer touch-none">
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="any"
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              onInput={(e) => seekTo(parseFloat((e.target as HTMLInputElement).value))}
              className="w-full h-1.5 group-hover:h-2.5 rounded-lg appearance-none cursor-pointer accent-red-600 transition-all touch-none"
              style={{
                background: `linear-gradient(to right, #dc2626 ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${
                  (currentTime / (duration || 1)) * 100
                }% ${(buffered / (duration || 1)) * 100}%, #27272a ${(buffered / (duration || 1)) * 100}%)`,
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            {/* Left Controls: Volume & Timestamp */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 group">
                <button
                  onClick={toggleMute}
                  className="p-1.5 text-zinc-400 hover:text-white transition cursor-pointer"
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => changeVolume(parseFloat(e.target.value))}
                  onInput={(e) => changeVolume(parseFloat((e.target as HTMLInputElement).value))}
                  className="w-16 sm:w-24 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-red-600 touch-none"
                />
              </div>

              <div className="text-xs tabular-nums text-zinc-400 font-semibold tracking-wider">
                <span className="text-white">{formatTime(currentTime)}</span> / {formatTime(duration)}
              </div>
            </div>

            {/* Right Controls: Fullscreen */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleFullscreen}
                className="p-2 text-zinc-400 hover:text-white transition cursor-pointer"
                title="Fullscreen (F)"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
