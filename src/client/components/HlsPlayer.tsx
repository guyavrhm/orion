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
import type { PlayingMediaInfo, SubtitleSettings } from '../types/ui.js';
import { ApiClient, type StreamInfoResponse } from '../services/api.js';
import { useMediaSession } from '../hooks/useMediaSession.js';
import { formatTime } from '../utils/formatters.js';

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

  const [subSettings, setSubSettings] = useState<SubtitleSettings>({
    fontSize: 'medium',
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    offsetSeconds: 0,
  });

  // Track cue container for parsed WebVTT
  const parsedCuesRef = useRef<{ start: number; end: number; text: string }[]>([]);

  // 1. Fetch Stream Info
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    ApiClient.getStreamInfo(media.fileId)
      .then((info) => {
        if (!isMounted) return;
        setStreamInfo(info);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load media stream');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [media.fileId]);

  // 2. Fetch subtitle preference
  useEffect(() => {
    ApiClient.getSubtitlePreference(media.mediaId)
      .then((res) => {
        if (res.subtitle_lang) {
          setActiveSubtitleLang(res.subtitle_lang);
        }
      })
      .catch(() => {});
  }, [media.mediaId]);

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

        if (initialTimestamp > 0) {
          video.currentTime = initialTimestamp;
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
        if (initialTimestamp > 0) {
          video.currentTime = initialTimestamp;
        }
        video.play().catch(() => {});
      });
    } else {
      setError('HLS playback is not supported on this browser.');
      setLoading(false);
    }
  }, [streamInfo, initialTimestamp]);

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

    fetch(track.url)
      .then((res) => res.text())
      .then((vttText) => {
        const lines = vttText.split(/\r?\n/);
        const cues: { start: number; end: number; text: string }[] = [];
        let currentStart = 0;
        let currentEnd = 0;
        let currentContent: string[] = [];

        const timeToSecs = (str: string) => {
          const parts = str.trim().split(':');
          if (parts.length === 3) {
            return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2].replace(',', '.'));
          } else if (parts.length === 2) {
            return parseFloat(parts[0]) * 60 + parseFloat(parts[1].replace(',', '.'));
          }
          return 0;
        };

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.includes('-->')) {
            if (currentContent.length > 0) {
              cues.push({
                start: currentStart,
                end: currentEnd,
                text: currentContent.join('\n'),
              });
              currentContent = [];
            }
            const [startStr, endStr] = line.split('-->');
            currentStart = timeToSecs(startStr);
            currentEnd = timeToSecs(endStr.split(' ')[0]);
          } else if (line && !line.startsWith('WEBVTT') && !line.startsWith('NOTE') && isNaN(Number(line))) {
            currentContent.push(line);
          }
        }

        if (currentContent.length > 0) {
          cues.push({
            start: currentStart,
            end: currentEnd,
            text: currentContent.join('\n'),
          });
        }

        parsedCuesRef.current = cues;
      })
      .catch(() => {
        parsedCuesRef.current = [];
      });
  }, [activeSubtitleLang, streamInfo]);

  // 5. Update active subtitle cue on timeupdate
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const time = video.currentTime;
    setCurrentTime(time);
    setDuration(video.duration || 0);

    // Buffer progress
    if (video.buffered.length > 0) {
      setBuffered(video.buffered.end(video.buffered.length - 1));
    }

    // Subtitle cue matching with offset
    const adjustedTime = time + (subSettings.offsetSeconds || 0);
    const matched = parsedCuesRef.current.find((c) => adjustedTime >= c.start && adjustedTime <= c.end);
    setCurrentSubtitleText(matched ? matched.text : '');
  };

  // 6. Periodic progress sync to backend every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.duration > 0) {
        ApiClient.saveProgress(media.fileId, Math.floor(video.currentTime), Math.floor(video.duration)).catch(() => {});
        onProgressUpdate?.(media.fileId, Math.floor(video.currentTime), Math.floor(video.duration));
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [media.fileId, onProgressUpdate]);

  // 7. Auto-hide Controls on Inactivity
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
    }
    triggerActivity();
  }, [triggerActivity]);

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
    video.currentTime = Math.max(0, Math.min(video.duration || 0, time));
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
            onClose();
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
    onClose,
  ]);

  // Helper for subtitle font size classes
  const getSubSizeClass = (size: SubtitleSettings['fontSize']) => {
    switch (size) {
      case 'small':
        return 'text-lg sm:text-xl';
      case 'large':
        return 'text-2xl sm:text-4xl';
      case 'extra-large':
        return 'text-3xl sm:text-5xl';
      case 'medium':
      default:
        return 'text-xl sm:text-2xl';
    }
  };

  // RTL language detector
  const isRtlText = (text: string) => /[\u0590-\u05FF\u0600-\u06FF]/.test(text);

  return (
    <div
      ref={containerRef}
      onMouseMove={triggerActivity}
      onClick={triggerActivity}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onClick={togglePlay}
        playsInline
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Loading Spinner */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none z-20">
          <div className="w-14 h-14 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="mt-4 text-sm font-medium tracking-wide text-zinc-300">Buffering stream...</span>
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
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition cursor-pointer"
          >
            Back to Library
          </button>
        </div>
      )}

      {/* Custom Subtitles Overlay */}
      {currentSubtitleText && !error && (
        <div
          className="absolute bottom-20 sm:bottom-28 left-4 right-4 flex justify-center pointer-events-none z-20"
          dir={isRtlText(currentSubtitleText) ? 'rtl' : 'ltr'}
        >
          <div
            className={`font-semibold tracking-wide rounded-lg px-4 py-1.5 leading-snug custom-subtitle-text max-w-4xl text-center whitespace-pre-line ${getSubSizeClass(
              subSettings.fontSize
            )}`}
            style={{
              color: subSettings.color,
              backgroundColor: subSettings.backgroundColor,
            }}
          >
            {currentSubtitleText}
          </div>
        </div>
      )}

      {/* Modern Netflix-Grade UI Controls Overlay */}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/80 flex flex-col justify-between p-4 sm:p-8 transition-opacity duration-300 z-30 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top Bar: Title and Back */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
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
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white'
                }`}
                title="Subtitles & Audio"
              >
                <Subtitles className="w-5 h-5" />
              </button>

              {/* Subtitles & Audio Dropdown Menu */}
              {showSubtitleMenu && (
                <div className="absolute right-0 top-12 w-80 glass-panel rounded-2xl p-4 shadow-2xl z-40 border border-zinc-700/50">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Subtitles</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto mb-4 pr-1">
                    <button
                      onClick={() => {
                        setActiveSubtitleLang(null);
                        ApiClient.saveSubtitlePreference(media.mediaId, null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
                        !activeSubtitleLang ? 'bg-zinc-800 text-white font-semibold' : 'hover:bg-zinc-800/80 text-zinc-300'
                      }`}
                    >
                      <span>Off</span>
                      {!activeSubtitleLang && <Check className="w-4 h-4 text-indigo-400" />}
                    </button>
                    {streamInfo?.subtitles?.map((sub) => (
                      <button
                        key={sub.lang}
                        onClick={() => {
                          setActiveSubtitleLang(sub.lang);
                          ApiClient.saveSubtitlePreference(media.mediaId, sub.lang);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition cursor-pointer ${
                          activeSubtitleLang === sub.lang
                            ? 'bg-zinc-800 text-white font-semibold'
                            : 'hover:bg-zinc-800/80 text-zinc-300'
                        }`}
                      >
                        <span className="capitalize">{sub.lang}</span>
                        {activeSubtitleLang === sub.lang && <Check className="w-4 h-4 text-indigo-400" />}
                      </button>
                    ))}
                  </div>

                  {/* Subtitle Customization */}
                  {activeSubtitleLang && (
                    <div className="border-t border-zinc-800 pt-3 space-y-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Subtitle Size</div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { key: 'small', label: 'S' },
                            { key: 'medium', label: 'M' },
                            { key: 'large', label: 'L' },
                            { key: 'extra-large', label: 'XL' },
                          ].map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() => setSubSettings((prev) => ({ ...prev, fontSize: key as SubtitleSettings['fontSize'] }))}
                              className={`py-1 rounded-lg text-xs font-semibold uppercase transition cursor-pointer ${
                                subSettings.fontSize === key
                                  ? 'bg-indigo-600 text-white shadow-md'
                                  : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Subtitle Color & Background */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Color</div>
                          <div className="flex items-center gap-1.5">
                            {[
                              { color: '#ffffff', name: 'White' },
                              { color: '#facc15', name: 'Yellow' },
                              { color: '#38bdf8', name: 'Cyan' },
                            ].map((c) => (
                              <button
                                key={c.color}
                                onClick={() => setSubSettings((prev) => ({ ...prev, color: c.color }))}
                                className={`w-6 h-6 rounded-full border-2 transition cursor-pointer ${
                                  subSettings.color === c.color ? 'border-indigo-400 scale-110' : 'border-transparent hover:scale-105'
                                }`}
                                style={{ backgroundColor: c.color }}
                                title={c.name}
                              />
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Background</div>
                          <div className="flex items-center gap-1.5">
                            {[
                              { bg: 'transparent', label: 'None' },
                              { bg: 'rgba(0, 0, 0, 0.5)', label: 'Dim' },
                              { bg: 'rgba(0, 0, 0, 0.85)', label: 'Dark' },
                            ].map((b) => (
                              <button
                                key={b.bg}
                                onClick={() => setSubSettings((prev) => ({ ...prev, backgroundColor: b.bg }))}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
                                  subSettings.backgroundColor === b.bg
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                }`}
                              >
                                {b.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-zinc-400 pt-1">
                        <span>Sync Offset ({subSettings.offsetSeconds.toFixed(1)}s)</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() =>
                              setSubSettings((prev) => ({ ...prev, offsetSeconds: prev.offsetSeconds - 0.5 }))
                            }
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-white font-mono"
                          >
                            -0.5s
                          </button>
                          <button
                            onClick={() => setSubSettings((prev) => ({ ...prev, offsetSeconds: 0 }))}
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() =>
                              setSubSettings((prev) => ({ ...prev, offsetSeconds: prev.offsetSeconds + 0.5 }))
                            }
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-white font-mono"
                          >
                            +0.5s
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Audio Track Selector */}
                  {audioTracks.length > 1 && (
                    <div className="border-t border-zinc-800 pt-3 mt-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Audio Track</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {audioTracks.map((trk) => (
                          <button
                            key={trk.id}
                            onClick={() => {
                              setActiveAudioTrack(trk.id);
                              if (hlsRef.current) hlsRef.current.audioTrack = trk.id;
                            }}
                            className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                              activeAudioTrack === trk.id
                                ? 'bg-zinc-800 text-white font-semibold'
                                : 'hover:bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            <span>{trk.name} ({trk.lang})</span>
                            {activeAudioTrack === trk.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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
                <div className="absolute right-0 top-12 w-56 glass-panel rounded-2xl p-4 shadow-2xl z-40 border border-zinc-700/50">
                  <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Speed</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => {
                          if (videoRef.current) videoRef.current.playbackRate = spd;
                          setPlaybackRate(spd);
                        }}
                        className={`py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                          playbackRate === spd ? 'bg-indigo-600 text-white' : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400'
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

        {/* Center: Play/Pause Big Trigger Feedback */}
        <div className="flex items-center justify-center gap-8">
          <button
            onClick={() => seek(-10)}
            className="p-3.5 rounded-full bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white transition backdrop-blur-md cursor-pointer active:scale-95"
            title="Skip back 10s (← / J)"
          >
            <RotateCcw className="w-7 h-7" />
          </button>

          <button
            onClick={togglePlay}
            className="p-5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white transition transform hover:scale-105 active:scale-95 cursor-pointer"
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
          <div className="group relative w-full h-3 flex items-center cursor-pointer">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-zinc-800 group-hover:h-2 rounded-lg appearance-none cursor-pointer accent-indigo-500 transition-all"
              style={{
                background: `linear-gradient(to right, #6366f1 ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${
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
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => changeVolume(parseFloat(e.target.value))}
                  className="w-16 sm:w-24 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              <div className="text-xs font-mono text-zinc-400 font-medium tracking-wider">
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
