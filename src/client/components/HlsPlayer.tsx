import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Subtitles,
  Settings,
  ArrowLeft,
  Cast,
  Check,
  AlertCircle,
  SkipForward,
} from 'lucide-react';
import type { PlayingMediaInfo } from '../types/ui.js';
import { ApiClient, type StreamInfoResponse } from '../services/api.js';
import { useMediaSession } from '../hooks/useMediaSession.js';
import { formatTime, getFriendlyErrorMessage } from '../utils/formatters.js';
import { parseWebVtt, findActiveCueText, isRtlText, getLanguageDisplayName, type SubtitleCue } from '../utils/subtitles.js';
import { useSpatialNavigation, useFocusable, useZoneBack, isBackKey } from '../context/SpatialNavigationContext.js';
import { useScrollActiveIntoView } from '../hooks/useScrollActiveIntoView.js';

interface PlayerMenuItemProps {
  id: string;
  index: number;
  isSelected: boolean;
  label: string;
  sublabel?: string;
  onSelect: () => void;
  onDismiss: () => void;
}

function PlayerMenuItem({
  id,
  index,
  isSelected,
  label,
  sublabel,
  onSelect,
  onDismiss,
}: PlayerMenuItemProps) {
  const { ref, isSpatialFocused } = useFocusable<HTMLButtonElement>({
    id,
    zone: 'player-menu',
    section: 'player-menu-subtitles',
    index,
    priority: isSelected ? 10 : 0,
    onEnter: () => {
      onSelect();
      onDismiss();
    },
  });

  return (
    <button
      ref={ref}
      data-active={isSelected}
      onClick={onSelect}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer spatial-focus-indicator ${
        isSelected
          ? 'bg-red-600 text-white'
          : isSpatialFocused
          ? 'bg-white/20 text-white'
          : 'text-zinc-300 hover:bg-white/10 hover:text-white'
      } ${isSpatialFocused ? 'spatial-focus-pill ring-2 ring-white/90' : ''}`}
    >
      <span className="capitalize">
        {label}
        {sublabel ? ` (${sublabel})` : ''}
      </span>
      {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
    </button>
  );
}

interface PlayerSpeedItemProps {
  speed: number;
  index: number;
  isSelected: boolean;
  onSelect: (spd: number) => void;
  onDismiss: () => void;
}

function PlayerSpeedItem({
  speed,
  index,
  isSelected,
  onSelect,
  onDismiss,
}: PlayerSpeedItemProps) {
  const { ref, isSpatialFocused } = useFocusable<HTMLButtonElement>({
    id: `player-speed-item-${speed}`,
    zone: 'player-menu',
    section: 'player-menu-speeds',
    index,
    priority: isSelected ? 10 : 0,
    onEnter: () => {
      onSelect(speed);
      onDismiss();
    },
  });

  return (
    <button
      ref={ref}
      onClick={() => {
        onSelect(speed);
      }}
      className={`py-1.5 rounded-xl text-xs font-bold transition cursor-pointer spatial-focus-indicator ${
        isSelected
          ? 'bg-red-600 text-white'
          : isSpatialFocused
          ? 'bg-white/20 text-white'
          : 'bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white'
      } ${isSpatialFocused ? 'spatial-focus-pill ring-2 ring-white/90' : ''}`}
    >
      {speed}x
    </button>
  );
}

interface PlayerSubtitlesAudioMenuProps {
  activeSubtitleLang: string | null;
  streamInfo: StreamInfoResponse | null;
  audioTracks: { id: number; name: string; lang: string }[];
  activeAudioTrack: number;
  mediaId: string;
  onSelectSubtitle: (lang: string | null) => void;
  onSelectAudioTrack: (id: number) => void;
  onDismiss: () => void;
}

function PlayerSubtitlesAudioMenu({
  activeSubtitleLang,
  streamInfo,
  audioTracks,
  activeAudioTrack,
  mediaId,
  onSelectSubtitle,
  onSelectAudioTrack,
  onDismiss,
}: PlayerSubtitlesAudioMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useScrollActiveIntoView(containerRef, '[data-active="true"]', activeSubtitleLang);

  return (
    <div className="absolute right-0 top-12 w-64 bg-zinc-900/98 rounded-2xl shadow-2xl z-40 border border-white/10 overflow-hidden">
      <div ref={containerRef} className="p-2 max-h-72 overflow-y-auto overscroll-contain space-y-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 px-2">Subtitles</div>
          <div className="space-y-0.5">
            <PlayerMenuItem
              id="player-sub-item-off"
              index={0}
              isSelected={!activeSubtitleLang}
              label="Off"
              onSelect={() => {
                onSelectSubtitle(null);
                ApiClient.saveSubtitlePreference(mediaId, 'none');
              }}
              onDismiss={onDismiss}
            />
            {streamInfo?.subtitles?.map((sub, idx) => (
              <PlayerMenuItem
                key={sub.lang}
                id={`player-sub-item-${sub.lang}`}
                index={1 + idx}
                isSelected={activeSubtitleLang === sub.lang}
                label={getLanguageDisplayName(sub.lang)}
                onSelect={() => {
                  onSelectSubtitle(sub.lang);
                  ApiClient.saveSubtitlePreference(mediaId, sub.lang);
                }}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </div>

        {/* Audio Track Selector */}
        {audioTracks.length > 1 && (
          <div className="border-t border-white/10 pt-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 px-2">Audio Track</div>
            <div className="space-y-0.5 max-h-36 overflow-y-auto overscroll-contain">
              {audioTracks.map((trk, trkIdx) => (
                <PlayerMenuItem
                  key={trk.id}
                  id={`player-audio-item-${trk.id}`}
                  index={1 + (streamInfo?.subtitles?.length || 0) + trkIdx}
                  isSelected={activeAudioTrack === trk.id}
                  label={trk.name}
                  sublabel={getLanguageDisplayName(trk.lang)}
                  onSelect={() => onSelectAudioTrack(trk.id)}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface PlayerBottomBarProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  showControls: boolean;
  onSeek: (seconds: number) => void;
  onSeekTo: (time: number) => void;
  onTogglePlay: () => void;
  onNextEpisode?: () => void;
  previewTime?: number | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const PlayerBottomBar = React.memo(function PlayerBottomBar({
  videoRef,
  showControls,
  previewTime,
  onSeek,
  onSeekTo,
  onTogglePlay,
  onNextEpisode,
  isFullscreen,
  onToggleFullscreen,
}: PlayerBottomBarProps) {
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [buffered, setBuffered] = useState<number>(0);

  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const isScrubbingRef = useRef<boolean>(false);
  const [scrubTime, setScrubTime] = useState<number>(0);
  const scrubTimeRef = useRef<number>(0);
  const wasPlayingBeforeScrubRef = useRef<boolean>(false);

  const hasPreview = previewTime !== null && previewTime !== undefined;
  const displayTime = isScrubbing ? scrubTime : hasPreview ? previewTime : currentTime;

  // Sync currentTime to previewTime when previewing (prevents snapping/flicker on trickplay release)
  useEffect(() => {
    if (previewTime !== null && previewTime !== undefined) {
      setCurrentTime(previewTime);
      lastTimeRef.current = previewTime;
    }
  }, [previewTime]);

  const { ref: timelineRef, isSpatialFocused: isTimelineFocused } = useFocusable<HTMLInputElement>({
    id: 'player-timeline-slider',
    zone: 'player',
    section: 'player-timeline',
    index: 0,
    onEnter: onTogglePlay,
    onLeft: () => onSeek(-10),
    onRight: () => onSeek(10),
  });

  const { ref: nextEpRef, isSpatialFocused: isNextEpFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-next-ep-btn',
    zone: 'player',
    section: 'player-bottom',
    index: 0,
    disabled: !onNextEpisode,
    onEnter: () => onNextEpisode?.(),
  });

  const { ref: fullscreenRef, isSpatialFocused: isFullscreenFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-fullscreen-btn',
    zone: 'player',
    section: 'player-bottom',
    index: onNextEpisode ? 1 : 0,
    onEnter: onToggleFullscreen,
  });

  const lastTimeRef = useRef<number>(0);

  const commitScrub = useCallback(() => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false);
    const finalTime = scrubTimeRef.current;
    onSeekTo(finalTime);
    setCurrentTime(finalTime);
    lastTimeRef.current = finalTime;
    const video = videoRef.current;
    if (wasPlayingBeforeScrubRef.current && video) {
      video.play().catch(() => {});
    }
  }, [onSeekTo, videoRef]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLInputElement>) => {
      if (e.button !== 0) return;

      const video = videoRef.current;
      wasPlayingBeforeScrubRef.current = video ? !video.paused : false;
      if (video && !video.paused) {
        video.pause();
      }

      isScrubbingRef.current = true;
      setIsScrubbing(true);
      const val = parseFloat((e.target as HTMLInputElement).value);
      setScrubTime(val);
      scrubTimeRef.current = val;

      const handleGlobalPointerUp = () => {
        window.removeEventListener('pointerup', handleGlobalPointerUp);
        window.removeEventListener('pointercancel', handleGlobalPointerUp);
        commitScrub();
      };

      window.addEventListener('pointerup', handleGlobalPointerUp);
      window.addEventListener('pointercancel', handleGlobalPointerUp);
    },
    [videoRef, commitScrub]
  );

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      scrubTimeRef.current = val;
      if (isScrubbingRef.current) {
        setScrubTime(val);
      } else {
        onSeekTo(val);
        setCurrentTime(val);
        lastTimeRef.current = val;
      }
    },
    [onSeekTo]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateBufferAndTimeline = (force = false) => {
      if (isScrubbing || hasPreview) return;
      const cur = video.currentTime;
      if (!force && Math.abs(cur - lastTimeRef.current) < 0.5) {
        return;
      }
      lastTimeRef.current = cur;
      const dur = video.duration || 0;
      setCurrentTime(cur);
      setDuration(dur);

      let activeBufferEnd = cur;
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (cur >= start - 0.5 && cur <= end) {
          activeBufferEnd = Math.max(activeBufferEnd, end);
          break;
        }
      }
      setBuffered(activeBufferEnd);
    };

    if (showControls) {
      updateBufferAndTimeline(true);
    }

    const onTimeUpdate = () => {
      if (showControls) {
        updateBufferAndTimeline();
      }
    };

    const onProgress = () => {
      if (showControls) {
        updateBufferAndTimeline(true);
      }
    };

    const onMetadata = () => {
      if (showControls) {
        updateBufferAndTimeline(true);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', onProgress);
    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('durationchange', onMetadata);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('durationchange', onMetadata);
    };
  }, [videoRef, showControls, isScrubbing, hasPreview]);

  return (
    <div className="space-y-3">
      {/* Seek Progress Bar */}
      <div className="group relative w-full h-6 flex items-center cursor-pointer touch-none">
        <input
          ref={timelineRef}
          type="range"
          min="0"
          max={duration || 100}
          step="any"
          value={displayTime}
          onPointerDown={handlePointerDown}
          onChange={handleSliderChange}
          className={`w-full h-1.5 group-hover:h-2.5 rounded-lg appearance-none cursor-pointer accent-red-600 touch-none spatial-focus-indicator ${
            isTimelineFocused ? 'spatial-focus-active ring-2 ring-white/90' : ''
          }`}
          style={{
            background: `linear-gradient(to right, #dc2626 ${(displayTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${
              (displayTime / (duration || 1)) * 100
            }% ${(buffered / (duration || 1)) * 100}%, #27272a ${(buffered / (duration || 1)) * 100}%)`,
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        {/* Left Controls: Next Episode & Timestamp */}
        <div className="flex items-center gap-4">
          {onNextEpisode && (
            <button
              ref={nextEpRef}
              onClick={onNextEpisode}
              className={`p-1.5 text-zinc-400 hover:text-white transition rounded-full cursor-pointer spatial-focus-indicator ${
                isNextEpFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
              }`}
              title="Next Episode"
            >
              <SkipForward className="w-5 h-5" />
            </button>
          )}

          <div className="text-xs tabular-nums text-zinc-400 font-semibold tracking-wider">
            <span className="text-white">{formatTime(displayTime)}</span> / {formatTime(duration)}
          </div>
        </div>

        {/* Right Controls: Fullscreen */}
        <div className="flex items-center gap-2">
          <button
            ref={fullscreenRef}
            onClick={onToggleFullscreen}
            className={`p-2 text-zinc-400 hover:text-white transition rounded-full cursor-pointer spatial-focus-indicator ${
              isFullscreenFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
            }`}
            title="Fullscreen (F)"
          >
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
});

