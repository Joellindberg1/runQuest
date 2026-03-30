import React, { useState } from 'react';
import { Badge } from '@/shared/components/ui/badge';
import { TabsContent } from '@/shared/components/ui/tabs';
import { PageTabs } from '@/shared/components/PageTabs';
import {
  Zap, Trophy, Flame, Swords, Activity, CalendarDays,
  ChevronRight, Star, Clock, Mountain, Moon, Sun, Coffee,
  Calendar, TrendingUp, Repeat, Timer, BarChart3, CloudLightning,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useGroupName } from '@/shared/hooks/useGroupName';
import { cn } from '@/lib/utils';
import { STREAK_MULTIPLIERS } from '@/constants/streakConstants';

// ─── Types ───────────────────────────────────────────────────────────────────

// ─── Data ────────────────────────────────────────────────────────────────────

const TABS = [
  { value: 'xp',         label: 'XP & Running',  icon: <Zap className="w-4 h-4" /> },
  { value: 'levels',     label: 'Levels',         icon: <TrendingUp className="w-4 h-4" /> },
  { value: 'streak',     label: 'Streak',         icon: <Flame className="w-4 h-4" /> },
  { value: 'titles',     label: 'Titles',         icon: <Trophy className="w-4 h-4" /> },
  { value: 'challenges', label: 'Challenges',     icon: <Swords className="w-4 h-4" /> },
  { value: 'events',     label: 'Events',         icon: <CalendarDays className="w-4 h-4" /> },
  { value: 'strava',     label: 'Strava',         icon: <Activity className="w-4 h-4" /> },
];

// NOTE: These XP values must be kept in sync with the `level_requirements`
// table in the database. The full table is available via frontendLevelService
// (levelService.ts) which derives them from Supabase or the fallback array.
const LEVEL_TABLE = [
  { level: 2,  xp: 50 },
  { level: 3,  xp: 102 },
  { level: 4,  xp: 158 },
  { level: 5,  xp: 217 },
  { level: 10, xp: 594 },
  { level: 12, xp: 806 },
  { level: 14, xp: 1079 },
  { level: 15, xp: 1244 },
  { level: 18, xp: 1920 },
  { level: 20, xp: 2591 },
  { level: 23, xp: 4181 },
  { level: 25, xp: 5902 },
  { level: 30, xp: 16071 },
];

// STREAK_MULTIPLIERS imported from @/constants/streakConstants
// — single source of truth shared with UserProfile stats display.

