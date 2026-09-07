import React from 'react';
import { Skeleton } from '../components/common/Skeleton.js';

export function ExploreSkeleton() {
  return (
    <div className="min-h-screen pb-28 space-y-8 sm:space-y-10 animate-in fade-in duration-300 overflow-x-hidden">
      {/* 1. Full-Bleed 3D Hero Skeleton */}
      <div className="w-full flex items-center justify-center px-4">
        <section className="relative w-[84vw] sm:w-[72vw] md:w-[64vw] lg:w-[58vw] max-w-5xl h-[380px] sm:h-[420px] md:h-[450px] rounded-3xl overflow-hidden glass-panel border border-white/10 p-6 sm:p-8 flex flex-col justify-end">
          <div className="absolute inset-0 bg-zinc-950/60" />

          {/* Bottom Hero Content Skeleton */}
          <div className="relative z-10 max-w-2xl space-y-3.5">
            <Skeleton className="h-10 sm:h-14 w-2/3 max-w-md rounded-2xl" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-12 rounded-md" />
              <Skeleton className="h-4 w-16 rounded-md" />
              <Skeleton className="h-4 w-36 rounded-md" />
            </div>
            <div className="space-y-1.5 max-w-xl">
              <Skeleton className="h-3.5 w-full rounded-lg" />
              <Skeleton className="h-3.5 w-4/5 rounded-lg" />
            </div>
            <div className="pt-2 flex items-center gap-3">
              <Skeleton className="h-10 w-32 rounded-2xl" />
            </div>
          </div>
        </section>
      </div>

      {/* 2. Main Content Rows Skeleton */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 space-y-10">
        {/* 3. Popular Movies Carousel Skeleton */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-0.5">
            <Skeleton className="w-5 h-5 rounded-md" />
            <Skeleton className="h-5 w-36 rounded-lg" />
          </div>
          <div className="flex gap-4 sm:gap-5 overflow-x-hidden pb-2 pt-1">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={`movie-skel-${i}`} className="w-36 sm:w-44 flex-shrink-0 space-y-2">
                <Skeleton className="w-full aspect-[2/3] rounded-2xl" />
                <Skeleton className="h-3.5 w-4/5 rounded-md" />
                <Skeleton className="h-2.5 w-1/2 rounded-md" />
              </div>
            ))}
          </div>
        </div>

        {/* 4. Popular TV Shows Carousel Skeleton */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-0.5">
            <Skeleton className="w-5 h-5 rounded-md" />
            <Skeleton className="h-5 w-40 rounded-lg" />
          </div>
          <div className="flex gap-4 sm:gap-5 overflow-x-hidden pb-2 pt-1">
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
    </div>
  );
}

export default ExploreSkeleton;
