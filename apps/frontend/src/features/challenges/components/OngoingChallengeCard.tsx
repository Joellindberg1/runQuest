import React from 'react';
import { Card, CardContent } from '@/shared/components/ui/card';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import type { Challenge } from '@/types/run';

export interface ProgressEntry {
  user_id: string;
  name: string;
  value: number;
  goalValue?: number; // only for goal-based challenges
}

interface OngoingChallengeCardProps {
  challenge: Challenge;
  progress: ProgressEntry[];
  currentUserId: string;
  isOwn?: boolean; // highlight if current user is involved
}

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value} runs`;
  return `${value} XP`;
}

function daysLeft(endDate: string): number {
  return Math.max(0, Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000));
}

export const OngoingChallengeCard: React.FC<OngoingChallengeCardProps> = ({
  challenge,
  progress,
  currentUserId,
  isOwn = false,
}) => {
  // Sort by value descending so leader is [0]
  const sorted = [...progress].sort((a, b) => b.value - a.value);
  const isGoalBased = sorted.some(p => p.goalValue != null);
  const goalValue = sorted[0]?.goalValue;

  return (
    <Card className={`border-2 ${isOwn ? 'border-primary/50 bg-primary/5' : 'border-foreground/15 bg-sidebar'}`}>
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <TierBadge tier={challenge.tier} />
            <span className="text-sm font-semibold">
              <MetricLabel metric={challenge.metric} />
            </span>
            <span className="text-xs text-muted-foreground">· {challenge.duration_days}d</span>
          </div>
          {challenge.end_date && (
            <span className="text-xs text-muted-foreground shrink-0">
              {daysLeft(challenge.end_date)}d left
            </span>
          )}
        </div>

        {isGoalBased && goalValue != null ? (
          /* Goal-based: progress bars toward goal */
          <div className="space-y-2">
            {sorted.map(p => {
              const isMe = p.user_id === currentUserId;
              const pct = Math.min(100, Math.round((p.value / goalValue) * 100));
              return (
                <div key={p.user_id} className="space-y-0.5">
                  <div className="flex justify-between text-sm">
                    <span className={`font-medium ${isMe ? 'text-primary' : ''}`}>{p.name}</span>
                    <span className="font-semibold">{formatValue(challenge.metric, p.value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isMe ? 'bg-primary' : 'bg-foreground/30'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground text-right">{pct}% of goal</div>
                </div>
              );
            })}
          </div>
        ) : (
          /* VS-based: just show score side by side */
          <div className="flex items-center justify-between gap-2">
            {sorted.map((p, idx) => {
              const isMe = p.user_id === currentUserId;
              const isLeading = idx === 0;
              return (
                <React.Fragment key={p.user_id}>
                  {idx > 0 && (
                    <span className="text-xs text-muted-foreground font-medium shrink-0">—</span>
                  )}
                  <div className={`flex flex-col ${idx === 0 ? 'items-start' : 'items-end'} flex-1 min-w-0`}>
                    <span className={`text-xs truncate ${isMe ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                      {p.name}
                    </span>
                    <span className={`text-lg font-bold leading-tight ${isLeading ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {formatValue(challenge.metric, p.value)}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Reward hint */}
        <div className="text-xs text-muted-foreground border-t border-foreground/10 pt-2 flex gap-4">
          <span>Winner: <span className="text-green-600 dark:text-green-400 font-medium">+{challenge.winner_delta}x/{challenge.winner_duration}d</span></span>
          <span>Loser: <span className="text-red-500 dark:text-red-400 font-medium">{challenge.loser_delta}x/{challenge.loser_duration}d</span></span>
        </div>
      </CardContent>
    </Card>
  );
};
