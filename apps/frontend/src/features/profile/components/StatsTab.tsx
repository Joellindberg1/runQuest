import React from 'react';
import { BarChart3, Flame, Map } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { Progress } from '@/shared/components/ui/progress';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { getLevelFromXP, getXPForLevel, getXPForNextLevel } from '@/shared/services/levelService';
import { getInitials } from '@/shared/utils/formatters';
import { MAX_LEVEL } from '@/constants/appConstants';
import { FrodoJourney } from './FrodoJourney';
import type { User as UserType } from '@runquest/types';

const MARATHON = 42.195;

// ─── Primitives ───────────────────────────────────────────────────────────────

const SectionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className="bg-background/50 border border-foreground/15 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-3">
      <span style={{ color: 'var(--rq-gold)' }}>{icon}</span>
      <span
        className="text-xs font-semibold uppercase"
        style={{ color: 'var(--rq-gold)', fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.14em' }}
      >
        {title}
      </span>
    </div>
    {children}
  </div>
);

const StatRow: React.FC<{
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}> = ({ label, value, highlight }) => (
  <div className="flex items-baseline justify-between py-1.5 border-b border-foreground/10 last:border-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span
      className="font-semibold tabular-nums text-sm"
      style={highlight ? { color: 'var(--rq-gold)' } : undefined}
    >
      {value}
    </span>
  </div>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trimmedMedian(values: number[], trim = 0.1): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * trim);
  const trimmed = sorted.slice(cut, sorted.length - cut);
  const arr = trimmed.length > 0 ? trimmed : sorted;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

// ─── Component ────────────────────────────────────────────────────────────────

export const StatsTab: React.FC<{ user: UserType; allUsers: UserType[] }> = ({ user, allUsers }) => {
  const currentLevel   = getLevelFromXP(user.total_xp);
  const currentLevelXP = getXPForLevel(currentLevel);
  const nextLevelXP    = getXPForNextLevel(currentLevel);
  const xpProgress     = currentLevel < MAX_LEVEL
    ? ((user.total_xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100
    : 100;
  const xpToNext = currentLevel < MAX_LEVEL ? nextLevelXP - user.total_xp : 0;

  const position = allUsers.length > 0
    ? leaderboardUtils.getUserPosition(user, leaderboardUtils.filterAndSortUsers(allUsers))
    : null;

  const runs      = user.runs || [];
  const distances = runs.map(r => r.distance);

  const longestRun = distances.length > 0 ? Math.max(...distances) : 0;
  const avgKm      = distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
  const medianKm   = trimmedMedian(distances);

  const currentYear = new Date().getFullYear().toString();

  const kmByYear = runs.reduce<Record<string, number>>((acc, r) => {
    const yr = r.date.slice(0, 4);
    acc[yr] = (acc[yr] || 0) + r.distance;
    return acc;
  }, {});
  const bestYearEntry = Object.entries(kmByYear).sort((a, b) => b[1] - a[1])[0];
  const bestYear      = bestYearEntry?.[0] ?? null;
  const bestYearKm    = bestYearEntry?.[1] ?? 0;
  const thisYearKm    = kmByYear[currentYear] ?? 0;

  // Read multipliers from the stored run values (calculated by backend using DB settings)
  // rather than recomputing with frontend constants that could drift from DB config.
  const sorted = [...runs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const currentMultiplier = sorted[0]?.multiplier ?? 1.0;
  const highestMultiplier = runs.length > 0 ? Math.max(...runs.map(r => r.multiplier)) : 1.0;
  const streakReached5    = runs.filter(r => r.streak_day === 5).length;

  const totalMarathons    = Math.floor(user.total_km / MARATHON);
  const thisYearMarathons = Math.floor(thisYearKm / MARATHON);

  return (
    <div className="space-y-4 pb-4">

      {/* Me card */}
      <div className="flex justify-center">
        <div className="bg-background/50 border border-foreground/15 rounded-xl p-5 w-full max-w-lg">
          <div className="flex items-center gap-4">
            <Avatar
              className="h-16 w-16 shrink-0"
              style={{ boxShadow: '0 0 0 3px color-mix(in srgb, var(--rq-gold) 35%, transparent)' }}
            >
              <AvatarImage src={user.profile_picture || ''} />
              <AvatarFallback className="text-lg font-bold">{getInitials(user.name)}</AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <h2 className="text-xl font-bold leading-tight truncate">{user.name}</h2>
              <div className="text-sm text-muted-foreground">
                #{position ?? '?'} in the group · {runs.length} runs
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
            <div>
              <div className="text-lg font-bold" style={{ color: 'var(--rq-gold)' }}>Lvl {currentLevel}</div>
              <div className="text-xs text-muted-foreground">Level</div>
            </div>
            <div>
              <div className="text-lg font-bold">{user.total_xp.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Total XP</div>
            </div>
            <div>
              <div className="text-lg font-bold">{user.total_km.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">Total km</div>
            </div>
          </div>

          <div className="space-y-1 mt-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Level {currentLevel}</span>
              <span>Level {Math.min(currentLevel + 1, MAX_LEVEL)}</span>
            </div>
            <Progress value={Math.max(0, Math.min(100, xpProgress))} className="h-1.5 border border-foreground/15" />
            <div className="text-center text-xs text-muted-foreground">
              {currentLevel < MAX_LEVEL
                ? `${xpToNext.toLocaleString()} XP to next level`
                : 'Max Level Reached!'}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center border-t border-foreground/10 mt-4 pt-3">
            <div>
              <div className="text-base font-bold" style={{ color: 'var(--rq-success)' }}>{user.wins ?? 0}</div>
              <div className="text-xs text-muted-foreground">Wins</div>
            </div>
            <div>
              <div className="text-base font-bold text-muted-foreground">{user.draws ?? 0}</div>
              <div className="text-xs text-muted-foreground">Draws</div>
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: 'var(--rq-danger)' }}>{user.losses ?? 0}</div>
              <div className="text-xs text-muted-foreground">Losses</div>
            </div>
          </div>
        </div>
      </div>

      {/* Distance + Streak */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Distance" icon={<BarChart3 className="w-4 h-4" />}>
          <StatRow label="Longest run"           value={`${longestRun.toFixed(2)} km`} />
          <StatRow label="Total"                 value={`${user.total_km.toFixed(1)} km`} />
          <StatRow label={`This year (${currentYear})`} value={`${thisYearKm.toFixed(1)} km`} />
          {bestYear && (
            <StatRow
              label="Best year"
              value={`${bestYear}  ·  ${bestYearKm.toFixed(1)} km`}
              highlight={bestYear === currentYear}
            />
          )}
          <StatRow label="Average per run"       value={`${avgKm.toFixed(2)} km`} />
          <StatRow label="Median (trimmed ±10%)" value={`${medianKm.toFixed(2)} km`} />
        </SectionCard>

        <SectionCard title="Streak" icon={<Flame className="w-4 h-4" />}>
          <StatRow label="Current"             value={`${user.current_streak} days`} />
          <StatRow label="Multiplier"          value={`${currentMultiplier.toFixed(1)}x`} highlight />
          <StatRow label="Highest multiplier"  value={`${highestMultiplier.toFixed(1)}x`} />
          <StatRow label="Longest streak"      value={`${user.longest_streak} days`} />
          <StatRow label="Times 5+ day streak" value={streakReached5} />
        </SectionCard>
      </div>

      {/* Fun Facts */}
      <div data-tour="profile-fun-fact">
      <SectionCard title="Fun Facts" icon={<Map className="w-4 h-4" />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div>
            <StatRow label="Marathon equivalents total"        value={totalMarathons} />
            <StatRow label={`Marathon equivalents ${currentYear}`} value={thisYearMarathons} />
          </div>
          <div className="pt-2 md:pt-0 md:border-l md:border-foreground/10 md:pl-8">
            <FrodoJourney totalKm={user.total_km} />
          </div>
        </div>
      </SectionCard>
      </div>
    </div>
  );
};
