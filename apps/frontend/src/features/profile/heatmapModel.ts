import type { Run, User } from '@runquest/types';
import { streakDeadline } from '@/app-shell/rightNowItems';
import { latestRunOf } from '@/features/leaderboard/boardFormat';
import { SHORT_MONTHS, formatDay } from './profileFormat';

// Consistency-heatmapen: en cell per dag, veckor som kolumner (mån–sön), grupperade per månad så att "den här månaden"
// hittas utan att räkna rutor (App-/Web Prototype). Allt härleds ur användarens rundor — ingen egen endpoint.
// Ren logik: `today` (Stockholm-dagen) skickas alltid in.

/** Månader i fönstret: desktop 12 (Web Prototype), mobil 6 (App Prototype). */
export const HEAT_MONTHS_DESKTOP = 12;
export const HEAT_MONTHS_MOBILE = 6;

/** Dagens km → intensitet 1–4. Stegen följer distansbonusarna i XP-reglerna (5 · 10 · 15 km). */
export const HEAT_KM_STEPS = [5, 10, 15] as const;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatCell {
  date: string;
  /** null = en dag som ännu inte hänt (ritas som streckad ruta). */
  level: HeatLevel | null;
  runs: number;
  km: number;
  today: boolean;
}

export interface HeatWeek {
  /** Löpande veckonummer över hela fönstret (animationens stagger). */
  index: number;
  cells: HeatCell[];
}

export interface HeatMonth {
  key: string;
  label: string;
  /** Innevarande månad — etiketten i guld. */
  current: boolean;
  weeks: HeatWeek[];
}

export interface HeatStat {
  key: 'streak' | 'longest' | 'active';
  value: string;
  label: string;
  tone: 'gold' | 'default' | 'up';
}

export interface Heatmap {
  months: HeatMonth[];
  /** Rundor i fönstret. */
  runs: number;
  /** Dagar i fönstret som hunnit hända (till och med idag), och hur många av dem som har en runda. */
  elapsedDays: number;
  activeDays: number;
  /** "Today · 24 Aug". */
  todayLabel: string;
  /** Skärmläsarens sammanfattning av hela rutnätet. */
  summary: string;
}

const MS_DAY = 86_400_000;

const toMs = (isoDate: string): number => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const fromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (isoDate: string, days: number): string => fromMs(toMs(isoDate) + days * MS_DAY);
/** Måndagen i veckan som innehåller dagen. */
const mondayOf = (isoDate: string): string => addDays(isoDate, -((new Date(toMs(isoDate)).getUTCDay() + 6) % 7));

export function heatLevel(km: number): HeatLevel {
  if (km <= 0) return 0;
  if (km < HEAT_KM_STEPS[0]) return 1;
  if (km < HEAT_KM_STEPS[1]) return 2;
  if (km < HEAT_KM_STEPS[2]) return 3;
  return 4;
}

const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

/** Fönstrets månader, äldst först: innevarande + `months - 1` före. */
function windowMonths(today: string, months: number): Array<{ year: number; month: number }> {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: months }, (_, i) => {
    const index = year * 12 + (month - 1) - (months - 1 - i);
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  });
}

/**
 * Rutnätet för de senaste `months` månaderna. En vecka tillhör den månad där dess måndag ligger (därför 4 eller 5 veckor
 * per månad, som prototypen); dagar efter idag ritas som tomma streckade rutor. Fönstret börjar första måndagen i äldsta månaden.
 */
export function buildHeatmap(runs: Pick<Run, 'date' | 'distance'>[], today: string, months: number): Heatmap {
  const perDay = new Map<string, { km: number; runs: number }>();
  for (const run of runs) {
    const day = run.date.slice(0, 10);
    const entry = perDay.get(day) ?? { km: 0, runs: 0 };
    perDay.set(day, { km: entry.km + run.distance, runs: entry.runs + 1 });
  }

  let weekIndex = 0;
  let totalRuns = 0;
  let activeDays = 0;
  let elapsedDays = 0;

  const blocks = windowMonths(today, months).map(({ year, month }, position, all): HeatMonth => {
    const key = monthKey(year, month);
    const first = `${key}-01`;
    const weeks: HeatWeek[] = [];
    // Första måndagen i månaden, sedan var sjunde dag så länge måndagen ligger i månaden och inte efter idag.
    let monday = mondayOf(first) < first ? addDays(mondayOf(first), 7) : first;
    while (monday.startsWith(key) && monday <= today) {
      const cells = Array.from({ length: 7 }, (_, d): HeatCell => {
        const date = addDays(monday, d);
        if (date > today) return { date, level: null, runs: 0, km: 0, today: false };
        const entry = perDay.get(date);
        elapsedDays += 1;
        if (entry) {
          totalRuns += entry.runs;
          activeDays += 1;
        }
        return { date, level: heatLevel(entry?.km ?? 0), runs: entry?.runs ?? 0, km: entry?.km ?? 0, today: date === today };
      });
      weeks.push({ index: weekIndex, cells });
      weekIndex += 1;
      monday = addDays(monday, 7);
    }
    return { key, label: SHORT_MONTHS[month - 1], current: position === all.length - 1, weeks };
  });

  return {
    months: blocks,
    runs: totalRuns,
    elapsedDays,
    activeDays,
    todayLabel: `Today · ${formatDay(today)}`,
    summary: `${totalRuns} ${totalRuns === 1 ? 'run' : 'runs'} on ${activeDays} of ${elapsedDays} days`,
  };
}

/**
 * Nuvarande streak så som resten av appen räknar den (0 när den brutits — samma `streakDeadline` som Board och Right now);
 * längsta streak = användarens rekord, inte fönstrets (Streak-fliken visar samma tal). Dagar aktiva = andel av fönstrets dagar
 * (till och med idag) med minst en runda.
 */
export function buildHeatStats(user: User, heat: Heatmap, now: Date): HeatStat[] {
  const last = latestRunOf(user.runs);
  const alive = user.current_streak > 0 && streakDeadline(last?.date ?? null, now) !== null;
  const current = alive ? user.current_streak : 0;
  const pct = heat.elapsedDays > 0 ? Math.round((heat.activeDays / heat.elapsedDays) * 100) : 0;
  return [
    { key: 'streak', value: String(current), label: 'current streak', tone: 'gold' },
    { key: 'longest', value: String(Math.max(user.longest_streak ?? 0, current)), label: 'longest streak', tone: 'default' },
    { key: 'active', value: `${pct}%`, label: 'days active', tone: 'up' },
  ];
}
