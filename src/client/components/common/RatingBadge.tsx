import React from 'react';
import { Star } from 'lucide-react';

interface RatingBadgeProps {
  rating: string | number | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function RatingBadge({ rating, size = 'sm', className = '' }: RatingBadgeProps) {
  if (!rating) return null;

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1',
    lg: 'text-sm px-3 py-1.5 gap-1.5',
  };

  const starSizes = {
    sm: 'w-2.5 h-2.5',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4',
  };

  return (
    <span
      className={`inline-flex items-center rounded-xl font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 ${sizeClasses[size]} ${className}`}
    >
      <Star className={`${starSizes[size]} fill-amber-400 text-amber-400`} />
      <span>{rating}</span>
    </span>
  );
}
