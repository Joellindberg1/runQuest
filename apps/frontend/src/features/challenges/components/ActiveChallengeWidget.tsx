import React from 'react';
import { TierBadge } from './TierBadge';
import { Swords, Clock } from 'lucide-react';
import type { Challenge } from '@runquest/types';
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
      className={`relative px-3 py-2 rounded-lg bg-sidebar border-2 border-foreground/15 text-left overflow-hidden ${onClick ? 'hover:border-primary/40 transition-colors cursor-pointer' : ''}`}
    >
      {/* 3-col grid, 2 rows — dimmed when pending */}
      <div className={`grid grid-cols-[auto_1fr_auto] gap-x-2 ${pending ? 'opacity-40' : ''}`}>
        {/* Row 1 */}
        <div className="flex items-center justify-center">
          <Swords className="w-4 h-4 text-primary" />
        </div>
        <div className="flex items-center justify-center gap-1.5 text-xs">
          <span className="font-semibold text-foreground">You</span>
          <span className="text-muted-foreground">vs</span>
          <span className="font-semibold text-foreground">{opponent.name}</span>
        </div>
        <div className="flex items-center justify-center">
          {challenge.end_date && !pending ? (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {daysLeft(challenge.end_date)}d
            </span>
          ) : <span />}
        </div>

        {/* Row 2 */}
        <div className="flex items-center justify-center">
          <TierBadge tier={challenge.tier} size="sm" />
        </div>
        <div className="flex items-center justify-center gap-1.5 text-xs">
          {myProg && oppProg ? (
            <>
              <span className="font-bold text-primary">{formatValue(challenge.metric, myProg.value)}</span>
              <span className="text-muted-foreground">–</span>
              <span className="font-bold text-foreground">{formatValue(challenge.metric, oppProg.value)}</span>
            </>
          ) : <span />}
        </div>
        <div />
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
