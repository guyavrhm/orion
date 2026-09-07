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
  ...props
}: ImageWithSkeletonProps) {
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Check if image is already cached/complete on mount or src change
  useEffect(() => {
    setHasError(false);
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [src]);

  if (!src || hasError) {
    return (
      <div className={`relative w-full h-full overflow-hidden flex items-center justify-center bg-zinc-900 ${containerClassName}`}>
        <Skeleton
          variant="none"
          className={`absolute inset-0 w-full h-full rounded-[inherit] ${skeletonClassName}`}
        />
        {fallback && (
          <div className="relative z-10 flex items-center justify-center w-full h-full">
            {fallback}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${containerClassName}`}>
      {/* Background Skeleton Placeholder (visible while image is loading) */}
      <Skeleton
        variant="none"
        className={`absolute inset-0 w-full h-full rounded-[inherit] ${skeletonClassName}`}
      />

      {/* Native Image: hidden (opacity-0) until loaded so default browser broken alt never renders */}
      <img
        ref={(el) => {
          imgRef.current = el;
          if (el?.complete && el.naturalWidth > 0 && !isLoaded) {
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
        className={`relative w-full h-full object-cover ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        } ${className}`}
        {...props}
      />
    </div>
  );
}

export default ImageWithSkeleton;

