import React from 'react';
import { Skeleton } from '../components/common/Skeleton.js';

export function ExploreSkeleton() {
  return (
    <div className="min-h-screen max-w-7xl mx-auto px-4 sm:px-8 py-8 pb-28 space-y-10 animate-in fade-in duration-300">
      {/* 1. Hero Section Skeleton: Featured Movie & Show Tiles */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Large Hero Feature Movie Tile Skeleton */}
        <div className="md:col-span-2 relative h-80 sm:h-96 rounded-3xl overflow-hidden glass-panel border border-zinc-800 p-6 sm:p-8 flex flex-col justify-between">
          <div className="absolute inset-0 -z-10 bg-zinc-950/60" />
          <div />
          <div className="space-y-3">
            <Skeleton className="h-8 sm:h-10 w-2/3 max-w-md rounded-xl" />
            <div className="space-y-1.5 max-w-xl">
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-4 w-4/5 rounded-lg" />
            </div>
            <div className="pt-2 flex items-center gap-3">
              <Skeleton className="h-10 w-32 rounded-xl" />
            </div>
          </div>
        </div>

        {/* Side Highlight Tile Skeleton: Featured Show */}
        <div className="relative h-80 sm:h-96 rounded-3xl overflow-hidden glass-panel border border-zinc-800 p-6 flex flex-col justify-between">
          <div className="absolute inset-0 -z-10 bg-zinc-950/60" />
          <div />
          <div className="space-y-2.5">
            <Skeleton className="h-7 w-3/4 max-w-xs rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-full rounded-lg" />
              <Skeleton className="h-3.5 w-3/4 rounded-lg" />
            </div>
            <div className="pt-2">
              <Skeleton className="h-4 w-20 rounded-md" />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Popular Movies Carousel Skeleton */}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-0.5">
          <Skeleton className="w-5 h-5 rounded-md" />
          <Skeleton className="h-5 w-36 rounded-lg" />
        </div>
        <div className="flex gap-4 overflow-x-hidden pb-2 pt-1">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={`movie-skel-${i}`} className="w-36 sm:w-44 flex-shrink-0 space-y-2">
              <Skeleton className="w-full aspect-[2/3] rounded-2xl" />
              <Skeleton className="h-3.5 w-4/5 rounded-md" />
              <Skeleton className="h-2.5 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      {/* 3. Popular TV Shows Carousel Skeleton */}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 px-0.5">
          <Skeleton className="w-5 h-5 rounded-md" />
          <Skeleton className="h-5 w-40 rounded-lg" />
        </div>
        <div className="flex gap-4 overflow-x-hidden pb-2 pt-1">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={`show-skel-${i}`} className="w-36 sm:w-44 flex-shrink-0 space-y-2">
              <Skeleton className="w-full aspect-[2/3] rounded-2xl" />
              <Skeleton className="h-3.5 w-4/5 rounded-md" />
              <Skeleton className="h-2.5 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ExploreSkeleton;