const TITLES = [
  { name: 'The Ultra Man',             icon: <BarChart3 className="w-4 h-4" />,  description: 'Most total kilometers', unlock: 'Min 100 km total' },
  { name: 'The Reborn Eliud Kipchoge', icon: <TrendingUp className="w-4 h-4" />, description: 'Longest single run', unlock: 'Min 12 km in one session' },
  { name: 'The Daaaaaviiiiiid GOGGINGS', icon: <Flame className="w-4 h-4" />,   description: 'Longest running streak', unlock: 'Min 20 consecutive days' },
  { name: 'The Park Runner',           icon: <Timer className="w-4 h-4" />,      description: 'Fastest 5 km', unlock: 'Run 5 km under 32:30' },
  { name: 'The Half Marathoner',       icon: <ChevronRight className="w-4 h-4" />, description: 'Fastest half marathon', unlock: 'Run 21.1 km in one session' },
  { name: 'The Marathoner',            icon: <Star className="w-4 h-4" />,       description: 'Fastest marathon', unlock: 'Run 42.2 km in one session' },
  { name: 'The Monthly Monster',       icon: <Calendar className="w-4 h-4" />,   description: 'Most km in the last calendar month', unlock: 'Min 20 km in a month' },
  { name: 'The Weekend Destroyer',     icon: <Calendar className="w-4 h-4" />,   description: 'Best weekend average (Sat + Sun)', unlock: 'Min 9 km avg per weekend day' },
  { name: 'The Consistent King/Queen', icon: <BarChart3 className="w-4 h-4" />,  description: 'Lowest pace variation — most consistent runner', unlock: 'Min 5 sessions of 5 km' },
  { name: 'The Mountain Goat',         icon: <Mountain className="w-4 h-4" />,   description: 'Most total elevation gain', unlock: 'Min 1,000 m elevation total' },
  { name: 'The Vertical Runner',       icon: <Mountain className="w-4 h-4" />,   description: 'Most elevation in a single session', unlock: 'Min 400 m elevation in one session' },
  { name: 'The Batman',                icon: <Moon className="w-4 h-4" />,       description: 'Most night runs (21:30–00:00)', unlock: 'First to reach 7 night sessions' },
  { name: 'The Rooster',               icon: <Sun className="w-4 h-4" />,        description: 'Most early morning sessions (04:00–06:00)', unlock: 'First to reach 7 morning sessions' },
  { name: 'The Lunch Breaker',         icon: <Coffee className="w-4 h-4" />,     description: 'Most lunch sessions (11:00–13:00)', unlock: 'First to reach 7 lunch sessions' },
  { name: 'The Commuter',              icon: <Repeat className="w-4 h-4" />,     description: 'Longest weekday streak (Mon–Fri)', unlock: 'Min 10 consecutive weekdays' },
  { name: 'The Hamster',               icon: <Repeat className="w-4 h-4" />,     description: 'Most sessions in a single calendar week', unlock: 'Min 5 sessions in one week' },
  { name: 'The Double Trouble',        icon: <Zap className="w-4 h-4" />,        description: 'Best combined km on a day with 2 sessions (min 4h apart)', unlock: 'Min 10 km combined' },
  { name: 'The Finisher',              icon: <Calendar className="w-4 h-4" />,   description: 'Last to run on a Sunday', unlock: 'Any Sunday session' },
  { name: 'The Phoenix',               icon: <Flame className="w-4 h-4" />,      description: 'Longest run after a 14-day break', unlock: 'Min 7 km after 14d pause' },
  { name: 'The Ghost',                 icon: <Clock className="w-4 h-4" />,      description: 'Longest run after a 30-day break', unlock: 'Min 5 km after 30d pause' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--rq-gold)' }}>{children}</h3>
);

const ExampleBox: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-background border border-foreground/20 rounded-lg p-4">
    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">{title}</p>
    {children}
  </div>
);

