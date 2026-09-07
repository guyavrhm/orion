import React from 'react';
import {
  Compass,
  Search,
  ListVideo,
} from 'lucide-react';
import type { NavigationTab } from '../types/ui.js';
import type { UserActiveMediaState } from '../../main/types/index.js';

interface NavProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  onOpenSearch: () => void;
  onToggleQueue: () => void;
  activeRequests: Record<string, UserActiveMediaState>;
}

export function SidebarNav({
  activeTab,
  onTabChange,
  onOpenSearch,
  onToggleQueue,
  activeRequests,
}: NavProps) {
  const activeCount = Object.keys(activeRequests).filter((k) => activeRequests[k].status !== 'ready').length;

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-40 w-16 sm:w-20 glass-panel border-r border-zinc-800/80 flex flex-col items-center justify-between py-6 select-none">
      {/* Top: Logo */}
      <div className="flex flex-col items-center gap-6">
        <div
          onClick={() => onTabChange('explore')}
          className="w-10 h-10 p-1 cursor-pointer hover:scale-105 transition flex items-center justify-center"
        >
          <img
            src="/assets/images/orion-nobackground.png"
            alt="Orion"
            className="w-full h-full object-contain"
          />
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col items-center gap-2">
          {[
            { id: 'explore', label: 'Explore', icon: Compass },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id as NavigationTab)}
                className={`p-3 rounded-2xl transition cursor-pointer flex flex-col items-center gap-1 group ${
                  isSelected
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
                }`}
                title={item.label}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-bold">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom: Search & Requests Queue */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onOpenSearch}
          className="p-3 rounded-2xl text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition cursor-pointer"
          title="Search (Cmd+K)"
        >
          <Search className="w-5 h-5" />
        </button>

        <button
          onClick={onToggleQueue}
          className={`relative p-3 rounded-2xl transition cursor-pointer ${
            activeCount > 0
              ? 'bg-zinc-800 text-indigo-400 border border-zinc-700'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
          }`}
          title="Requests"
        >
          <ListVideo className="w-5 h-5" />
          {activeCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-indigo-500 rounded-full ring-2 ring-zinc-950" />
          )}
        </button>
      </div>
    </aside>
  );
}
