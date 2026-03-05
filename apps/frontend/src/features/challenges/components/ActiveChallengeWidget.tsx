import React from 'react';
import { TierBadge } from './TierBadge';
import { Swords, Clock } from 'lucide-react';
import type { Challenge } from '@/types/run';
import type { ProgressEntry } from './OngoingChallengeCard';

interface ActiveChallengeWidgetProps {
  challenge: Challenge;
  progress: ProgressEntry[];
  currentUserId: string;
  onClick?: () => void;
}

const OSWALD = "'Oswald', 'Arial Narrow', Arial, sans-serif";

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value}`;
  return `${value} XP`;
}

function daysLeft(endDate: string): number {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000));
}

function isPendingStart(startDate?: string): boolean {
  if (!startDate) return false;
  return new Date(startDate + 'T00:00:00') > new Date();
}

function hoursUntilStart(startDate: string): number {
  return Math.max(0, Math.ceil((new Date(startDate + 'T00:00:00').getTime() - Date.now()) / 3_600_000));
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
  const pending = isPendingStart(challenge.start_date);
  const hours = pending && challenge.start_date ? hoursUntilStart(challenge.start_date) : 0;

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={`relative flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-sidebar border-2 border-foreground/15 text-left leading-tight overflow-hidden ${onClick ? 'hover:border-primary/40 transition-colors cursor-pointer' : ''}`}
    >
      {/* Content — dimmed when pending */}
      <div className={pending ? 'opacity-40' : ''}>
        {/* Row 1: icon + tier + "vs name" | days left */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Swords className="w-3.5 h-3.5 text-primary shrink-0" />
            <TierBadge tier={challenge.tier} size="sm" />
            <span className="text-xs text-muted-foreground">
              vs <span className="font-semibold text-foreground">{opponent.name}</span>
            </span>
          </div>
          {challenge.end_date && !pending && (
            <span className="text-xs text-muted-foreground shrink-0">
              {daysLeft(challenge.end_date)}d
            </span>
          )}
        </div>

        {/* Row 2: score (only when not pending) */}
        {!pending && myProg && oppProg && (
          <div className="flex items-center gap-1 text-xs pl-5">
            <span className="font-bold text-primary">{formatValue(challenge.metric, myProg.value)}</span>
            <span className="text-muted-foreground">–</span>
            <span className="font-bold">{formatValue(challenge.metric, oppProg.value)}</span>
          </div>
        )}
      </div>

      {/* Pending overlay */}
      {pending && (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 pointer-events-none">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span style={{ fontFamily: OSWALD }} className="text-sm font-medium tracking-wide text-foreground">
            Starts in {hours}h
          </span>
        </div>
      )}
    </Tag>
  );
};