const FormulaRow: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div className={cn('flex justify-between items-center py-1.5 px-2 rounded text-sm', highlight && 'bg-foreground/5')}>
    <span className="text-muted-foreground">{label}</span>
    <span className={cn('font-mono font-medium', highlight && 'text-foreground')}>{value}</span>
  </div>
);

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const XPTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>How is XP calculated?</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        Every run earns XP based on three things: a fixed base amount, XP per kilometer, and a distance bonus if you run far enough. If you also have an active streak, part of your XP gets multiplied.
      </p>
      {/* NOTE: These XP values (base, km rate, distance bonuses) must be kept in
           sync with the `admin_settings` table in the database. They are
           admin-configurable via AdminSettings in @runquest/shared/xpCalculation. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ExampleBox title="Base amount">
          <p className="text-2xl font-bold">15 XP</p>
          <p className="text-xs text-muted-foreground mt-1">Per valid run (min 1 km)</p>
        </ExampleBox>
        <ExampleBox title="XP per kilometer">
          <p className="text-2xl font-bold">2 XP/km</p>
          <p className="text-xs text-muted-foreground mt-1">Multiplied by total distance</p>
        </ExampleBox>
        <ExampleBox title="Distance bonus">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">≥ 5 km</span><span className="font-medium">+5 XP</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">≥ 10 km</span><span className="font-medium">+15 XP</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">≥ 15 km</span><span className="font-medium">+25 XP</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">≥ 20 km</span><span className="font-medium">+50 XP</span></div>
          </div>
        </ExampleBox>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <SectionTitle>Example: 5 km run</SectionTitle>
        <ExampleBox title="Breakdown">
          <div className="space-y-0.5">
            <FormulaRow label="Base amount" value="15 XP" />
            <FormulaRow label="5 km × 2 XP/km" value="10 XP" />
            <FormulaRow label="Distance bonus (≥ 5 km)" value="+5 XP" />
            <div className="border-t border-foreground/10 mt-2 pt-2">
              <FormulaRow label="Total" value="30 XP" highlight />
            </div>
          </div>
        </ExampleBox>
      </div>

      <div>
        <SectionTitle>Example: 10 km run</SectionTitle>
        <ExampleBox title="Breakdown">
          <div className="space-y-0.5">
            <FormulaRow label="Base amount" value="15 XP" />
            <FormulaRow label="10 km × 2 XP/km" value="20 XP" />
            <FormulaRow label="Distance bonus (≥ 10 km)" value="+15 XP" />
            <div className="border-t border-foreground/10 mt-2 pt-2">
              <FormulaRow label="Total" value="50 XP" highlight />
            </div>
          </div>
        </ExampleBox>
      </div>
    </div>

    <div>
      <SectionTitle>Streak bonus on XP</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        The streak multiplier applies to <strong className="text-foreground">base amount + km XP</strong> — not the distance bonus. The longer your streak, the more XP per session.
      </p>
      <ExampleBox title="Example: 5 km on day 30 of a streak (1.3x)">
        <div className="space-y-0.5">
          <FormulaRow label="Base + km XP" value="25 XP" />
          <FormulaRow label="× 1.3 (streak day 30)" value="32.5 XP" />
          <FormulaRow label="+ Distance bonus" value="+5 XP" />
          <div className="border-t border-foreground/10 mt-2 pt-2">
            <FormulaRow label="Total" value="37 XP" highlight />
          </div>
        </div>
      </ExampleBox>
    </div>
  </div>
);

const LevelsTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>Levels and XP requirements</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        Below you can see how much total XP is required to reach each level, and how many 5 km and 10 km runs that corresponds to — calculated without streak bonus.
      </p>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/10">
            <th className="text-left py-2 px-3 text-muted-foreground font-medium">Level</th>
            <th className="text-right py-2 px-3 text-muted-foreground font-medium">XP required</th>
            <th className="text-right py-2 px-3 text-muted-foreground font-medium">5 km runs</th>
            <th className="text-right py-2 px-3 text-muted-foreground font-medium">10 km runs</th>
          </tr>
        </thead>
        <tbody>
          {LEVEL_TABLE.map((row, i) => (
            <tr key={row.level} className={cn('border-b border-foreground/5', i % 2 === 0 && 'bg-foreground/[0.02]')}>
              <td className="py-2.5 px-3 font-semibold" style={{ color: 'var(--rq-gold)' }}>
                Level {row.level}
              </td>
              <td className="py-2.5 px-3 text-right font-mono">{row.xp.toLocaleString()}</td>
              <td className="py-2.5 px-3 text-right text-muted-foreground font-mono">
                {(row.xp / 30).toFixed(1)}
              </td>
              <td className="py-2.5 px-3 text-right text-muted-foreground font-mono">
                {(row.xp / 50).toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ExampleBox title="5 km = 30 XP per run">
        <p className="text-sm text-muted-foreground">15 (base) + 10 (km) + 5 (bonus) = 30 XP</p>
      </ExampleBox>
      <ExampleBox title="10 km = 50 XP per run">
        <p className="text-sm text-muted-foreground">15 (base) + 20 (km) + 15 (bonus) = 50 XP</p>
      </ExampleBox>
    </div>
  </div>
);

const StreakTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>What is a streak?</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        A streak counts the number of <strong className="text-foreground">unique days</strong> you run in a row. It doesn't matter if you run multiple times in a day — it counts as one day. A streak breaks if you miss an entire day.
      </p>
    </div>

    <div>
      <SectionTitle>Streak multipliers</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        The longer your streak, the more XP per session. The multiplier applies to base amount + km XP — not the distance bonus.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10">
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">Streak (days)</th>
              <th className="text-right py-2 px-3 text-muted-foreground font-medium">Multiplier</th>
              <th className="text-right py-2 px-3 text-muted-foreground font-medium">5 km run earns</th>
            </tr>
          </thead>
          <tbody>
            {STREAK_MULTIPLIERS.map((row, i) => (
              <tr key={row.days} className={cn('border-b border-foreground/5', i % 2 === 0 && 'bg-foreground/[0.02]')}>
                <td className="py-2.5 px-3 font-medium">{row.days} days</td>
                <td className="py-2.5 px-3 text-right font-mono" style={{ color: 'var(--rq-gold)' }}>
                  {row.multiplier.toFixed(2)}x
                </td>
                <td className="py-2.5 px-3 text-right text-muted-foreground font-mono">
                  {Math.floor(25 * row.multiplier + 5)} XP
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    <ExampleBox title="Example: Day 270 in a row">
      <p className="text-sm text-muted-foreground">
        A 5 km run normally gives 30 XP. With a 2.0x multiplier: (15 + 10) × 2.0 + 5 = <strong className="text-foreground">55 XP</strong> — almost double.
      </p>
    </ExampleBox>
  </div>
);

const TitlesTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>How do titles work?</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        There are 20 titles and each title is held by the person in the group with the best value for that specific metric. Titles update automatically after every synced run. You can choose which titles are displayed on your card in the leaderboard.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {TITLES.map((title) => (
        <div
          key={title.name}
          className="bg-background border border-foreground/15 rounded-lg p-3 flex items-start gap-3"
        >
          <div className="mt-0.5 shrink-0" style={{ color: 'var(--rq-gold)' }}>{title.icon}</div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{title.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{title.description}</p>
            <p className="text-xs mt-1.5 font-medium" style={{ color: 'var(--rq-success)' }}>
              Unlock: {title.unlock}
            </p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ChallengesTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>What are challenges?</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        Challenges are 1v1 duels between two group members. When you send a challenge, you choose the tier (Minor, Major, or Legendary) — the metric and duration are randomized from the available options for that tier. If you hold multiple tokens you pick which one to send, but the actual challenge details are always random.
      </p>
      <p className="text-sm text-muted-foreground mb-4">
        Once the opponent accepts, the challenge starts at <strong className="text-foreground">00:00 the following day</strong> and runs until <strong className="text-foreground">23:59 on the last day</strong>. The best performer over that window wins a temporary XP boost — the loser gets a penalty.
      </p>
    </div>

    <div>
      <SectionTitle>Tokens — how do you get challenges?</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        You earn challenge tokens when you reach certain levels. Tokens are used to send challenges.
      </p>
      {/* NOTE: Token award levels must be kept in sync with the backend
           challenge token logic (routes/challenges.ts / admin_settings). */}
      <div className="flex flex-wrap gap-2">
        {[
          { level: 3, tier: 'minor' }, { level: 5, tier: 'major' }, { level: 8, tier: 'minor' },
          { level: 10, tier: 'major' }, { level: 12, tier: 'minor' }, { level: 14, tier: 'minor' },
          { level: 15, tier: 'legendary' }, { level: 16, tier: 'minor' }, { level: 17, tier: 'minor' }, { level: 18, tier: 'minor' },
        ].map(({ level, tier }) => (
          <div key={level} className="bg-background border border-foreground/15 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
            <span className="text-muted-foreground">Level {level}</span>
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                tier === 'legendary' && 'border-[var(--rq-gold)] text-[var(--rq-gold)]',
                tier === 'major' && 'border-foreground/40 text-foreground',
                tier === 'minor' && 'border-foreground/20 text-muted-foreground',
              )}
            >
              {tier}
            </Badge>
          </div>
        ))}
        <div className="bg-background border border-foreground/10 border-dashed rounded-lg px-3 py-2 text-sm text-muted-foreground">
          + more at higher levels…
        </div>
      </div>
    </div>

    <div>
      <SectionTitle>Tiers, duration, and rewards</SectionTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            tier: 'Minor', color: 'var(--rq-text-soft)', duration: '5–7 days',
            metrics: 'Km, sessions, XP',
            winner: '+0.15x for 5 days', loser: '−0.07x for 5 days',
            example: 'A 5 km run gives 32 XP instead of 30.',
          },
          {
            tier: 'Major', color: 'var(--rq-foreground)', duration: '7–14 days',
            metrics: 'Km, sessions, XP',
            winner: '+0.25x for 10 days', loser: '−0.12x for 10 days',
            example: 'A 5 km run gives 36 XP instead of 30.',
          },
          {
            tier: 'Legendary', color: 'var(--rq-gold)', duration: '14–30 days',
            metrics: 'XP only',
            winner: '+0.50x for 14 days', loser: '−0.25x for 14 days',
            example: 'A 5 km run gives 43 XP instead of 30.',
          },
        ].map((tier) => (
          <div key={tier.tier} className="bg-background border border-foreground/15 rounded-lg p-4">
            <p className="font-bold text-base mb-3" style={{ color: tier.color }}>{tier.tier}</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">{tier.duration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Metric</span>
                <span className="font-medium text-right">{tier.metrics}</span>
              </div>
              <div className="border-t border-foreground/10 pt-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Winner</span>
                  <span className="font-medium" style={{ color: 'var(--rq-success)' }}>{tier.winner}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loser</span>
                  <span className="font-medium" style={{ color: 'var(--rq-danger)' }}>{tier.loser}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-1 border-t border-foreground/10">{tier.example}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <ExampleBox title="How does the boost work in practice?">
      <p className="text-sm text-muted-foreground">
        The boost multiplier stacks on top of your streak multiplier. If you win a Major challenge with a 1.2x streak (day 15) you get <strong className="text-foreground">1.2 + 0.25 = 1.45x</strong> for 10 days. The boost period starts immediately when the challenge is resolved.
      </p>
    </ExampleBox>
  </div>
);

const EventsTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>What are events?</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        Events are app-wide challenges that trigger automatically — either on a schedule or based on real-world conditions like weather. They come in two types: <strong className="text-foreground">Participation</strong> and <strong className="text-foreground">Competition</strong>.
      </p>
    </div>

    <div>
      <SectionTitle>Participation events</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        A time window opens and closes. Log a run that meets the distance requirement within that window and you earn XP instantly — no ranking, everyone who qualifies wins.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { icon: <Sun className="w-4 h-4" />,              name: 'Morgonrunda',  window: '06:00–10:00 daily',       minKm: '3 km',  xp: '25 XP' },
          { icon: <Moon className="w-4 h-4" />,             name: 'Kvällsrunda',  window: '18:00–22:00 daily',       minKm: '3 km',  xp: '25 XP' },
          { icon: <Zap className="w-4 h-4" />,              name: '5K Friday',    window: 'All Friday',              minKm: '5 km',  xp: '25 XP' },
          { icon: <Flame className="w-4 h-4" />,            name: 'Hangover Run', window: 'All of Sat / Sun',        minKm: '3 km',  xp: '30 XP' },
          { icon: <CloudLightning className="w-4 h-4" />,   name: 'Storm Chaser', window: 'All day (weather only)',  minKm: '5 km',  xp: '40 XP' },
        ].map(e => (
          <div key={e.name} className="bg-background border border-foreground/15 rounded-lg p-3 flex items-start gap-3">
            <div className="mt-0.5 shrink-0" style={{ color: 'var(--rq-gold)' }}>{e.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{e.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{e.window} · min {e.minKm}</p>
              <p className="text-xs mt-1 font-medium" style={{ color: 'var(--rq-success)' }}>+{e.xp}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <ExampleBox title="Storm Chaser — weather trigger">
      <p className="text-sm text-muted-foreground">
        Storm Chaser only appears when tomorrow's forecast shows at least 3 hours of rain, drizzle, thunderstorm, or gusts above 12 m/s. The app checks every evening at 19:00 and creates the event automatically if conditions are met.
      </p>
    </ExampleBox>

    <div>
      <SectionTitle>Competition events</SectionTitle>
      <p className="text-sm text-muted-foreground mb-3">
        Weekly competitions run Monday 00:01 to Sunday 23:59. The app tallies your total km or elevation across all runs during that window and ranks everyone in the group. XP is awarded at settlement on Sunday evening.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { icon: <Trophy className="w-4 h-4" />,   name: 'Weekly km',         metric: 'Total distance',  xp: '40 / 30 / 20 XP' },
          { icon: <Mountain className="w-4 h-4" />, name: 'Weekly höjdmeter',  metric: 'Total elevation', xp: '40 / 30 / 20 XP' },
        ].map(e => (
          <div key={e.name} className="bg-background border border-foreground/15 rounded-lg p-3 flex items-start gap-3">
            <div className="mt-0.5 shrink-0" style={{ color: 'var(--rq-gold)' }}>{e.icon}</div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{e.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{e.metric} · Mon–Sun</p>
              <p className="text-xs mt-1 font-medium" style={{ color: 'var(--rq-success)' }}>🥇{e.xp.split('/')[0].trim()} 🥈{e.xp.split('/')[1].trim()} 🥉{e.xp.split('/')[2].trim()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div>
      <SectionTitle>How XP works with events</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Event XP is separate from run XP and is tracked in its own column. It's included in your total XP and counts toward leveling up — but it won't show up in the per-run breakdown. Participation XP is awarded immediately when you qualify. Competition XP is awarded when the event settles on Sunday at 23:55.
      </p>
    </div>
  </div>
);

const StravaTab: React.FC = () => (
  <div className="space-y-6">
    <div>
      <SectionTitle>Strava vs. manual logging</SectionTitle>
      <p className="text-sm text-muted-foreground mb-4">
        All runs — whether they come from Strava or are logged manually — calculate XP with exactly the same formula. There is no difference in how much XP you get.
      </p>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-background border border-foreground/15 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-5 h-5" style={{ color: 'var(--rq-gold)' }} />
          <p className="font-semibold">Strava import</p>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Syncs automatically every 30 minutes</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Fetches sessions from the last 7 days on each sync</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Includes extra data: start time, elevation, heart rate, pace variation</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Treadmill runs (trainer flag) are automatically tagged</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Weather data is fetched for every outdoor run with GPS coordinates</li>
        </ul>
      </div>

      <div className="bg-background border border-foreground/15 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5" style={{ color: 'var(--rq-gold)' }} />
          <p className="font-semibold">Manual logging</p>
        </div>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Log directly in the app with distance and date</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Same XP formula as Strava</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />No GPS data — weather and elevation not available</li>
          <li className="flex items-start gap-2"><ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />Works great if you don't use Strava</li>
        </ul>
      </div>
    </div>

    <div>
      <SectionTitle>Titles and treadmill</SectionTitle>
      <p className="text-sm text-muted-foreground">
        Treadmill sessions count toward total XP and levels — but are excluded from titles that require outdoor running, such as The Mountain Goat and The Vertical Runner. This is an intentional distinction: treadmill and outdoor running are different things.
      </p>
    </div>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

const PlaybookPage: React.FC = () => {
  const groupName = useGroupName();
  const [activeTab, setActiveTab] = useState('xp');

  return (
    <AppLayout groupName={groupName}>
      <div className="max-w-4xl mx-auto">
        <div className="bg-sidebar border-2 border-foreground/15 rounded-lg">
          <PageTabs value={activeTab} onValueChange={setActiveTab} tabs={TABS} tabsGridClass="grid-cols-4 md:grid-cols-7">
            <TabsContent value="xp"         className="px-4 pb-4"><XPTab /></TabsContent>
            <TabsContent value="levels"     className="px-4 pb-4"><LevelsTab /></TabsContent>
            <TabsContent value="streak"     className="px-4 pb-4"><StreakTab /></TabsContent>
            <TabsContent value="titles"     className="px-4 pb-4"><TitlesTab /></TabsContent>
            <TabsContent value="challenges" className="px-4 pb-4"><ChallengesTab /></TabsContent>
            <TabsContent value="events"     className="px-4 pb-4"><EventsTab /></TabsContent>
            <TabsContent value="strava"     className="px-4 pb-4"><StravaTab /></TabsContent>
          </PageTabs>
        </div>
      </div>
    </AppLayout>
  );
};

export default PlaybookPage;
