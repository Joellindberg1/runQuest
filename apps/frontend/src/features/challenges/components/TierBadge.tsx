import React from 'react';
import type { ChallengeTier } from '@/types/run';

interface TierBadgeProps {
  tier: ChallengeTier;
  size?: 'sm' | 'md';
}

const TIER_CONFIG: Record<ChallengeTier, { label: string; className: string; emoji: string }> = {
  minor:     { label: 'Minor',     emoji: '⚔️',  className: 'bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400' },
  major:     { label: 'Major',     emoji: '🔥',  className: 'bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400' },
  legendary: { label: 'Legendary', emoji: '👑',  className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30 dark:text-yellow-500' },
};

export const TierBadge: React.FC<TierBadgeProps> = ({ tier, size = 'md' }) => {
  const { label, emoji, className } = TIER_CONFIG[tier];
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-semibold ${sizeClass} ${className}`}>
      {emoji} {label}
    </span>
  );
};
