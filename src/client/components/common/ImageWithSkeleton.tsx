import React, { useState, useEffect, useRef } from 'react';
import { Skeleton } from './Skeleton.js';

interface ImageWithSkeletonProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  containerClassName?: string;
  skeletonClassName?: string;
  fallback?: React.ReactNode;
  priority?: boolean;
}

export function ImageWithSkeleton({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  skeletonClassName = '',
  fallback,
  priority = false,
  style,
  ...props
}: ImageWithSkeletonProps) {
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [currentSrc, setCurrentSrc] = useState<string | null | undefined>(src);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Synchronous reset during render if src changes to prevent stale image flashes
  if (src !== currentSrc) {
    setCurrentSrc(src);
    setIsLoaded(false);
    setHasError(false);
  }

  // Check if image is already cached/complete on mount or src change
  useEffect(() => {
    setHasError(false);
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && (img.currentSrc === src || img.src === src)) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [src]);

  if (!src || hasError) {
    return (
      <div className={`relative w-full h-full overflow-hidden flex items-center justify-center bg-zinc-900 ${containerClassName}`}>
        {fallback ? (
          <div className="relative z-10 flex items-center justify-center w-full h-full animate-in fade-in duration-200">
            {fallback}
          </div>
        ) : (
          <div className="w-full h-full bg-zinc-900" />
        )}
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${containerClassName}`}>
      {/* Background Animated Pulse Skeleton (visible until image finishes loading) */}
      {!isLoaded && (
        <Skeleton
          variant="pulse"
          className={`absolute inset-0 w-full h-full rounded-[inherit] z-0 ${skeletonClassName}`}
        />
      )}

      {/* Native Image: hidden with opacity 0 until loaded, smoothly revealing intended caller opacity */}
      <img
        ref={(el) => {
          imgRef.current = el;
          if (el && el.complete && el.naturalWidth > 0 && !isLoaded && (el.currentSrc === src || el.src === src)) {
            setIsLoaded(true);
          }
        }}
        src={src}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          setHasError(true);
          setIsLoaded(false);
        }}
        style={{
          ...style,
          ...(isLoaded ? {} : { opacity: 0, pointerEvents: 'none' }),
        }}
        className={`relative w-full h-full object-cover transition-opacity duration-300 ease-out ${className}`}
        {...props}
      />
    </div>
  );
}

export default ImageWithSkeleton;

