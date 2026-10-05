// Veckoleaderboard — rena funktioner (ADR 007 B1). Ingen DB, ingen klocka:
// handlern läser data och avgör vilken måndag som gäller (Stockholm-tid);
// här räknas bara på kalenderdagar (YYYY-MM-DD), som är tidszonsfria.
import type { WeekDay, WeekLeaderboardResponse, WeekLeaderboardTotals, WeekLeaderboardUser } from './contracts/leaderboard.js';

/** Medlem i gruppen. `created_date` = Stockholm-kalenderdag då användaren skapades (null = okänt → räknas som medlem). */
export interface WeekMember {
  id: string;
  name: string;
  profile_picture: string | null;
  level: number;
  created_date: string | null;
}

export interface WeekRun {
  user_id: string;
  date: string;
  /** numeric kan komma som sträng från databasen. */
  distance: number | string;
  xp_gained: number | null;
}

// ─── Kalenderhjälpare ────────────────────────────────────────────────────────

function toUtcNoon(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Mitt på dagen i UTC: ingen sommartidsförskjutning kan flytta datumet.
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Lägger N dagar på ett kalenderdatum (YYYY-MM-DD). Ren kalenderaritmetik, tidszonsfri. */
export function addDaysToCalendarDate(dateStr: string, days: number): string {
  const d = toUtcNoon(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtc(d);
}

/** Måndagen i veckan (mån–sön) som kalenderdatumet tillhör. */
export function mondayOfCalendarDate(dateStr: string): string {
  const dow = toUtcNoon(dateStr).getUTCDay(); // 0 = söndag
  return addDaysToCalendarDate(dateStr, -((dow + 6) % 7));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Rank ────────────────────────────────────────────────────────────────────

interface Rankable {
  id: string;
  name: string;
  xp: number;
  km: number;
}

/** (xp desc, km desc, name asc skiftlägesokänsligt, id) — deterministisk total ordning. */
function compareRank(a: Rankable, b: Rankable): number {
  if (a.xp !== b.xp) return b.xp - a.xp;
  if (a.km !== b.km) return b.km - a.km;
  return compareByNameThenId(a, b);
}

/** Namn asc (skiftlägesokänsligt) → id; exporteras för rank-delta som delar tie-breaker. */
export function compareByNameThenId(a: { id: string; name: string }, b: { id: string; name: string }): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rankMap(items: Rankable[]): Map<string, number> {
  const ranks = new Map<string, number>();
  [...items].sort(compareRank).forEach((item, i) => ranks.set(item.id, i + 1));
  return ranks;
}

// ─── Veckoberäkning ──────────────────────────────────────────────────────────

/** Veckoberäkningens resultat; best_week_km/pct_of_best_week läggs på av handlern (kräver hela historiken). */
export interface WeekComputation {
  users: WeekLeaderboardUser[];
  totals: Omit<WeekLeaderboardTotals, 'best_week_km' | 'pct_of_best_week'>;
  mover: WeekLeaderboardResponse['mover'];
}

interface Accum {
  km: number;
  xp: number;
  runs: number;
}

/**
 * Bygger veckans leaderboard för gruppens medlemmar.
 * @param weekStart måndag (YYYY-MM-DD); veckan är mån–sön, förra veckan är de 7 dagarna före.
 * Rundor utanför de två veckorna och rundor från icke-medlemmar ignoreras.
 */
export function buildWeekLeaderboard(
  members: WeekMember[],
  runs: WeekRun[],
  weekStart: string,
): WeekComputation {
  const prevStart = addDaysToCalendarDate(weekStart, -7);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysToCalendarDate(weekStart, i));
  const dayIndex = new Map(dates.map((d, i) => [d, i]));
  const prevDates = new Set(Array.from({ length: 7 }, (_, i) => addDaysToCalendarDate(prevStart, i)));

  const current = new Map<string, Accum & { days: WeekDay[] }>();
  const previous = new Map<string, Accum>();
  for (const m of members) {
    current.set(m.id, { km: 0, xp: 0, runs: 0, days: dates.map((date) => ({ date, km: 0, xp: 0, runs: 0 })) });
    previous.set(m.id, { km: 0, xp: 0, runs: 0 });
  }

  let previousWeekRuns = 0;
  for (const r of runs) {
    const km = Number(r.distance) || 0;
    const xp = r.xp_gained ?? 0;
    const cur = current.get(r.user_id);
    if (!cur) continue; // icke-medlem

    const idx = dayIndex.get(r.date);
    if (idx !== undefined) {
      cur.km += km; cur.xp += xp; cur.runs += 1;
      const day = cur.days[idx];
      day.km += km; day.xp += xp; day.runs += 1;
    } else if (prevDates.has(r.date)) {
      const prev = previous.get(r.user_id)!;
      prev.km += km; prev.xp += xp; prev.runs += 1;
      previousWeekRuns += 1;
    }
  }

  const currentRanks = rankMap(members.map((m) => {
    const c = current.get(m.id)!;
    return { id: m.id, name: m.name, xp: c.xp, km: round2(c.km) };
  }));

  // Förra rankingen bland dem som fanns då (skapade senast på förra veckans första dag).
  const eligible = members.filter((m) => m.created_date === null || m.created_date <= prevStart);
  const previousRanks = rankMap(eligible.map((m) => {
    const p = previous.get(m.id)!;
    return { id: m.id, name: m.name, xp: p.xp, km: round2(p.km) };
  }));

  const users: WeekLeaderboardUser[] = members.map((m) => {
    const c = current.get(m.id)!;
    const rank = currentRanks.get(m.id)!;
    const previous_rank = previousRanks.get(m.id) ?? null;
    return {
      user_id: m.id,
      name: m.name,
      profile_picture: m.profile_picture,
      level: m.level,
      km: round2(c.km),
      runs: c.runs,
      xp: c.xp,
      days: c.days.map((d) => ({ ...d, km: round2(d.km) })),
      rank,
      previous_rank,
      rank_delta: previous_rank === null ? null : previous_rank - rank,
    };
  }).sort((a, b) => a.rank - b.rank);

  // Störst positivt rank_delta; tie → högst xp, därefter bäst rank. Ingen jämförelse utan rundor förra veckan.
  const climber = previousWeekRuns === 0 ? undefined : users
    .filter((u) => u.rank_delta !== null && u.rank_delta > 0)
    .sort((a, b) => (b.rank_delta as number) - (a.rank_delta as number) || b.xp - a.xp || a.rank - b.rank)[0];
  const mover: WeekLeaderboardResponse['mover'] = climber
    ? { user_id: climber.user_id, rank_delta: climber.rank_delta as number }
    : null;

  const totals = {
    km: round2(users.reduce((s, u) => s + u.km, 0)),
    runs: users.reduce((s, u) => s + u.runs, 0),
    xp: users.reduce((s, u) => s + u.xp, 0),
    active_runners: users.filter((u) => u.runs > 0).length,
    members: members.length,
  };

  return { users, totals, mover };
}

// ─── Bästa vecka någonsin ────────────────────────────────────────────────────

/** Största km-summan för en enskild vecka (mån–sön) över en hel runs-historik. */
export function bestWeekKm(runs: Array<{ date: string; distance: number | string }>): number {
  const perWeek = new Map<string, number>();
  for (const r of runs) {
    const monday = mondayOfCalendarDate(r.date);
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + (Number(r.distance) || 0));
  }
  let best = 0;
  for (const km of perWeek.values()) if (km > best) best = km;
  return round2(best);
}

/** km i % av bästa veckan (heltal, klampat till 100); null om bästa veckan är 0. */
export function percentOfBest(km: number, bestKm: number): number | null {
  if (bestKm <= 0) return null;
  return Math.min(100, Math.round((km / bestKm) * 100));
}
