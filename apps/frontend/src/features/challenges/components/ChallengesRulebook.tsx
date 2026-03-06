import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { Card, CardContent } from '@/shared/components/ui/card';
import { TierBadge } from './TierBadge';
import type { ChallengeTier } from '@runquest/types';

// ─── Static rulebook data ──────────────────────────────────────────────────────

const METRICS = [
  { id: 'km',       label: 'Total KM',      description: 'Who runs the most total distance during the challenge period.' },
  { id: 'runs',     label: 'Total Runs',    description: 'Who logs the most individual runs during the challenge period.' },
  { id: 'total_xp', label: 'Total XP',      description: 'Who earns the most XP during the challenge period.' },
];

interface DurationRow { days: number; tiers: ChallengeTier[] }
const DURATIONS: DurationRow[] = [
  { days: 5,  tiers: ['minor'] },
  { days: 7,  tiers: ['minor', 'major'] },
  { days: 10, tiers: ['major'] },
  { days: 14, tiers: ['major', 'legendary'] },
  { days: 21, tiers: ['legendary'] },
  { days: 30, tiers: ['legendary'] },
];

const REWARDS = [
  {
    tier: 'minor' as ChallengeTier,
    winner: '+0.15x multiplier for 5 days',
    loser:  '−0.07x multiplier for 5 days',
  },
  {
    tier: 'major' as ChallengeTier,
    winner: '+0.25x multiplier for 10 days',
    loser:  '−0.12x multiplier for 10 days',
  },
  {
    tier: 'legendary' as ChallengeTier,
    winner: '+0.50x multiplier for 14 days',
    loser:  '−0.25x multiplier for 14 days',
  },
];

const SUB_TABS = [
  { value: 'metrics',   label: 'Metrics' },
  { value: 'durations', label: 'Durations' },
  { value: 'rewards',   label: 'Rewards' },
];

export const ChallengesRulebook: React.FC = () => {
  const [sub, setSub] = useState('metrics');

  return (
    <div className="space-y-3">
      {/* Sub-tab switcher */}
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="grid grid-cols-3 bg-sidebar border border-foreground/15 h-9">
          {SUB_TABS.map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="text-xs font-semibold rounded-none h-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Metrics ─────────────────────────────────────── */}
        <TabsContent value="metrics" className="mt-3 space-y-2">
          {METRICS.map(m => (
            <Card key={m.id} className="bg-sidebar border border-foreground/15">
              <CardContent className="pt-3 pb-3">
                <div className="font-semibold text-sm mb-0.5">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.description}</div>
              </CardContent>
            </Card>
          ))}
          <Card className="bg-muted/30 border border-foreground/10">
            <CardContent className="pt-3 pb-3">
              <div className="text-xs text-muted-foreground">
                More metrics coming in future updates (Elevation Gain, Moving Time, etc.)
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Durations ───────────────────────────────────── */}
        <TabsContent value="durations" className="mt-3 space-y-2">
          <Card className="bg-sidebar border border-foreground/15">
            <CardContent className="p-0">
              <div className="grid grid-cols-[4rem_1fr] gap-x-4 px-4 py-2 text-xs font-semibold text-muted-foreground uppercase border-b border-foreground/10">
                <span>Days</span>
                <span>Available for</span>
              </div>
              {DURATIONS.map(row => (
                <div key={row.days} className="grid grid-cols-[4rem_1fr] gap-x-4 px-4 py-2.5 border-b border-foreground/5 last:border-0 items-center">
                  <span className="text-sm font-semibold">{row.days}d</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {row.tiers.map(t => <TierBadge key={t} tier={t} size="sm" />)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="text-xs text-muted-foreground px-1">
            Challenge duration is randomly assigned from the eligible durations for your token's tier.
          </div>
        </TabsContent>

        {/* ── Rewards ─────────────────────────────────────── */}
        <TabsContent value="rewards" className="mt-3 space-y-3">
          {REWARDS.map(r => (
            <Card key={r.tier} className="bg-sidebar border border-foreground/15">
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <TierBadge tier={r.tier} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Winner</div>
                    <div className="font-medium text-green-600 dark:text-green-400">{r.winner}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">Loser</div>
                    <div className="font-medium text-red-500 dark:text-red-400">{r.loser}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className="bg-muted/30 border border-foreground/10">
            <CardContent className="pt-3 pb-3 space-y-1.5 text-xs text-muted-foreground">
              <p><span className="font-semibold text-foreground">How boosts work:</span> The XP multiplier boost is added on top of your streak multiplier.</p>
              <p>Effective multiplier = streak multiplier + boost delta, capped between <span className="font-semibold text-foreground">0.75×</span> and <span className="font-semibold text-foreground">3.5×</span>.</p>
              <p>A draw results in no reward or penalty for either player.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
