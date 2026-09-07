import React, { useState, useEffect, useRef } from 'react';
import { Clock, Tv, Play, Check } from 'lucide-react';
import type {
  MovieMetadata,
  ShowMetadata,
  Progress,
  Stream,
  UserActiveMediaState,
} from '../../main/types/index.js';
import type { PlayingMediaInfo } from '../types/ui.js';
import { ApiClient } from '../services/api.js';
import { RatingBadge } from '../components/common/RatingBadge.js';
import { StreamActionButton } from '../components/common/StreamActionButton.js';
import { calculateProgressPercent, parseDisplayFileId } from '../utils/formatters.js';

interface MediaDetailViewProps {
  media: MovieMetadata | ShowMetadata;
  progressMap: Record<string, Progress>;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
  onBack: () => void;
  onPlayMedia: (info: PlayingMediaInfo) => void;
  onRequestMedia: (fileId: string) => Promise<void>;
}

export function MediaDetailView({
  media,
  progressMap,
  readyMap,
  activeRequests,
  onBack,
  onPlayMedia,
  onRequestMedia,
}: MediaDetailViewProps) {
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [detailedMedia, setDetailedMedia] = useState<MovieMetadata | ShowMetadata>(media);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [targetEpisodeNumber, setTargetEpisodeNumber] = useState<number | null>(null);
  const [localProgress, setLocalProgress] = useState<Record<string, Progress>>({});
  const [localReady, setLocalReady] = useState<Record<string, Stream>>({});
  const activeEpisodeCardRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);

  // Scroll to top on mount / media change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    hasScrolledRef.current = false;
  }, [media.id]);

  useEffect(() => {
    setDetailedMedia(media);
    setLocalProgress({});
    setLocalReady({});

    // Check if media has watch progress to resume to
    if (media.type === 'show') {
      const showProgKeys = Object.entries(progressMap)
        .filter(([k, v]) => k.startsWith(`${media.id}_s`) && v && (v.timestamp > 0 || (v.last_updated && v.last_updated > 0)))
        .sort((a, b) => (b[1].last_updated || 0) - (a[1].last_updated || 0));

      if (showProgKeys.length > 0) {
        const parsed = parseDisplayFileId(showProgKeys[0][0]);
        if (parsed.season) setSelectedSeason(parsed.season);
        if (parsed.episode) setTargetEpisodeNumber(parsed.episode);
      } else {
        setSelectedSeason(1);
        setTargetEpisodeNumber(null);
      }
    } else {
      setSelectedSeason(1);
      setTargetEpisodeNumber(null);
    }

    if (media.type === 'movie') {
      if (!media.description && !media.cast?.length) {
        ApiClient.getMovieDetails(media.id)
          .then((res) => {
            if (res.metadata) setDetailedMedia(res.metadata as MovieMetadata);
            if (res.progress) setLocalProgress(res.progress);
            if (res.ready) setLocalReady(res.ready);
          })
          .catch(() => {});
      }
    } else {
      ApiClient.getShowDetails(media.id)
        .then((res) => {
          if (res.metadata) setDetailedMedia(res.metadata as ShowMetadata);
          if (res.progress) {
            setLocalProgress(res.progress);
            const showProgKeys = Object.entries(res.progress)
              .filter(([k, v]) => k.startsWith(`${media.id}_s`) && v && (v.timestamp > 0 || (v.last_updated && v.last_updated > 0)))
              .sort((a, b) => (b[1].last_updated || 0) - (a[1].last_updated || 0));
            if (showProgKeys.length > 0 && !hasScrolledRef.current) {
              const parsed = parseDisplayFileId(showProgKeys[0][0]);
              if (parsed.season) setSelectedSeason(parsed.season);
              if (parsed.episode) setTargetEpisodeNumber(parsed.episode);
            }
          }
          if (res.ready) setLocalReady(res.ready);
        })
        .catch(() => {});
    }
  }, [media]);

  // One-time auto-scroll to active episode card only if opening from Continue Watching / in-progress
  useEffect(() => {
    if (targetEpisodeNumber && !hasScrolledRef.current && activeEpisodeCardRef.current) {
      hasScrolledRef.current = true;
      activeEpisodeCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedSeason, detailedMedia, targetEpisodeNumber]);

  const current = detailedMedia || media;
  const isMovie = current.type === 'movie';
  const showMeta = isMovie ? null : (current as ShowMetadata);
  const episodes = showMeta?.episodes || [];
  const seasons = Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b);
  const currentSeasonEpisodes = episodes.filter((e) => e.season === selectedSeason);

  const mergedProgressMap = { ...progressMap, ...localProgress };
  const mergedReadyMap = { ...readyMap, ...localReady };

  // Movie stream & progress calculation
  const movieFileId = current.id;
  const isMovieReady = isMovie && (!!mergedReadyMap[movieFileId] || activeRequests[movieFileId]?.status === 'ready');
  const movieReq = activeRequests[movieFileId];
  const movieProg = mergedProgressMap[movieFileId];
  const moviePercent = calculateProgressPercent(movieProg);

  return (
    <div className="min-h-screen text-zinc-100 animate-in fade-in duration-300 pb-28">
      {/* 1. Full-Bleed Cinematic Hero Banner */}
      <div className="relative w-full h-[45vh] sm:h-[55vh] min-h-[380px] max-h-[580px] bg-zinc-950 overflow-hidden">
        {current.background || current.poster ? (
          <img
            src={current.background || current.poster || ''}
            alt={current.title}
            className="w-full h-full object-cover object-center opacity-40 scale-105 animate-in fade-in duration-700"
          />
        ) : null}

        {/* Ambient Gradients for smooth fade into page */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-transparent to-transparent" />

        {/* Hero Title & Primary Metadata Overlay */}
        <div className="absolute bottom-6 left-4 sm:left-8 right-4 sm:right-8 z-10 max-w-5xl space-y-3">
          {current.logo ? (
            <img
              src={current.logo}
              alt={current.title}
              className="max-h-16 sm:max-h-24 w-auto max-w-sm sm:max-w-md object-contain drop-shadow-2xl mb-2"
            />
          ) : (
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight drop-shadow-md">
              {current.title}
            </h1>
          )}

          {/* Badges & Meta info */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-300 border border-white/10">
              {isMovie ? 'Movie' : 'TV Show'}
            </span>

            {current.year && (
              <span className="font-mono text-zinc-300 font-bold px-2.5 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
                {current.year}
              </span>
            )}

            <RatingBadge rating={current.rating} size="sm" />

            {isMovie && current.runtime && (
              <span className="flex items-center gap-1 text-zinc-400 font-medium px-2.5 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <Clock className="w-3.5 h-3.5" />
                {current.runtime}m
              </span>
            )}

            {!isMovie && (
              <span className="text-zinc-400 font-medium">
                {episodes.length} Episodes {seasons.length > 0 ? `• ${seasons.length} Seasons` : ''}
              </span>
            )}

            {current.genres?.map((g) => (
              <span
                key={g}
                className="px-2.5 py-0.5 rounded-lg text-xs font-medium bg-zinc-900 text-zinc-400 border border-zinc-800"
              >
                {g}
              </span>
            ))}
          </div>

          {/* Movie Primary Play / Request Button (in Hero) */}
          {isMovie && (
            <div className="pt-2 flex items-center gap-4">
              <StreamActionButton
                isReady={isMovieReady}
                activeRequest={movieReq}
                isRequesting={requestingId === movieFileId}
                hasProgress={Boolean(movieProg && movieProg.timestamp > 0)}
                size="lg"
                onPlay={() => {
                  onPlayMedia({
                    fileId: movieFileId,
                    mediaId: current.id,
                    title: current.title,
                    type: 'movie',
                    poster: current.poster,
                    background: current.background,
                  });
                }}
                onRequest={() => {
                  setRequestingId(movieFileId);
                  onRequestMedia(movieFileId).finally(() => setRequestingId(null));
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 2. Main Content Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-8 mt-4">
        {/* Movie Progress Bar */}
        {isMovie && moviePercent > 0 && (
          <div className="space-y-1.5">
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(5, moviePercent))}%` }}
              />
            </div>
          </div>
        )}

        {/* Synopsis & Cast */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-2">
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Overview</h3>
            <p className="text-sm sm:text-base text-zinc-300 leading-relaxed max-w-3xl">
              {current.description || 'No detailed overview available for this title.'}
            </p>
          </div>

          {current.cast && current.cast.length > 0 && (
            <div className="space-y-3 p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/80">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Starring</h4>
              <p className="text-xs text-zinc-300 leading-relaxed">
                {current.cast.slice(0, 10).join(', ')}
              </p>
            </div>
          )}
        </div>

        {/* 3. TV Show Episode Browser */}
        {!isMovie && (
          <section className="space-y-6 pt-4 border-t border-zinc-800/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Tv className="w-5 h-5 text-indigo-400" />
                <span>Episodes</span>
              </h3>

              {/* Season Selector Tabs */}
              {seasons.length > 1 && (
                <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1 rounded-2xl border border-white/10 backdrop-blur-md overflow-x-auto scrollbar-none">
                  {seasons.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSelectedSeason(s);
                        setTargetEpisodeNumber(null);
                      }}
                      className={`px-4 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                        selectedSeason === s
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      Season {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Episode Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {currentSeasonEpisodes.map((ep) => {
                const epFileId = `${current.id}_s${ep.season}_e${ep.episode}`;
                const isEpReady = !!mergedReadyMap[epFileId] || activeRequests[epFileId]?.status === 'ready';
                const epReq = activeRequests[epFileId];
                const epProg = mergedProgressMap[epFileId];
                const epPercent = calculateProgressPercent(epProg);
                const isTargetEpisode = targetEpisodeNumber === ep.episode;

                return (
                  <div
                    key={ep.id}
                    ref={isTargetEpisode ? activeEpisodeCardRef : undefined}
                    className="p-4 rounded-3xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition flex flex-col justify-between space-y-3"
                  >
                    {/* Episode Thumbnail */}
                    <div
                      onClick={() => {
                        if (isEpReady) {
                          onPlayMedia({
                            fileId: epFileId,
                            mediaId: current.id,
                            title: current.title,
                            subtitle: `S${ep.season}E${ep.episode} • ${ep.title}`,
                            type: 'show',
                            season: ep.season,
                            episode: ep.episode,
                            poster: ep.thumbnail || current.poster,
                            background: current.background,
                          });
                        }
                      }}
                      className={`w-full aspect-video rounded-2xl overflow-hidden bg-zinc-950 relative border border-white/10 ${
                        isEpReady ? 'group/thumb cursor-pointer' : ''
                      }`}
                    >
                      {ep.thumbnail ? (
                        <img
                          src={ep.thumbnail}
                          alt={ep.title}
                          className={`w-full h-full object-cover transition-transform duration-300 ${
                            isEpReady ? 'group-hover/thumb:scale-105' : ''
                          }`}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                          <Tv className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-mono">EP {ep.episode}</span>
                        </div>
                      )}

                      {/* Ready Play circle overlay on hover */}
                      {isEpReady && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="p-3 rounded-full bg-indigo-600 text-white transform group-hover/thumb:scale-110 transition-transform shadow-lg">
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          </div>
                        </div>
                      )}

                      {/* Ready checkmark badge on episode thumbnail */}
                      {isEpReady && (
                        <span className="absolute top-1.5 right-1.5 p-1 rounded-full bg-emerald-500 text-white shadow-md flex items-center justify-center">
                          <Check className="w-3 h-3 stroke-[2.5]" />
                        </span>
                      )}

                      {ep.runtime && (
                        <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-black/80 text-zinc-300">
                          {ep.runtime}m
                        </span>
                      )}

                      {epPercent > 0 && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/70">
                          <div
                            className="h-full bg-indigo-500 rounded-r-full"
                            style={{ width: `${Math.min(100, Math.max(5, epPercent))}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Episode Info */}
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-white truncate">
                        {ep.episode}. {ep.title}
                      </h4>
                      <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                        {ep.description || 'No episode synopsis provided.'}
                      </p>
                    </div>

                    {/* Footer Row: Meta & Stream Action Button */}
                    <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {ep.runtime ? `${ep.runtime}m` : `Season ${ep.season}`}
                      </span>

                      <StreamActionButton
                        isReady={isEpReady}
                        activeRequest={epReq}
                        isRequesting={requestingId === epFileId}
                        hasProgress={epPercent > 0}
                        size="sm"
                        onPlay={() => {
                          onPlayMedia({
                            fileId: epFileId,
                            mediaId: current.id,
                            title: current.title,
                            subtitle: `S${ep.season}E${ep.episode} • ${ep.title}`,
                            type: 'show',
                            season: ep.season,
                            episode: ep.episode,
                            poster: ep.thumbnail || current.poster,
                            background: current.background,
                          });
                        }}
                        onRequest={() => {
                          setRequestingId(epFileId);
                          onRequestMedia(epFileId).finally(() => setRequestingId(null));
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default MediaDetailView;