interface HlsPlayerProps {
  media: PlayingMediaInfo;
  initialTimestamp?: number;
  onClose: () => void;
  onProgressUpdate?: (fileId: string, timestamp: number, runtime: number) => void;
  onNextEpisode?: () => void;
}

export function HlsPlayer({
  media,
  initialTimestamp = 0,
  onClose,
  onProgressUpdate,
  onNextEpisode,
}: HlsPlayerProps) {
  const { pushZone, popZone, setFocused, getFocusedId } = useSpatialNavigation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pushZone('player', 'player-play-pause-btn');
    return () => {
      popZone('player');
    };
  }, [pushZone, popZone]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [streamInfo, setStreamInfo] = useState<StreamInfoResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Overlay & Trickplay state
  const [showControls, setShowControls] = useState<boolean>(true);
  const [trickplaySeekTime, setTrickplaySeekTime] = useState<number | null>(null);
  const activeSeekRef = useRef<{
    direction: 'left' | 'right';
    targetTime: number;
    startTime: number;
    lastTickTime: number;
    repeatCount: number;
    wasPlaying: boolean;
  } | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subtitles & Audio state
  const [activeSubtitleLang, setActiveSubtitleLang] = useState<string | null>(null);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(0);
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string; lang: string }[]>([]);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string>('');

  const initialTimestampRef = useRef<number>(initialTimestamp);
  const isTransitioningRef = useRef<boolean>(false);
  const parsedCuesRef = useRef<SubtitleCue[]>([]);
  const currentSubtitleTextRef = useRef<string>('');

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
    let mediaErrorCount = 0;
    let networkErrorCount = 0;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        backBufferLength: 5,
        maxBufferLength: 30,
        maxMaxBufferLength: 45,
        maxBufferSize: 30 * 1024 * 1024,
        maxBufferHole: 0.2,
        highBufferWatchdogPeriod: 1,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 4,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 4,
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
        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_FULL_ERROR) {
            const v = videoRef.current;
            if (v && hlsRef.current && v.currentTime > 15) {
              hlsRef.current.trigger(Hls.Events.BUFFER_FLUSHING, {
                startOffset: 0,
                endOffset: v.currentTime - 10,
                type: null,
              });
            }
          }
          return;
        }

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (networkErrorCount < 3) {
              networkErrorCount++;
              hls.startLoad();
            } else {
              hls.destroy();
              setError('Network connection lost. Please check your network.');
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (mediaErrorCount === 0) {
              mediaErrorCount++;
              hls.recoverMediaError();
            } else if (mediaErrorCount === 1) {
              mediaErrorCount++;
              hls.swapAudioCodec();
              hls.recoverMediaError();
            } else {
              hls.destroy();
              setError('Fatal media playback error encountered.');
            }
            break;
          default:
            hls.destroy();
            setError('Fatal playback error encountered.');
            break;
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
        if (video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
        }
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      video.src = streamUrl;
      const onLoadedMetadata = () => {
        setLoading(false);
        if (initialTimestampRef.current > 0) {
          video.currentTime = initialTimestampRef.current;
          initialTimestampRef.current = 0;
        }
        video.play().catch(() => {});
      };
      video.addEventListener('loadedmetadata', onLoadedMetadata);

      return () => {
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    } else {
      setError('HLS playback is not supported on this browser.');
      setLoading(false);
    }
  }, [streamInfo?.url]);

  // 4. Subtitle WebVTT loading & parsing for custom crisp rendering + RTL support
  useEffect(() => {
    if (!activeSubtitleLang || !streamInfo?.subtitles) {
      parsedCuesRef.current = [];
      currentSubtitleTextRef.current = '';
      setCurrentSubtitleText('');
      return;
    }

    const track = streamInfo.subtitles.find((s) => s.lang === activeSubtitleLang);
    if (!track) {
      parsedCuesRef.current = [];
      currentSubtitleTextRef.current = '';
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
        const matched = findActiveCueText(cues, videoTime);
        currentSubtitleTextRef.current = matched;
        setCurrentSubtitleText(matched);
      })
      .catch(() => {
        if (!isSubMounted) return;
        parsedCuesRef.current = [];
        currentSubtitleTextRef.current = '';
        setCurrentSubtitleText('');
      });

    return () => {
      isSubMounted = false;
    };
  }, [activeSubtitleLang, streamInfo]);

  // 5. Update active subtitle cue on timeupdate
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    // Subtitle cue matching: only trigger React state update when text actually changes
    const newSubText = findActiveCueText(parsedCuesRef.current, video.currentTime);
    if (newSubText !== currentSubtitleTextRef.current) {
      currentSubtitleTextRef.current = newSubText;
      setCurrentSubtitleText(newSubText);
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
    popZone('player');
    flushProgress();
    onClose();
  }, [popZone, flushProgress, onClose]);

  const handleDismissSubtitleMenu = useCallback(() => {
    setShowSubtitleMenu(false);
    popZone('player-menu');
    setFocused('player-subtitles-btn', true);
  }, [popZone, setFocused]);

  const handleDismissSettingsMenu = useCallback(() => {
    setShowSettingsMenu(false);
    popZone('player-menu');
    setFocused('player-settings-btn', true);
  }, [popZone, setFocused]);

  const openSubtitleMenu = useCallback(() => {
    setShowSubtitleMenu(true);
    setShowSettingsMenu(false);
    pushZone('player-menu', activeSubtitleLang ? `player-sub-item-${activeSubtitleLang}` : 'player-sub-item-off');
  }, [activeSubtitleLang, pushZone]);

  const openSettingsMenu = useCallback(() => {
    setShowSettingsMenu(true);
    setShowSubtitleMenu(false);
    pushZone('player-menu', `player-speed-item-${playbackRate}`);
  }, [playbackRate, pushZone]);

  // Deterministic stack-based zone back handlers
  useZoneBack('player', () => {
    if (showControls) {
      dismissControls();
    } else {
      handleClose();
    }
  });
  useZoneBack(
    'player-menu',
    () => {
      if (showSubtitleMenu) {
        handleDismissSubtitleMenu();
      } else if (showSettingsMenu) {
        handleDismissSettingsMenu();
      }
    },
    showSubtitleMenu || showSettingsMenu
  );

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
      if (!isTransitioningRef.current) {
        flushProgress();
      }
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
    setFocused('player-play-pause-btn', false);
  }, [setFocused]);

  const resetHideTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    const isVideoPlaying = videoRef.current ? !videoRef.current.paused : false;
    if (isVideoPlaying && !showSubtitleMenu && !showSettingsMenu) {
      controlsTimeoutRef.current = setTimeout(() => {
        dismissControls();
      }, 3500);
    }
  }, [showSubtitleMenu, showSettingsMenu, dismissControls]);

  useEffect(() => {
    if (!showControls || !isPlaying || showSubtitleMenu || showSettingsMenu) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      return;
    }

    resetHideTimer();

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, isPlaying, showSubtitleMenu, showSettingsMenu, resetHideTimer]);

  const triggerActivity = useCallback(() => {
    setShowControls((prev) => (prev ? prev : true));
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleControls = useCallback(() => {
    if (showControls) {
      dismissControls();
    } else {
      triggerActivity();
    }
  }, [showControls, dismissControls, triggerActivity]);

  // 8. Player Actions
  const playMedia = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {});
    setIsPlaying(true);
    triggerActivity();
  }, [triggerActivity]);

  const pauseMedia = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setIsPlaying(false);
    triggerActivity();
  }, [triggerActivity]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      playMedia();
    } else {
      pauseMedia();
    }
  }, [playMedia, pauseMedia]);

  const seek = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
      triggerActivity();
    },
    [triggerActivity]
  );

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.max(0, Math.min(video.duration || 0, time));
      video.currentTime = target;
      triggerActivity();
    },
    [triggerActivity]
  );

  const handleNextEpisode = useCallback(() => {
    if (onNextEpisode) {
      isTransitioningRef.current = true;
      flushProgress();
      onNextEpisode();
    }
  }, [onNextEpisode, flushProgress]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  const handleCast = async () => {
    const video = videoRef.current as any;
    if (!video) return;

    // 1. Apple AirPlay (Safari iOS / macOS)
    if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
      video.webkitShowPlaybackTargetPicker();
      return;
    }

    // 2. Standard Remote Playback API (Chrome / Android / modern browsers)
    if (video.remote && typeof video.remote.prompt === 'function') {
      try {
        await video.remote.prompt();
      } catch {
        // Picker dismissed or unsupported
      }
      return;
    }

    // 3. Fallback: Presentation API
    if (typeof window !== 'undefined' && 'PresentationRequest' in window) {
      try {
        const request = new (window as any).PresentationRequest([window.location.href]);
        await request.start();
      } catch {
        // Picker dismissed or unsupported
      }
    }
  };

  // 10. MediaSession Hook
  useMediaSession({
    media,
    isPlaying,
    onPlay: playMedia,
    onPause: pauseMedia,
    onSeek: (offset) => seek(offset),
  });

  // Spatial Focus Nodes for Top Bar Elements
  const { ref: backBtnRef, isSpatialFocused: isBackBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-back-btn',
    zone: 'player',
    section: 'player-top',
    index: 0,
    onEnter: handleClose,
  });

  const { ref: castBtnRef, isSpatialFocused: isCastBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-cast-btn',
    zone: 'player',
    section: 'player-top',
    index: 1,
    onEnter: handleCast,
  });

  const { ref: subBtnRef, isSpatialFocused: isSubBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-subtitles-btn',
    zone: 'player',
    section: 'player-top',
    index: 2,
    onEnter: () => {
      if (showSubtitleMenu) {
        handleDismissSubtitleMenu();
      } else {
        openSubtitleMenu();
      }
    },
  });

  const { ref: settingsBtnRef, isSpatialFocused: isSettingsBtnFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-settings-btn',
    zone: 'player',
    section: 'player-top',
    index: 3,
    onEnter: () => {
      if (showSettingsMenu) {
        handleDismissSettingsMenu();
      } else {
        openSettingsMenu();
      }
    },
  });

  // Spatial Focus Node for Middle Action Elements (Play/Pause only; Left/Right triggers seek)
  const { ref: playPauseRef, isSpatialFocused: isPlayPauseFocused } = useFocusable<HTMLButtonElement>({
    id: 'player-play-pause-btn',
    zone: 'player',
    section: 'player-middle',
    index: 0,
    priority: 100,
    onEnter: togglePlay,
    onLeft: () => seek(-10),
    onRight: () => seek(10),
  });

  // Global Keydown Handler for Idle Wake-Up & Desktop Hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        (target?.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true';

      if (isTextInput) {
        return;
      }

      const isSpace = e.key === ' ' || e.code === 'Space' || e.keyCode === 32 || e.code === 'KeyK';
      const isArrowLeft = e.key === 'ArrowLeft' || e.keyCode === 37;
      const isArrowRight = e.key === 'ArrowRight' || e.keyCode === 39;
      const isJ = e.code === 'KeyJ';
      const isL = e.code === 'KeyL';
      const isLeft = isArrowLeft || isJ;
      const isRight = isArrowRight || isL;
      const isUp = e.key === 'ArrowUp' || e.keyCode === 38;
      const isDown = e.key === 'ArrowDown' || e.keyCode === 40;
      const isEnter = e.key === 'Enter' || e.keyCode === 13;
      const isBack = isBackKey(e);

      // Spacebar: Universal explicit Play / Pause toggle across all states
      if (isSpace) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        togglePlay();
        setShowControls(true);
        triggerActivity();
        return;
      }

      // Desktop hotkeys: Fullscreen (F) and Subtitles toggle (C)
      if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
        triggerActivity();
        return;
      }

      if (e.code === 'KeyC') {
        e.preventDefault();
        if (activeSubtitleLang) {
          setActiveSubtitleLang(null);
        } else if (streamInfo?.subtitles && streamInfo.subtitles.length > 0) {
          setActiveSubtitleLang(streamInfo.subtitles[0].lang);
        }
        triggerActivity();
        return;
      }

      // Determine if Left / Right / J / L should trigger player seek / trickplay:
      // J and L are dedicated transport hotkeys and always seek.
      // Arrow keys trigger seek when controls are hidden, OR when focused on play/pause or timeline slider, OR no focused element
      const currentFocusedId = getFocusedId();
      const isFocusedOnNavButtons =
        showControls &&
        currentFocusedId &&
        currentFocusedId !== 'player-play-pause-btn' &&
        currentFocusedId !== 'player-timeline-slider';

      const shouldSeek = (isJ || isL) || ((isArrowLeft || isArrowRight) && !isFocusedOnNavButtons);

      if (shouldSeek && (isLeft || isRight)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const video = videoRef.current;
        if (!video) return;

        const direction = isLeft ? 'left' : 'right';
        const now = Date.now();

        if (!activeSeekRef.current || activeSeekRef.current.direction !== direction) {
          const wasPlaying = activeSeekRef.current ? activeSeekRef.current.wasPlaying : !video.paused;
          const initialTime = activeSeekRef.current ? activeSeekRef.current.targetTime : video.currentTime;
          const delta = direction === 'left' ? -10 : 10;
          const targetTime = Math.max(0, Math.min(video.duration || 0, initialTime + delta));

          activeSeekRef.current = {
            direction,
            targetTime,
            startTime: now,
            lastTickTime: now,
            repeatCount: 0,
            wasPlaying,
          };

          // Immediate seek for single tap responsiveness
          video.currentTime = targetTime;
          setShowControls(true);
          triggerActivity();
          if (!showControls || !currentFocusedId) {
            setFocused('player-play-pause-btn', false);
          }
          return;
        }

        // Long press / repeat event handling
        const seekState = activeSeekRef.current;
        seekState.repeatCount += 1;

        // On first repeat tick, pause video playback so audio stops and decoder rests
        if (seekState.repeatCount === 1) {
          if (seekState.wasPlaying && !video.paused) {
            video.pause();
          }
        }

        // Throttle rapid repeat calculations to ~60ms intervals
        if (now - seekState.lastTickTime < 60) {
          return;
        }

        const elapsed = now - seekState.startTime;
        let step = 10;
        if (elapsed > 3000) {
          step = 60; // > 3s: fast skip (60s jumps)
        } else if (elapsed > 1200) {
          step = 30; // 1.2s - 3s: medium skip (30s jumps)
        } else {
          step = 10; // < 1.2s: fine skip (10s jumps)
        }

        seekState.lastTickTime = now;
        const delta = direction === 'left' ? -step : step;
        seekState.targetTime = Math.max(0, Math.min(video.duration || 0, seekState.targetTime + delta));

        setTrickplaySeekTime(seekState.targetTime);
        setShowControls(true);
        triggerActivity();
        if (!showControls || !currentFocusedId) {
          setFocused('player-play-pause-btn', false);
        }
        return;
      }

      // When controls are hidden, wake up overlay on navigation / action keys
      if (!showControls) {
        if (isBack) {
          // Allow zone back handler to trigger dismissal/close
          return;
        }

        if (isEnter) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          togglePlay();
          setShowControls(true);
          triggerActivity();
          setFocused('player-play-pause-btn', false);
          return;
        }

        if (isUp || isDown) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setShowControls(true);
          triggerActivity();
          setFocused('player-play-pause-btn', false);
          return;
        }
      } else {
        triggerActivity();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const isArrowLeft = e.key === 'ArrowLeft' || e.keyCode === 37;
      const isArrowRight = e.key === 'ArrowRight' || e.keyCode === 39;
      const isJ = e.code === 'KeyJ';
      const isL = e.code === 'KeyL';
      const isLeft = isArrowLeft || isJ;
      const isRight = isArrowRight || isL;

      if (activeSeekRef.current) {
        const matchesDirection =
          (activeSeekRef.current.direction === 'left' && isLeft) ||
          (activeSeekRef.current.direction === 'right' && isRight);

        if (matchesDirection) {
          const seekState = activeSeekRef.current;
          activeSeekRef.current = null;

          if (seekState.repeatCount > 0) {
            const video = videoRef.current;
            if (video) {
              video.currentTime = seekState.targetTime;
              if (seekState.wasPlaying) {
                video.play().catch(() => {});
              }
            }
          }

          setTrickplaySeekTime(null);
          triggerActivity();
        }
      }
    };

    const handleWindowBlur = () => {
      if (activeSeekRef.current) {
        const seekState = activeSeekRef.current;
        activeSeekRef.current = null;
        if (seekState.repeatCount > 0) {
          const video = videoRef.current;
          if (video) {
            video.currentTime = seekState.targetTime;
            if (seekState.wasPlaying) {
              video.play().catch(() => {});
            }
          }
        }
        setTrickplaySeekTime(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    showControls,
    togglePlay,
    setFocused,
    triggerActivity,
    toggleFullscreen,
    activeSubtitleLang,
    streamInfo,
    getFocusedId,
  ]);

  const isTouchInteractionRef = useRef<boolean>(false);
  const isBackdropClickPendingRef = useRef<boolean>(false);

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

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      triggerActivity();
    },
    [triggerActivity]
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (isPlaying && !showSubtitleMenu && !showSettingsMenu) {
        dismissControls();
      }
    },
    [isPlaying, showSubtitleMenu, showSettingsMenu, dismissControls]
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isPlaying && !showSubtitleMenu && !showSettingsMenu) {
        dismissControls();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, showSubtitleMenu, showSettingsMenu, dismissControls]);

  const handleBackdropAction = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // If clicking interactive control (buttons, sliders, dropdown items), do nothing here
      if (target.closest('button, input, select, textarea, [role="button"], a, .interactive-control, .glass-panel')) {
        return;
      }

      // If the interaction did not START on the backdrop, or was already cleared, ignore
      if (!isBackdropClickPendingRef.current) {
        return;
      }
      isBackdropClickPendingRef.current = false;

      const native = e.nativeEvent as any;
      const isTouch =
        native?.pointerType === 'touch' ||
        native?.sourceCapabilities?.firesTouchEvents === true ||
        isTouchInteractionRef.current ||
        (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && native?.pointerType !== 'mouse');

      // If menus are open:
      // - Mobile (touch): single tap cleanly dismisses both the menu AND controls
      // - Desktop (mouse): closes menu while keeping controls visible
      if (showSubtitleMenu || showSettingsMenu) {
        setShowSubtitleMenu(false);
        setShowSettingsMenu(false);
        if (isTouch) {
          dismissControls();
        } else {
          triggerActivity();
        }
        return;
      }

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
    [showControls, showSubtitleMenu, showSettingsMenu, dismissControls, triggerActivity, togglePlay]
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
      onPointerDownCapture={(e) => {
        if (e.pointerType === 'touch') {
          isTouchInteractionRef.current = true;
        } else if (e.pointerType === 'mouse') {
          isTouchInteractionRef.current = false;
        }
        const target = e.target as HTMLElement | null;
        const isInteractive = Boolean(
          target?.closest('button, input, select, textarea, [role="button"], a, .interactive-control, .glass-panel')
        );
        isBackdropClickPendingRef.current = !isInteractive;
      }}
      onTouchStart={(e) => {
        isTouchInteractionRef.current = true;
        e.stopPropagation();
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
      }}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden overscroll-none"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          flushProgress();
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onSeeked={() => setLoading(false)}
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
          className={`absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] md:bottom-12 flex justify-center pointer-events-none z-20 text-center transition-transform duration-300 ease-out will-change-transform ${
            showControls
              ? '-translate-y-[3.75rem] md:-translate-y-20'
              : 'translate-y-0'
          }`}
          dir={isRtlText(currentSubtitleText) ? 'rtl' : 'ltr'}
        >
          <span
            className="inline-block max-w-[88%] md:max-w-[75%] text-white font-medium px-3.5 py-1.5 rounded-lg bg-black/75 shadow-2xl leading-snug whitespace-pre-line [box-decoration-break:clone]"
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
        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/80 flex flex-col justify-between pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pl-[calc(env(safe-area-inset-left,0px)+1rem)] pr-[calc(env(safe-area-inset-right,0px)+1rem)] md:p-8 transition-opacity duration-300 z-30 transform-gpu ${
          showControls ? 'opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top Bar: Title and Back */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              ref={backBtnRef}
              onClick={handleClose}
              className={`p-2.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer spatial-focus-indicator ${
                isBackBtnFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
              }`}
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
            {/* Cast to Display Button */}
            <button
              ref={castBtnRef}
              onClick={handleCast}
              className={`p-2.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer spatial-focus-indicator ${
                isCastBtnFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
              }`}
              title="Cast to Display"
            >
              <Cast className="w-5 h-5" />
            </button>

            {/* Subtitles Menu Trigger */}
            <div className="relative">
              <button
                ref={subBtnRef}
                onClick={() => {
                  if (showSubtitleMenu) {
                    handleDismissSubtitleMenu();
                  } else {
                    openSubtitleMenu();
                  }
                }}
                className={`p-2.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer spatial-focus-indicator ${
                  isSubBtnFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
                }`}
                title="Subtitles & Audio"
              >
                <Subtitles className="w-5 h-5" />
              </button>

              {/* Subtitles & Audio Dropdown Menu */}
              {showSubtitleMenu && (
                <PlayerSubtitlesAudioMenu
                  activeSubtitleLang={activeSubtitleLang}
                  streamInfo={streamInfo}
                  audioTracks={audioTracks}
                  activeAudioTrack={activeAudioTrack}
                  mediaId={media.mediaId}
                  onSelectSubtitle={(lang) => setActiveSubtitleLang(lang)}
                  onSelectAudioTrack={(trkId) => {
                    setActiveAudioTrack(trkId);
                    if (hlsRef.current) hlsRef.current.audioTrack = trkId;
                  }}
                  onDismiss={handleDismissSubtitleMenu}
                />
              )}
            </div>

            {/* Playback Settings Menu */}
            <div className="relative">
              <button
                ref={settingsBtnRef}
                onClick={() => {
                  if (showSettingsMenu) {
                    handleDismissSettingsMenu();
                  } else {
                    openSettingsMenu();
                  }
                }}
                className={`p-2.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer spatial-focus-indicator ${
                  isSettingsBtnFocused ? 'spatial-focus-pill ring-2 ring-white/90 bg-white/20 text-white' : ''
                }`}
                title="Playback Settings"
              >
                <Settings className="w-5 h-5" />
              </button>

              {showSettingsMenu && (
                <div className="absolute right-0 top-12 w-56 bg-zinc-900/98 rounded-2xl p-3 shadow-2xl z-40 border border-white/10">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 px-1">Speed</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd, idx) => (
                      <PlayerSpeedItem
                        key={spd}
                        speed={spd}
                        index={idx}
                        isSelected={playbackRate === spd}
                        onSelect={(newSpd) => {
                          if (videoRef.current) videoRef.current.playbackRate = newSpd;
                          setPlaybackRate(newSpd);
                        }}
                        onDismiss={handleDismissSettingsMenu}
                      />
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
            tabIndex={-1}
            className="p-3.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer active:scale-95"
            title="Skip back 10s (← / J)"
          >
            <RotateCcw className="w-7 h-7" />
          </button>

          <button
            ref={playPauseRef}
            onClick={togglePlay}
            className={`p-5 rounded-full bg-red-600 hover:bg-red-500 text-white transition transform hover:scale-105 active:scale-95 cursor-pointer spatial-focus-indicator ${
              isPlayPauseFocused ? 'spatial-focus-pill ring-2 ring-white/90' : ''
            }`}
            title="Play / Pause (Space / K)"
          >
            {isPlaying ? <Pause className="w-9 h-9 fill-current" /> : <Play className="w-9 h-9 fill-current" />}
          </button>

          <button
            onClick={() => seek(10)}
            tabIndex={-1}
            className="p-3.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer active:scale-95"
            title="Skip forward 10s (→ / L)"
          >
            <RotateCw className="w-7 h-7" />
          </button>
        </div>

        {/* Bottom Bar: Timeline & Control Trays */}
        <PlayerBottomBar
          videoRef={videoRef}
          showControls={showControls}
          previewTime={trickplaySeekTime}
          onSeek={seek}
          onSeekTo={seekTo}
          onTogglePlay={togglePlay}
          onNextEpisode={onNextEpisode ? handleNextEpisode : undefined}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    </div>
  );
}
