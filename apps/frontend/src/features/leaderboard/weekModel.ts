import type { WeekDay, WeekLeaderboardResponse, WeekLeaderboardUser } from '@runquest/shared';
import { deltaView, formatDecimal, formatInt, type DeltaView } from './boardFormat';

// Week-vyns vymodell: /api/leaderboard/week → rader med dagstaplar, mover och pack-total.

export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Staplarnas värmeskala (temafilens --rq-heat-*): 0 = tom dag, 1–3 = allt starkare guld. */
export type BarLevel = 0 | 1 | 2 | 3;

const LEVEL_2_FROM_PCT = 34;
const LEVEL_3_FROM_PCT = 67;

export interface DayBar {
  date: string;
  /** Veckodagsbokstav (M T W T F S S) — dubblett-bokstäver är avsiktliga, som i designen. */
  label: string;
  km: number;
  /** Höjd i % av flockens längsta dagsdistans den här veckan (0–100); samma skala på alla rader. */
  heightPct: number;
  level: BarLevel;
}

export interface WeekRow {
  id: string;
  name: string;
  rank: number;
  /** Form = rank_delta mot förra veckan (positivt = klättrat). */
  form: DeltaView;
  km: string;
  runs: number;
  runsText: string;
  xp: string;
  bars: DayBar[];
}

/** Längsta enskilda dagsdistans bland alla rader — skalan som alla staplar delar. */
export function longestDayKm(users: WeekLeaderboardUser[]): number {
  return users.reduce((max, user) => user.days.reduce((m, day) => Math.max(m, day.km), max), 0);
}

export function barLevel(heightPct: number): BarLevel {
  if (heightPct <= 0) return 0;
  if (heightPct >= LEVEL_3_FROM_PCT) return 3;
  return heightPct >= LEVEL_2_FROM_PCT ? 2 : 1;
}

export function buildDayBars(days: WeekDay[], scaleKm: number): DayBar[] {
  return days.map((day, index) => {
    const heightPct = day.km > 0 && scaleKm > 0 ? Math.max(1, Math.min(100, Math.round((day.km / scaleKm) * 100))) : 0;
    return { date: day.date, label: DAY_LABELS[index] ?? '', km: day.km, heightPct, level: barLevel(heightPct) };
  });
}

export function buildWeekRows(users: WeekLeaderboardUser[]): WeekRow[] {
  const scale = longestDayKm(users);
  return users.map((user) => ({
    id: user.user_id,
    name: user.name,
    rank: user.rank,
    form: deltaView(user.rank_delta),
    km: formatDecimal(user.km),
    runs: user.runs,
    runsText: `${user.runs} ${user.runs === 1 ? 'run' : 'runs'}`,
    xp: formatInt(user.xp),
    bars: buildDayBars(user.days, scale),
  }));
}

export interface MoverView {
  id: string;
  name: string;
  places: number;
  summary: string;
}

/** "Mover of the week": den som klättrat mest. Texten byggs ur veckans faktiska siffror. */
export function buildMover(week: WeekLeaderboardResponse): MoverView | null {
  if (!week.mover) return null;
  const user = week.users.find((candidate) => candidate.user_id === week.mover?.user_id);
  if (!user) return null;
  const places = week.mover.rank_delta;
  return {
    id: user.user_id,
    name: user.name,
    places,
    summary: `Up ${places} ${places === 1 ? 'place' : 'places'} on last week — ${user.runs} ${user.runs === 1 ? 'run' : 'runs'} and ${formatDecimal(user.km)} km so far.`,
  };
}

export interface PackTotalView {
  km: string;
  summary: string;
  /** 0–100, eller null när gruppen saknar en bästa vecka att jämföra mot. */
  pctOfBest: number | null;
  pctText: string;
}

export function buildPackTotal(totals: WeekLeaderboardResponse['totals']): PackTotalView {
  return {
    km: `${formatDecimal(totals.km)} km`,
    summary: `${totals.runs} ${totals.runs === 1 ? 'run' : 'runs'} · ${totals.active_runners} of ${totals.members} runners active`,
    pctOfBest: totals.pct_of_best_week,
    pctText: totals.pct_of_best_week === null ? 'No best week to compare with yet' : `${totals.pct_of_best_week}% of your best week`,
  };
}
