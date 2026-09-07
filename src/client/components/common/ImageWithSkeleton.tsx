import React, { useState, useEffect } from 'react';
import { Skeleton } from './Skeleton.js';

interface ImageWithSkeletonProps extends React.ImgHTMLAttributes<HTMLImageElement> {
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
  ...props
}: ImageWithSkeletonProps) {
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // Reset loading & error state when src changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div className={`relative w-full h-full flex items-center justify-center bg-zinc-900 ${containerClassName}`}>
        {fallback || null}
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${containerClassName}`}>
      {/* Animated Skeleton Shimmer Placeholder */}
      {!isLoaded && (
        <Skeleton
          className={`absolute inset-0 w-full h-full rounded-[inherit] ${skeletonClassName}`}
        />
      )}

      {/* Progressive Image with Smooth Fade-in */}
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ease-out ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        } ${className}`}
        {...props}
      />
    </div>
  );
}

export default ImageWithSkeleton;
