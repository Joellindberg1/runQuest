import React, { useState } from 'react';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Challenge, ChallengeTier, ChallengeMetric } from '@runquest/types';

interface ChallengeHistoryProps {
  challenges: Challenge[];
  currentUserId: string;
}

type ScopeFilter = 'group' | 'me';

const ALL_TIERS:   ChallengeTier[]   = ['minor', 'major', 'legendary'];
const ALL_METRICS: ChallengeMetric[] = ['km', 'runs', 'total_xp'];

const METRIC_LABELS: Record<ChallengeMetric, string> = {
  km: 'KM', runs: 'Runs', total_xp: 'XP',
};

const TIER_LABELS: Record<ChallengeTier, string> = {
  minor: 'Minor', major: 'Major', legendary: 'Legendary',
};

function winnerName(c: Challenge): string {
  if (!c.winner_id) return '—';
  if (c.winner_id === c.challenger_id) return c.challenger_name;
  return c.opponent_name;
}

function formatVal(metric: string, value: number): string {
  if (metric === 'km') return `${value.toFixed(1)} km`;
  if (metric === 'runs') return `${value} runs`;
  return `${value} XP`;
}

const bebas = { fontFamily: 'Bebas Neue, sans-serif' };
const barlow = { fontFamily: 'Barlow Condensed, sans-serif' };

const TIER_COLOR: Record<string, string> = {
  minor: '#3b82f6', major: '#f97316', legendary: 'var(--rq-gold)',
};

const HistoryItem: React.FC<{ challenge: Challenge }> = ({ challenge }) => {
  const [open, setOpen] = useState(false);

  const isDrawn    = challenge.outcome === 'draw';
  const isDeclined = challenge.outcome === 'declined';
  const tierColor  = TIER_COLOR[challenge.tier] ?? 'var(--rq-gold)';

  return (
    <div style={{ background: 'var(--rq-surface-1)', border: '1px solid var(--rq-border-1)', borderLeft: `2px solid color-mix(in srgb, ${tierColor} 40%, transparent)` }}>
      <button
        className="w-full p-3 hover:bg-[var(--rq-surface-2)] transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2.5">
          <TierBadge tier={challenge.tier} size="sm" />

          <div className="flex-1 min-w-0">
            <div
              className="truncate"
              style={{ ...barlow, fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--rq-text-strong)' }}
            >
              {challenge.challenger_name} vs {challenge.opponent_name}
            </div>
            {challenge.challenger_final_value != null && challenge.opponent_final_value != null && (
              <div style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {formatVal(challenge.metric, challenge.challenger_final_value)}
                {' — '}
                {formatVal(challenge.metric, challenge.opponent_final_value)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isDeclined || isDrawn ? (
              <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                {isDrawn ? 'Draw' : 'Declined'}
              </span>
            ) : (
              <span style={{ ...barlow, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--rq-text-muted)', fontWeight: 600 }}>
                {winnerName(challenge)}
              </span>
            )}
            <div style={{ color: 'var(--rq-text-dim)' }}>
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--rq-border-1)' }}>
          <div className="pt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <div style={{ ...barlow, fontSize: '0.75rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Metric <span style={{ color: 'var(--rq-text-soft)', fontWeight: 700 }}><MetricLabel metric={challenge.metric} /></span>
            </div>
            <div style={{ ...barlow, fontSize: '0.75rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Duration <span style={{ color: 'var(--rq-text-soft)', fontWeight: 700 }}>{challenge.duration_days}d</span>
            </div>
            {challenge.end_date && (
              <div style={{ ...barlow, fontSize: '0.75rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Ended <span style={{ color: 'var(--rq-text-soft)', fontWeight: 700 }}>{challenge.end_date}</span>
              </div>
            )}
            <div className="col-span-2 pt-1 flex gap-4">
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
        </div>
      )}
    </div>
  );
};

function toggle<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val); else next.add(val);
  return next;
}

export const ChallengeHistory: React.FC<ChallengeHistoryProps> = ({ challenges, currentUserId }) => {
  const [selTiers,   setSelTiers]   = useState<Set<ChallengeTier>>(new Set());
  const [selMetrics, setSelMetrics] = useState<Set<ChallengeMetric>>(new Set());
  const [scope,      setScope]      = useState<ScopeFilter>('group');

  const filtered = challenges.filter(c => {
    if (selTiers.size > 0   && !selTiers.has(c.tier))     return false;
    if (selMetrics.size > 0 && !selMetrics.has(c.metric)) return false;
    if (scope === 'me' && c.challenger_id !== currentUserId && c.opponent_id !== currentUserId) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-3 overflow-x-hidden">
      {/* Filters */}
      <div className="space-y-2">
        {/* Tier multi-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Tier:</span>
          {ALL_TIERS.map(t => (
            <button
              key={t}
              onClick={() => setSelTiers(prev => toggle(prev, t))}
              style={{
                ...barlow,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '3px 10px',
                border: selTiers.has(t) ? '1px solid var(--rq-gold)' : '1px solid var(--rq-border-2)',
                background: selTiers.has(t) ? 'var(--rq-gold-mid)' : 'transparent',
                color: selTiers.has(t) ? 'var(--rq-gold)' : 'var(--rq-text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
          {selTiers.size > 0 && (
            <button
              onClick={() => setSelTiers(new Set())}
              style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textDecoration: 'underline', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Metric multi-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Metric:</span>
          {ALL_METRICS.map(m => (
            <button
              key={m}
              onClick={() => setSelMetrics(prev => toggle(prev, m))}
              style={{
                ...barlow,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '3px 10px',
                border: selMetrics.has(m) ? '1px solid var(--rq-gold)' : '1px solid var(--rq-border-2)',
                background: selMetrics.has(m) ? 'var(--rq-gold-mid)' : 'transparent',
                color: selMetrics.has(m) ? 'var(--rq-gold)' : 'var(--rq-text-muted)',
                transition: 'all 0.15s',
              }}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
          {selMetrics.size > 0 && (
            <button
              onClick={() => setSelMetrics(new Set())}
              style={{ ...barlow, fontSize: '0.72rem', color: 'var(--rq-text-dim)', textDecoration: 'underline', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Scope toggle */}
        <div className="flex overflow-hidden w-fit" style={{ border: '1px solid var(--rq-border-2)' }}>
          {(['group', 'me'] as ScopeFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                ...barlow,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '4px 14px',
                background: scope === s ? 'var(--rq-gold-mid)' : 'transparent',
                color: scope === s ? 'var(--rq-gold)' : 'var(--rq-text-dim)',
                borderRight: s === 'group' ? '1px solid var(--rq-border-1)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {s === 'group' ? 'All' : 'Just me'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">
          No challenges match the current filters
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(c => <HistoryItem key={c.id} challenge={c} />)}
        </div>
      )}
    </div>
  );
};
