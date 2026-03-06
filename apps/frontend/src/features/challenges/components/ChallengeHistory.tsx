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

const HistoryItem: React.FC<{ challenge: Challenge }> = ({ challenge }) => {
  const [open, setOpen] = useState(false);

  const isDrawn    = challenge.outcome === 'draw';
  const isDeclined = challenge.outcome === 'declined';

  const outcomeLabel = isDrawn    ? 'Draw'
                     : isDeclined ? 'Declined'
                     : `Winner: ${winnerName(challenge)}`;

  const outlineCls = isDrawn || isDeclined
    ? 'text-muted-foreground'
    : 'text-foreground font-semibold';

  return (
    <div className="bg-background border border-foreground/15 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-start justify-between p-3 hover:bg-accent transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <TierBadge tier={challenge.tier} size="sm" />
            <span className="text-sm font-semibold truncate">
              {challenge.challenger_name} vs {challenge.opponent_name}
            </span>
          </div>
          <span className={`text-xs pl-0.5 ${outlineCls}`}>{outcomeLabel}</span>
        </div>
        <div className="shrink-0 ml-2 mt-0.5">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-foreground/10">
          {/* Final score */}
          {(challenge.challenger_final_value != null && challenge.opponent_final_value != null) && (
            <div className="mt-2 mb-2 rounded-lg bg-background border border-foreground/10 px-3 py-2 flex items-center justify-between text-sm">
              <div className={`font-bold min-w-0 ${challenge.winner_id === challenge.challenger_id ? 'text-green-600 dark:text-green-400' : ''}`}>
                <div className="truncate">{challenge.challenger_name}</div>
                <div className="text-base">{formatVal(challenge.metric, challenge.challenger_final_value)}</div>
              </div>
              <div className="text-xs text-muted-foreground font-medium px-2 shrink-0">
                {challenge.outcome === 'draw' ? 'Draw' : 'vs'}
              </div>
              <div className={`font-bold text-right min-w-0 ${challenge.winner_id === challenge.opponent_id ? 'text-green-600 dark:text-green-400' : ''}`}>
                <div className="truncate">{challenge.opponent_name}</div>
                <div className="text-base">{formatVal(challenge.metric, challenge.opponent_final_value)}</div>
              </div>
            </div>
          )}

          <div className="pt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>Metric: <span className="font-medium text-foreground"><MetricLabel metric={challenge.metric} /></span></div>
            <div>Duration: <span className="font-medium text-foreground">{challenge.duration_days} days</span></div>
            {challenge.end_date && (
              <div>Ended: <span className="font-medium text-foreground">{challenge.end_date}</span></div>
            )}
            <div className="col-span-2 pt-1 flex gap-4">
              <span>Winner boost: <span className="text-green-600 dark:text-green-400 font-medium">+{challenge.winner_delta}x/{challenge.winner_duration}d</span></span>
              <span>Loser penalty: <span className="text-red-500 dark:text-red-400 font-medium">{challenge.loser_delta}x/{challenge.loser_duration}d</span></span>
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
          <span className="text-xs text-muted-foreground font-medium mr-1">Tier:</span>
          {ALL_TIERS.map(t => (
            <button
              key={t}
              onClick={() => setSelTiers(prev => toggle(prev, t))}
              className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                selTiers.has(t)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-foreground/20 hover:border-foreground/40 text-muted-foreground'
              }`}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
          {selTiers.size > 0 && (
            <button
              onClick={() => setSelTiers(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>

        {/* Metric multi-select */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted-foreground font-medium mr-1">Metric:</span>
          {ALL_METRICS.map(m => (
            <button
              key={m}
              onClick={() => setSelMetrics(prev => toggle(prev, m))}
              className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                selMetrics.has(m)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-foreground/20 hover:border-foreground/40 text-muted-foreground'
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
          {selMetrics.size > 0 && (
            <button
              onClick={() => setSelMetrics(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>

        {/* Scope toggle */}
        <div className="flex rounded-md border border-foreground/20 overflow-hidden w-fit text-xs">
          {(['group', 'me'] as ScopeFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                scope === s ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
              }`}
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
