import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  variant?: 'pulse' | 'shimmer';
}

export function Skeleton({
  className = '',
  variant = 'pulse',
  ...props
}: SkeletonProps) {
  const animationClass =
    variant === 'shimmer'
      ? 'animate-shimmer bg-zinc-900/80 border border-white/5'
      : 'animate-pulse bg-zinc-800/50';

  return (
    <div
      className={`rounded-2xl ${animationClass} ${className}`}
      {...props}
    />
  );
}

export default Skeleton;
