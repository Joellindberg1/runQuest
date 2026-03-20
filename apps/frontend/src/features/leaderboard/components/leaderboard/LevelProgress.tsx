
import React from 'react';
import { formatXPForDisplay } from '@/shared/utils/formatters';

interface LevelProgressProps {
  xpProgress: number;
  xpLeftForNextLevel: number;
  xpInLevel?: number;
  xpLevelRange?: number;
}

export const LevelProgress: React.FC<LevelProgressProps> = ({
  xpProgress,
  xpLeftForNextLevel,
  xpInLevel,
  xpLevelRange,
}) => {
  const segments = 18;
  const filledSegments = Math.round((xpProgress / 100) * segments);
  const isMax = xpLeftForNextLevel === 0;

  return (
    <div className="space-y-1 mt-2">
      <div className="flex justify-between items-center">
        <span className="text-[9px] tracking-widest uppercase opacity-60" style={{ fontFamily: 'Silkscreen, monospace' }}>
          Level
        </span>
        <span className="text-[9px] opacity-55" style={{ fontFamily: 'Share Tech Mono, monospace' }}>
          {isMax
            ? 'max'
            : xpInLevel != null && xpLevelRange != null
              ? `${formatXPForDisplay(xpInLevel)} / ${formatXPForDisplay(xpLevelRange)} xp`
              : `${formatXPForDisplay(xpLeftForNextLevel)} xp`}
        </span>
      </div>
      <div className="flex gap-[2px]">
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            className="h-2 flex-1"
            style={{
              background: i < filledSegments ? 'var(--rq-gold)' : 'var(--rq-border-1)',
              boxShadow: i < filledSegments && i === filledSegments - 1 ? '0 0 5px color-mix(in srgb, var(--rq-gold) 60%, transparent)' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
};
