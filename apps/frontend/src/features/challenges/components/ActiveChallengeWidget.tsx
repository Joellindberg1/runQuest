import React from 'react';
import { TierBadge } from './TierBadge';
import { Swords } from 'lucide-react';
import type { Challenge } from '@/types/run';
import type { ProgressEntry } from './OngoingChallengeCard';

interface ActiveChallengeWidgetProps {
  challenge: Challenge;
  progress: ProgressEntry[];
  currentUserId: string;
  onClick?: () => void;
}

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value}`;
  return `${value} XP`;
}

function daysLeft(endDate: string): number {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000));
}

export const ActiveChallengeWidget: React.FC<ActiveChallengeWidgetProps> = ({
  challenge,
  progress,
  currentUserId,
  onClick,
}) => {
  const opponent = challenge.challenger_id === currentUserId
    ? { id: challenge.opponent_id,   name: challenge.opponent_name }
    : { id: challenge.challenger_id, name: challenge.challenger_name };

  const myProg  = progress.find(p => p.user_id === currentUserId);
  const oppProg = progress.find(p => p.user_id === opponent.id);

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-sidebar border-2 border-foreground/15 text-left leading-tight ${onClick ? 'hover:border-primary/40 transition-colors cursor-pointer' : ''}`}
    >
      {/* Row 1: icon + tier + "vs name" | days left */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-primary shrink-0" />
          <TierBadge tier={challenge.tier} size="sm" />
          <span className="text-xs text-muted-foreground">
            vs <span className="font-semibold text-foreground">{opponent.name}</span>
          </span>
        </div>
        {challenge.end_date && (
          <span className="text-xs text-muted-foreground shrink-0">
            {daysLeft(challenge.end_date)}d
          </span>
        )}
      </div>

      {/* Row 2: my score — their score */}
      {myProg && oppProg && (
        <div className="flex items-center gap-1 text-xs pl-5">
          <span className="font-bold text-primary">{formatValue(challenge.metric, myProg.value)}</span>
          <span className="text-muted-foreground">–</span>
          <span className="font-bold">{formatValue(challenge.metric, oppProg.value)}</span>
        </div>
      )}
    </Tag>
  );
};
