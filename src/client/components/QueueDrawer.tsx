import React from 'react';
import { X, ListVideo, AlertTriangle, RefreshCw, Clock } from 'lucide-react';
import type { UserActiveMediaState } from '../../main/types/index.js';
import { parseDisplayFileId } from '../utils/formatters.js';

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeRequests: Record<string, UserActiveMediaState>;
  onRefresh: () => void;
}

export function QueueDrawer({
  isOpen,
  onClose,
  activeRequests,
  onRefresh,
}: QueueDrawerProps) {
  if (!isOpen) return null;

  const items = Object.values(activeRequests).filter((item) => item.status !== 'ready');

  const getStatusBadge = (status: UserActiveMediaState['status']) => {
    switch (status) {
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-zinc-900 px-2 py-0.5 rounded-lg border border-zinc-800">
            <AlertTriangle className="w-3 h-3 text-red-400" /> Failed
          </span>
        );
      case 'queued':
        return (
          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-zinc-900 px-2 py-0.5 rounded-lg border border-zinc-800">
            <Clock className="w-3 h-3 text-amber-400" /> Queued
          </span>
        );
      case 'ready':
      case 'preparing':
      default:
        return null;
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex justify-end"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md h-full glass-panel border-l border-zinc-800 p-6 flex flex-col animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400">
              <ListVideo className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Active Requests</h2>
              <p className="text-xs text-zinc-400">Live stream preparation</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
              title="Refresh requests"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* List of active requests */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 flex items-center justify-center text-zinc-600">
                <ListVideo className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-zinc-400">No active requests</p>
              <p className="text-xs text-zinc-600 max-w-xs">
                When you request a movie or show, the live streaming preparation progress will appear here.
              </p>
            </div>
          ) : (
            items.map((item) => {
              const info = parseDisplayFileId(item.fileId);
              const displayName = info.isEpisode
                ? `${info.title} (${info.subtitle})`
                : info.title;

              return (
                <div
                  key={item.fileId}
                  className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-white truncate block">
                        {displayName}
                      </span>
                    </div>
                    {getStatusBadge(item.status)}
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                      <span>Progress</span>
                      <span className="text-indigo-300 font-bold">{item.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, parseFloat(item.progress) || 0))}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
