import React, { useState, useEffect } from 'react';
import { Clock, RotateCcw, Tv } from 'lucide-react';
import type {
  MovieMetadata,
  ShowMetadata,
  Progress,
  Stream,
  UserActiveMediaState,
} from '../../main/types/index.js';
import type { PlayingMediaInfo } from '../types/ui.js';
import { ApiClient } from '../services/api.js';
import { BaseModal } from './common/BaseModal.js';
import { RatingBadge } from './common/RatingBadge.js';
import { StreamActionButton } from './common/StreamActionButton.js';
import { formatTime, calculateProgressPercent } from '../utils/formatters.js';

interface MediaDetailModalProps {
  media: MovieMetadata | ShowMetadata | null;
  progressMap: Record<string, Progress>;
  readyMap: Record<string, Stream>;
  activeRequests: Record<string, UserActiveMediaState>;
  onClose: () => void;
  onPlayMedia: (info: PlayingMediaInfo) => void;
  onRequestMedia: (fileId: string) => Promise<void>;
}

export function MediaDetailModal({
  media,
  progressMap,
  readyMap,
  activeRequests,
  onClose,
  onPlayMedia,
  onRequestMedia,
}: MediaDetailModalProps) {
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [detailedMedia, setDetailedMedia] = useState<MovieMetadata | ShowMetadata | null>(media);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);

  useEffect(() => {
    if (!media) return;
    setDetailedMedia(media);

    if (media.type === 'movie') {
      ApiClient.getMovieDetails(media.id)
        .then((res) => setDetailedMedia(res.metadata as MovieMetadata))
        .catch(() => {});
    } else {
      ApiClient.getShowDetails(media.id)
        .then((res) => setDetailedMedia(res.metadata as ShowMetadata))
        .catch(() => {});
    }
  }, [media]);

  if (!media) return null;

  const current = detailedMedia || media;
  const isMovie = current.type === 'movie';
  const showMeta = isMovie ? null : (current as ShowMetadata);
  const episodes = showMeta?.episodes || [];
  const seasons = Array.from(new Set(episodes.map((e) => e.season))).sort((a, b) => a - b);
  const currentSeasonEpisodes = episodes.filter((e) => e.season === selectedSeason);

  // Movie stream & progress calculation
  const movieFileId = current.id;
  const isMovieReady = isMovie && (!!readyMap[movieFileId] || activeRequests[movieFileId]?.status === 'ready');
  const movieReq = activeRequests[movieFileId];
  const movieProg = progressMap[movieFileId];
  const moviePercent = calculateProgressPercent(movieProg);

  return (
    <BaseModal
      isOpen={Boolean(media)}
      onClose={onClose}
      maxWidth={isMovie ? '4xl' : '6xl'}
    >
      {/* 1. Cinematic Horizon Banner */}
      <div className={`relative w-full ${isMovie ? 'aspect-video sm:aspect-[21/9]' : 'h-60 sm:h-72'} bg-zinc-900 overflow-hidden flex-shrink-0`}>
        {current.background || current.poster ? (
          <img
            src={current.background || current.poster || ''}
            alt={current.title}
            className={`w-full h-full object-cover ${isMovie ? '' : 'opacity-35'}`}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />
        {isMovie && <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-transparent to-transparent" />}

        {/* Header Overlay: Title / Logo + Season Switcher */}
        <div className="absolute bottom-4 left-6 right-6 z-10 flex flex-col sm:flex-row items-end justify-between gap-4">
          <div className="space-y-1">
            {current.logo ? (
              <img
                src={current.logo}
                alt={current.title}
                className="max-h-14 sm:max-h-20 w-auto max-w-sm object-contain"
              />
            ) : (
              <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
                {current.title}
              </h1>
            )}
            {!isMovie && (
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                {current.year && <span className="font-mono font-bold">{current.year}</span>}
                <RatingBadge rating={current.rating} size="sm" />
                <span className="text-zinc-400">• {episodes.length} Total Episodes</span>
              </div>
            )}
          </div>

          {/* Season Selector Pills for TV Shows */}
          {!isMovie && seasons.length > 1 && (
            <div className="flex gap-1.5 bg-zinc-900/80 p-1 rounded-2xl border border-white/10 backdrop-blur-md">
              {seasons.map((s) => (
                <button
                  key={s}
                  onClick={() => setSelectedSeason(s)}
                  className={`px-3.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                    selectedSeason === s
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Season {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Content Body */}
      <div className="p-6 sm:p-8 space-y-5 overflow-y-auto flex-1 bg-zinc-950/60">
        {/* Metadata Row (for Movie) */}
        {isMovie && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {current.year && (
              <span className="font-mono text-zinc-300 font-bold px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800">
                {current.year}
              </span>
            )}
            <RatingBadge rating={current.rating} size="md" />
            {current.runtime && (
              <span className="flex items-center gap-1 text-zinc-400 font-medium px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800">
                <Clock className="w-3.5 h-3.5" />
                {current.runtime}m
              </span>
            )}
            {movieProg && movieProg.timestamp > 0 && (
              <span className="flex items-center gap-1 text-indigo-400 font-bold px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 font-mono">
                <RotateCcw className="w-3 h-3 text-indigo-400" />
                {formatTime(movieProg.timestamp)} watched ({Math.round(moviePercent)}%)
              </span>
            )}
            {current.genres?.map((g) => (
              <span
                key={g}
                className="px-2.5 py-1 rounded-xl text-xs font-medium bg-zinc-900 text-zinc-400 border border-zinc-800"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Progress Bar for Movie */}
        {isMovie && moviePercent > 0 && (
          <div className="space-y-1">
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(5, moviePercent))}%` }}
              />
            </div>
          </div>
        )}

        {/* Synopsis */}
        {isMovie && (
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {current.description || 'No detailed overview available for this title.'}
          </p>
        )}

        {/* Movie Cast & Action on the same line */}
        {isMovie && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-1">
            {current.cast && current.cast.length > 0 ? (
              <div className="text-xs text-zinc-400 space-y-1 flex-1">
                <span className="font-bold text-zinc-200">Cast: </span>
                {current.cast.slice(0, 8).join(', ')}
              </div>
            ) : <div />}

            <StreamActionButton
              isReady={isMovieReady}
              activeRequest={movieReq}
              isRequesting={requestingId === movieFileId}
              hasProgress={Boolean(movieProg && movieProg.timestamp > 0)}
              progressTimestampFormatted={movieProg ? formatTime(movieProg.timestamp) : undefined}
              size="md"
              onPlay={() => {
                onPlayMedia({
                  fileId: movieFileId,
                  mediaId: current.id,
                  title: current.title,
                  type: 'movie',
                  poster: current.poster,
                  background: current.background,
                });
                onClose();
              }}
              onRequest={() => {
                setRequestingId(movieFileId);
                onRequestMedia(movieFileId).finally(() => setRequestingId(null));
              }}
            />
          </div>
        )}

        {/* TV Show Episode Gallery */}
        {!isMovie && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentSeasonEpisodes.map((ep) => {
                const epFileId = `${current.id}_s${ep.season}_e${ep.episode}`;
                const isEpReady = !!readyMap[epFileId] || activeRequests[epFileId]?.status === 'ready';
                const epReq = activeRequests[epFileId];
                const epProg = progressMap[epFileId];
                const epPercent = calculateProgressPercent(epProg);

                return (
                  <div
                    key={ep.id}
                    className="p-4 rounded-3xl bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition flex flex-col justify-between space-y-3"
                  >
                    <div className="w-full aspect-video rounded-2xl overflow-hidden bg-zinc-950 relative border border-white/10">
                      {ep.thumbnail ? (
                        <img
                          src={ep.thumbnail}
                          alt={ep.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                          <Tv className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-mono">EP {ep.episode}</span>
                        </div>
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

                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-white truncate">
                        {ep.episode}. {ep.title}
                      </h4>
                      <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                        {ep.description || 'No episode synopsis provided.'}
                      </p>
                    </div>

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
                          onClose();
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
          </div>
        )}
      </div>
    </BaseModal>
  );
}
