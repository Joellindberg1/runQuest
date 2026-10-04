import type { User } from '@runquest/types';
import { calculateCompleteRunXP, calculateStreakMultiplier } from '@runquest/shared';
import type { XpConfigResponse } from '@runquest/shared';
import { streakDeadline } from '@/app-shell/rightNowItems';
import { formatHoursMinutes, formatRunAge } from './boardFormat';

// Streaks-vyns vymodell. Statusgrenen (safe / at risk / broken) går genom samma `streakDeadline`
// som Right now-pillen, så de två aldrig kan vara oense. Trappan kommer ur /api/config/xp — inga
// hårdkodade konstanter.

export type LadderStep = XpConfigResponse['streak_multipliers'][number];
export type StreakStatus = 'safe' | 'at-risk' | 'broken';
export type StreakAccent = 'gold' | 'silver' | 'bronze' | 'none' | 'down';

/** Andel av vägen mot toppmultiplikatorn där färgen byter (guld ≥ 60 %, silver ≥ 30 %, annars brons). */
const GOLD_FROM_PCT = 60;
const SILVER_FROM_PCT = 30;

export interface StreakRow {
  id: string;
  name: string;
  /** Effektiv streak: 0 när den är bruten, även om databasraden ännu inte nollställts av nattjobbet. */
  days: number;
  best: number;
  status: StreakStatus;
  multiplier: number;
  /** Multiplikatorns andel av vägen 1.0× → toppen, 0–100. */
  pct: number;
  accent: StreakAccent;
  /** "ran 2 h ago" · "6h 12m left" · "last run 6 d ago". */
  detail: string;
  /** Kvar till deadline (ms); null när streaken inte lever. */
  msLeft: number | null;
  isMe: boolean;
}

export function topMultiplier(ladder: LadderStep[]): number {
  return ladder.reduce((top, step) => Math.max(top, step.multiplier), 1);
}

export function multiplierProgress(multiplier: number, ladder: LadderStep[]): number {
  const top = topMultiplier(ladder);
  if (top <= 1) return 0;
  return Math.max(0, Math.min(100, Math.round(((multiplier - 1) / (top - 1)) * 100)));
}

export function accentForProgress(pct: number): Exclude<StreakAccent, 'down'> {
  if (pct >= GOLD_FROM_PCT) return 'gold';
  if (pct >= SILVER_FROM_PCT) return 'silver';
  return pct > 0 ? 'bronze' : 'none';
}

/** "1.8×" — en decimal räcker för trappan (1.1 … 2.0). */
export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(1)}×`;
}

function latestRunOf(user: User) {
  const runs = user.runs ?? [];
  if (runs.length === 0) return null;
  const stamp = (run: (typeof runs)[number]) => `${run.date.slice(0, 10)}|${run.start_time ?? run.created_at ?? ''}`;
  return runs.reduce((best, run) => (stamp(run) > stamp(best) ? run : best));
}

export function buildStreakRow(user: User, now: Date, ladder: LadderStep[], meId?: string): StreakRow {
  const last = latestRunOf(user);
  const deadline = streakDeadline(last?.date ?? null, now);
  const alive = user.current_streak > 0 && deadline !== null;
  const status: StreakStatus = !alive ? 'broken' : deadline.ranToday ? 'safe' : 'at-risk';
  const days = alive ? user.current_streak : 0;
  const multiplier = calculateStreakMultiplier(days, ladder);
  const pct = multiplierProgress(multiplier, ladder);
  const isMe = user.id === meId;

  let detail: string;
  if (status === 'at-risk' && deadline) detail = `${formatHoursMinutes(deadline.msLeft)} left`;
  else if (status === 'safe' && last) detail = `ran ${formatRunAge(last, now)}`;
  else detail = last ? `last run ${formatRunAge(last, now)}` : 'no runs yet';

  return {
    id: user.id,
    name: user.name,
    days,
    best: Math.max(user.longest_streak ?? 0, days),
    status,
    multiplier,
    pct,
    // Den som själv är i riskzonen får röd accent — det är den raden som kräver handling.
    accent: status === 'at-risk' && isMe ? 'down' : accentForProgress(pct),
    detail,
    msLeft: alive && deadline ? deadline.msLeft : null,
    isMe,
  };
}

export function buildStreakRows(users: User[], now: Date, ladder: LadderStep[], meId?: string): StreakRow[] {
  return users
    .filter((user) => user.name.toLowerCase() !== 'admin')
    .map((user) => buildStreakRow(user, now, ladder, meId))
    .sort((a, b) => b.days - a.days || b.best - a.best || a.name.localeCompare(b.name));
}

export interface LadderRow {
  days: number;
  multiplier: number;
  label: string;
  accent: Exclude<StreakAccent, 'down'>;
}

/** Trappan som läsbara rader ("5 days" → 1.1× … "270 days and beyond" → 2.0×). */
export function buildLadderRows(ladder: LadderStep[]): LadderRow[] {
  const steps = [...ladder].sort((a, b) => a.days - b.days);
  return steps.map((step, index) => ({
    days: step.days,
    multiplier: step.multiplier,
    label: index === steps.length - 1 ? `${step.days} days and beyond` : `${step.days} days`,
    accent: accentForProgress(multiplierProgress(step.multiplier, steps)),
  }));
}

/** Vad nästa 10 km-runda ger om streaken lever respektive bryts — samma formel som backend (shared). */
export function nextRunXp(
  streakDays: number,
  config: XpConfigResponse,
  distanceKm = 10,
): { keep: { xp: number; multiplier: number }; broken: { xp: number; multiplier: number } } {
  const keepDay = streakDays + 1; // rundan idag blir dag N+1 i streaken
  const keep = calculateCompleteRunXP(distanceKm, keepDay, config.settings, config.streak_multipliers);
  const broken = calculateCompleteRunXP(distanceKm, 1, config.settings, config.streak_multipliers);
  return {
    keep: { xp: keep.finalXP, multiplier: keep.multiplier },
    broken: { xp: broken.finalXP, multiplier: broken.multiplier },
  };
}
