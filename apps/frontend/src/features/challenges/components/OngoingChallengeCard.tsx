import React from 'react';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import { Clock } from 'lucide-react';
import { useUserProfileModal } from '@/providers/UserProfileModalProvider';
import type { Challenge } from '@runquest/types';

export interface ProgressEntry {
  user_id: string;
  name: string;
  value: number;
  goalValue?: number;
}

interface OngoingChallengeCardProps {
  challenge: Challenge;
  progress: ProgressEntry[];
  currentUserId: string;
  isOwn?: boolean;
}

const bebas = { fontFamily: 'Bebas Neue, sans-serif' };
const barlow = { fontFamily: 'Barlow Condensed, sans-serif' };

const TIER_COLOR: Record<string, string> = {
  minor: '#3b82f6',
  major: '#f97316',
  legendary: 'var(--rq-gold)',
};

function formatValue(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)}`;
  if (metric === 'runs') return `${value}`;
  return `${value}`;
}

function formatUnit(metric: string): string {
  if (metric === 'km') return 'km';
  if (metric === 'runs') return 'runs';
  return 'xp';
}

function formatEndDate(endDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate + 'T00:00:00');
  const diff = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'ends today';
  if (diff === 1) return 'ends tomorrow';
  if (diff < 0) return 'ended';
  return `${diff}d left`;
}

function isPendingStart(startDate?: string): boolean {
  if (!startDate) return false;
  return new Date(startDate + 'T00:00:00') > new Date();
}

function hoursUntilStart(startDate: string): number {
  return Math.max(0, Math.ceil((new Date(startDate + 'T00:00:00').getTime() - Date.now()) / 3_600_000));
}

export const OngoingChallengeCard: React.FC<OngoingChallengeCardProps> = ({
  challenge,
  progress,
  currentUserId,
  isOwn = false,
}) => {
  const { openProfile } = useUserProfileModal();
  const sorted = [...progress].sort((a, b) => b.value - a.value);
  const isGoalBased = sorted.some(p => p.goalValue != null);
  const goalValue = sorted[0]?.goalValue;
  const pending = isPendingStart(challenge.start_date);
  const hours = pending && challenge.start_date ? hoursUntilStart(challenge.start_date) : 0;
  const tierColor = TIER_COLOR[challenge.tier] ?? 'var(--rq-gold)';

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: 'var(--rq-surface-1)',
        border: `1px solid var(--rq-border-2)`,
        borderLeft: isOwn ? `3px solid ${tierColor}` : `1px solid var(--rq-border-2)`,
        opacity: pending ? 0.5 : 1,
      }}
    >
      {/* Tier accent line */}
      <div style={{ height: '2px', background: `linear-gradient(to right, color-mix(in srgb, ${tierColor} 60%, transparent), transparent)` }} />

      <div className="px-3 pt-2.5 pb-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <TierBadge tier={challenge.tier} size="sm" />
            <span
              className="uppercase tracking-wide"
              style={{ ...barlow, fontSize: '0.85rem', fontWeight: 600, color: 'var(--rq-text-strong)' }}
            >
              <MetricLabel metric={challenge.metric} />
            </span>
            <span style={{ ...barlow, fontSize: '0.75rem', color: 'var(--rq-text-dim)' }}>
              · {challenge.duration_days}d
            </span>
          </div>
          {challenge.end_date && !pending && (
            <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {formatEndDate(challenge.end_date)}
            </span>
          )}
        </div>

        {/* VS blocks */}
        {isGoalBased && goalValue != null ? (
          <div className="space-y-2">
            {sorted.map(p => {
              const isMe = p.user_id === currentUserId;
              const pct = Math.min(100, Math.round((p.value / goalValue) * 100));
              return (
                <div key={p.user_id}>
                  <div className="flex justify-between items-baseline mb-0.5">
                    <span
                      onClick={() => openProfile(p.user_id)}
                      className="cursor-pointer hover:underline"
                      style={{ ...barlow, fontSize: '0.8rem', fontWeight: isMe ? 700 : 500, color: isMe ? 'var(--rq-gold)' : 'var(--rq-text-soft)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    >
                      {p.name}
                    </span>
                    <span style={{ ...bebas, fontSize: '1rem', color: isMe ? 'var(--rq-gold)' : 'var(--rq-text-soft)' }}>
                      {formatValue(challenge.metric, p.value)} <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{formatUnit(challenge.metric)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden" style={{ background: 'var(--rq-border-1)' }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: isMe ? tierColor : 'var(--rq-text-dim)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {/* Left player */}
            {sorted[0] && (
              <div className="space-y-0" style={{ background: 'var(--rq-surface-2)', border: '1px solid var(--rq-border-1)', padding: '6px 8px' }}>
                <div
                  onClick={() => openProfile(sorted[0].user_id)}
                  className="truncate cursor-pointer hover:underline"
                  style={{ ...barlow, fontSize: '0.7rem', color: 'var(--rq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
                >
                  {sorted[0].name}
                </div>
                <div className="flex items-baseline gap-1">
                  <span style={{ ...bebas, fontSize: '1.6rem', lineHeight: 1, color: sorted[0].user_id === currentUserId ? 'var(--rq-gold)' : 'var(--rq-text-strong)' }}>
                    {formatValue(challenge.metric, sorted[0].value)}
                  </span>
                  <span style={{ ...barlow, fontSize: '0.65rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase' }}>
                    {formatUnit(challenge.metric)}
                  </span>
                </div>
              </div>
            )}

            {/* VS */}
            <span style={{ ...bebas, fontSize: '0.9rem', color: 'var(--rq-text-dim)', letterSpacing: '0.05em' }}>VS</span>

            {/* Right player */}
            {sorted[1] && (
              <div className="space-y-0 text-right" style={{ background: 'var(--rq-surface-2)', border: '1px solid var(--rq-border-1)', padding: '6px 8px' }}>
                <div
                  onClick={() => openProfile(sorted[1].user_id)}
                  className="truncate cursor-pointer hover:underline"
                  style={{ ...barlow, fontSize: '0.7rem', color: 'var(--rq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}
                >
                  {sorted[1].name}
                </div>
                <div className="flex items-baseline gap-1 justify-end">
                  <span style={{ ...bebas, fontSize: '1.6rem', lineHeight: 1, color: sorted[1].user_id === currentUserId ? 'var(--rq-gold)' : 'var(--rq-text-muted)' }}>
                    {formatValue(challenge.metric, sorted[1].value)}
                  </span>
                  <span style={{ ...barlow, fontSize: '0.65rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase' }}>
                    {formatUnit(challenge.metric)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stakes footer */}
        <div
          className="flex gap-4 pt-2"
          style={{ borderTop: '1px solid var(--rq-border-1)' }}
        >
          <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Win <span style={{ color: 'var(--rq-success)', fontWeight: 700 }}>+{challenge.winner_delta}x/{challenge.winner_duration}d</span>
          </span>
          {challenge.tier !== 'legendary' && (
            <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Lose <span style={{ color: 'var(--rq-danger)', fontWeight: 700 }}>{challenge.loser_delta}x/{challenge.loser_duration}d</span>
            </span>
          )}
        </div>
      </div>

      {/* Pending overlay */}
      {pending && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <Clock className="w-4 h-4" style={{ color: 'var(--rq-text-muted)' }} />
          <span style={{ ...bebas, fontSize: '1.1rem', letterSpacing: '0.05em', color: 'var(--rq-text-strong)' }}>
            Starts in {hours}h
          </span>
        </div>
      )}
    </div>
  );
};
