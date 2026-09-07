import React from 'react';
import { Skeleton } from '../components/common/Skeleton.js';

export function MediaDetailSkeleton() {
  return (
    <div className="min-h-screen text-zinc-100 animate-in fade-in duration-300 pb-28">
      {/* 1. Full-Bleed Cinematic Hero Banner Skeleton */}
      <div className="relative w-full h-[58vh] sm:h-[60vh] min-h-[460px] sm:min-h-[500px] max-h-[640px] bg-zinc-950 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-transparent to-transparent" />

        {/* Hero Title & Primary Metadata Overlay Skeleton */}
        <div className="absolute bottom-6 left-4 sm:left-8 right-4 sm:right-8 z-10 max-w-5xl space-y-3">
          <Skeleton className="h-10 sm:h-14 w-2/3 max-w-lg rounded-2xl" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-12 rounded-md" />
            <Skeleton className="h-4 w-16 rounded-md" />
            <Skeleton className="h-4 w-28 rounded-md" />
          </div>
        </div>
      </div>

      {/* 2. Main Content Body Skeleton */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 space-y-10">
        {/* Storyline & Overview */}
        <div className="space-y-3 max-w-3xl">
          <Skeleton className="h-5 w-28 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full rounded-lg" />
            <Skeleton className="h-4 w-5/6 rounded-lg" />
            <Skeleton className="h-4 w-3/4 rounded-lg" />
          </div>
        </div>

        {/* Episodes / Content Section Skeleton */}
        <section className="space-y-6 pt-4 border-t border-zinc-900">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-6 w-32 rounded-lg" />
            <Skeleton className="h-9 w-44 rounded-xl" />
          </div>

          {/* Episode Cards Grid Skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={`ep-skel-${i}`}
                className="flex flex-col space-y-3"
              >
                <Skeleton className="w-full aspect-video rounded-2xl" />
                <div className="space-y-2 px-0.5">
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                  <Skeleton className="h-3 w-full rounded-md" />
                  <Skeleton className="h-3 w-2/3 rounded-md" />
                </div>
                <div className="pt-2 border-t border-white/5 flex items-center justify-between px-0.5">
                  <Skeleton className="h-3 w-12 rounded-md" />
                  <Skeleton className="h-7 w-20 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default MediaDetailSkeleton;
