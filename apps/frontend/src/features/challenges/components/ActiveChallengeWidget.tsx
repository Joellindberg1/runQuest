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

const OSWALD = "'Bebas Neue', sans-serif";

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value}`;
  return `${value} XP`;
}

function formatEndDate(endDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate + 'T00:00:00');
  const diff = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return endDate;
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
      className={`relative w-full px-3 py-2 rounded-lg bg-sidebar border-2 border-foreground/15 text-left overflow-hidden ${onClick ? 'hover:border-primary/40 transition-colors cursor-pointer' : ''}`}
    >
      {/* 3-col grid — dimmed when pending */}
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
        {/* Desktop: "Ends:" + date stacked in col 3 */}
        <div className="flex items-center justify-end">
          {challenge.end_date && !pending && (
            <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground leading-tight whitespace-nowrap">
              <span>Ends:</span>
              <span>{formatEndDate(challenge.end_date)}</span>
            </div>
          )}
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

        {/* Row 3: mobile only — end date spanning full width */}
        {challenge.end_date && !pending && (
          <div className="col-span-3 flex sm:hidden justify-center text-xs text-muted-foreground pt-1 border-t border-foreground/10 mt-0.5">
            Ends: {formatEndDate(challenge.end_date)}
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
