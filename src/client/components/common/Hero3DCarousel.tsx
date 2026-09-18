import React, { useCallback, useEffect } from 'react';
import { Star, Info, Film, Tv } from 'lucide-react';
import { motion, type PanInfo } from 'motion/react';
import type { MovieMetadata, ShowMetadata } from '../../../main/types/index.js';
import { ImageWithSkeleton } from './ImageWithSkeleton.js';

import { useFocusable, useSpatialNavigation } from '../../context/SpatialNavigationContext.js';

interface Hero3DCarouselProps {
  items: (MovieMetadata | ShowMetadata)[];
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  onSelectMedia: (media: MovieMetadata | ShowMetadata) => void;
  className?: string;
}

// 3D transformation profiles by offset distance from center
const TRANSFORM_PROFILES: Record<number, { x: number; rotateY: number; scale: number; z: number; opacity: number; zIndex: number; brightness: number }> = {
  0: { x: 0, rotateY: 0, scale: 1, z: 0, opacity: 1, zIndex: 30, brightness: 100 },
  1: { x: 52, rotateY: 25, scale: 0.88, z: -90, opacity: 0.75, zIndex: 20, brightness: 75 },
  2: { x: 86, rotateY: 38, scale: 0.74, z: -200, opacity: 0.4, zIndex: 10, brightness: 50 },
};

function getWrappedOffset(index: number, activeIndex: number, length: number): number {
  if (length <= 1) return 0;
  let diff = (index - activeIndex) % length;
  if (diff > length / 2) diff -= length;
  if (diff < -length / 2) diff += length;
  return diff;
}

export const Hero3DCarousel = React.memo(function Hero3DCarousel({
  items,
  activeIndex = 0,
  onActiveIndexChange,
  onSelectMedia,
  className = '',
}: Hero3DCarouselProps) {
  const length = items.length;
  const activeItem = items[activeIndex];

  const navigate = useCallback(
    (step: number) => {
      if (length <= 1) return;
      onActiveIndexChange?.((activeIndex + step + length) % length);
    },
    [activeIndex, length, onActiveIndexChange]
  );

  const { ref: heroRef, isSpatialFocused } = useFocusable<HTMLButtonElement>({
    id: 'hero-carousel-card',
    zone: 'explore',
    section: 'hero',
    autoFocus: true,
    priority: 100,
    onLeft: () => navigate(-1),
    onRight: () => navigate(1),
    onEnter: () => {
      if (activeItem) {
        onSelectMedia(activeItem);
      }
    },
  });

  if (!items || items.length === 0) return null;

  return (
    <section className={`relative w-full h-[380px] sm:h-[420px] md:h-[450px] py-0 select-none overflow-hidden ${className}`}>
      <div
        className="w-full h-full relative flex items-center justify-center overflow-hidden"
        style={{ perspective: '1400px', perspectiveOrigin: 'center center' }}
      >
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.25}
          onDragEnd={(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.x < -40 || info.velocity.x < -250) navigate(1);
            else if (info.offset.x > 40 || info.velocity.x > 250) navigate(-1);
          }}
          className="w-full h-full relative flex items-center justify-center"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {items.map((item, idx) => {
            const offset = getWrappedOffset(idx, activeIndex, length);
            const isCenter = offset === 0;
            const abs = Math.abs(offset);
            const sign = offset < 0 ? -1 : 1;

            const profile = TRANSFORM_PROFILES[abs] || {
              x: 120,
              rotateY: 50,
              scale: 0.5,
              z: -350,
              opacity: 0,
              zIndex: 0,
              brightness: 0,
            };

            return (
              <motion.div
                key={item.id}
                animate={{
                  x: `${sign * profile.x}%`,
                  rotateY: -sign * profile.rotateY,
                  scale: profile.scale,
                  z: profile.z,
                  opacity: profile.opacity,
                }}
                transition={{ type: 'spring', stiffness: 280, damping: 28, mass: 0.8 }}
                style={{
                  zIndex: profile.zIndex,
                  transformStyle: 'preserve-3d',
                  pointerEvents: abs > 2 ? 'none' : 'auto',
                }}
                onClick={() => !isCenter && onActiveIndexChange?.(idx)}
                className={`absolute w-[84vw] sm:w-[72vw] md:w-[64vw] lg:w-[58vw] max-w-5xl h-full rounded-3xl overflow-hidden border shadow-2xl group ${
                  isCenter
                    ? 'cursor-default ring-1 ring-white/15 border-white/10 glass-panel'
                    : 'cursor-pointer hover:border-white/25 border-white/10 bg-zinc-900/90'
                }`}
              >
                {/* Background Artwork */}
                <div className="absolute inset-0 bg-zinc-950">
                  <ImageWithSkeleton
                    src={item.background || item.poster}
                    alt={item.title}
                    priority={isCenter}
                    className="w-full h-full object-cover object-center opacity-100 group-hover:scale-105 transition-transform duration-700"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 text-zinc-700">
                        {item.type === 'movie' ? (
                          <Film className="w-16 h-16 opacity-20" />
                        ) : (
                          <Tv className="w-16 h-16 opacity-20" />
                        )}
                      </div>
                    }
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/45 to-transparent" />
                  {/* Native GPU-friendly Dimmer Scrim for Off-Center 3D Cards */}
                  {!isCenter && (
                    <div
                      className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-300"
                      style={{ opacity: (100 - profile.brightness) / 100 }}
                    />
                  )}
                </div>

                {/* Active Card Hero Content */}
                {isCenter && (
                  <motion.div
                    key={`hero-content-${item.id}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="absolute bottom-6 sm:bottom-8 left-6 sm:left-8 right-6 sm:right-8 z-20 max-w-2xl space-y-3"
                  >
                    {item.logo ? (
                      <img
                        src={item.logo}
                        alt={item.title}
                        className="max-h-14 sm:max-h-18 w-auto max-w-xs sm:max-w-md object-contain drop-shadow-2xl mb-1"
                      />
                    ) : (
                      <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight drop-shadow-md">
                        {item.title}
                      </h2>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-zinc-300 font-medium">
                      {item.year && <span>{item.year}</span>}
                      {item.rating && (
                        <>
                          <span className="text-zinc-600 select-none">•</span>
                          <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                            <span>{item.rating}</span>
                          </span>
                        </>
                      )}
                      {item.genres && item.genres.length > 0 && (
                        <>
                          <span className="text-zinc-600 select-none">•</span>
                          <span className="text-zinc-400 truncate max-w-xs">{item.genres.slice(0, 3).join(', ')}</span>
                        </>
                      )}
                    </div>

                    {item.description && (
                      <p className="text-xs sm:text-sm text-zinc-300 line-clamp-2 max-w-xl leading-relaxed">
                        {item.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        ref={isCenter ? heroRef : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectMedia(item);
                        }}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl glass-panel border text-white text-xs sm:text-sm font-bold transition-all backdrop-blur-md cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${
                          isSpatialFocused
                            ? 'bg-white/25 border-white/90 ring-2 ring-white/90 scale-[1.02]'
                            : 'bg-white/10 hover:bg-white/20 border-white/15'
                        }`}
                      >
                        <Info className="w-4 h-4 text-zinc-300" />
                        <span>Details</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
});

export default Hero3DCarousel;
