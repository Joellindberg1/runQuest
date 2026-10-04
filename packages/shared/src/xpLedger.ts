// XP-liggare och rank-delta — rena funktioner (ADR 007 B2).
// Liggaren härleds ur befintliga tabeller (runs.xp_gained + event_entries.xp_awarded);
// ingen ny lagring. Återanvänds av ADR 008:s backfill.
import type { RankDeltaUser as RankDeltaResultUser } from './contracts/leaderboard.js';
import { compareByNameThenId } from './leaderboard.js';

export interface LedgerRun {
  id: string;
  user_id: string;
  /** Kalenderdag YYYY-MM-DD (runs.date). */
  date: string;
  xp_gained: number | null;
}

export interface LedgerEventEntry {
  entry_id: string;
  user_id: string;
  event_id: string;
  event_type: 'participation' | 'competition';
  xp_awarded: number | null;
  /** ISO-tidpunkt (timestamptz). Datum för participation-XP. */
  qualified_at: string | null;
  /** ISO. Datum för competition-XP (avräkningstidpunkt). */
  settled_at: string | null;
  /** ISO. Fallback för competition-XP om settled_at saknas. */
  ends_at: string;
}

export interface XpLedgerEntry {
  user_id: string;
  source: 'run' | 'event';
  ref_id: string;
  /** Stockholm-kalenderdag då XP:n krediterades. */
  date: string;
  xp: number;
}

const stockholmDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' });

/** ISO-tidpunkt → Stockholm-kalenderdag (YYYY-MM-DD). */
function toStockholmDay(iso: string): string {
  return stockholmDay.format(new Date(iso));
}

/**
 * Bygger XP-liggaren. Datering av event-XP: participation → qualified_at;
 * competition → settled_at ?? ends_at (XP betalas ut vid avräkningen, inte vid anmälan).
 * Poster utan utbetald XP (null/0) hoppas över.
 */
export function buildXpLedger(runs: LedgerRun[], eventEntries: LedgerEventEntry[]): XpLedgerEntry[] {
  const ledger: XpLedgerEntry[] = [];

  for (const r of runs) {
    const xp = r.xp_gained ?? 0;
    if (xp > 0) ledger.push({ user_id: r.user_id, source: 'run', ref_id: r.id, date: r.date, xp });
  }

  for (const e of eventEntries) {
    const xp = e.xp_awarded ?? 0;
    if (xp <= 0) continue;
    const at = e.event_type === 'competition' ? (e.settled_at ?? e.ends_at) : e.qualified_at;
    if (!at) continue;
    ledger.push({ user_id: e.user_id, source: 'event', ref_id: e.entry_id, date: toStockholmDay(at), xp });
  }

  return ledger;
}

export interface RankDeltaInput {
  id: string;
  name: string;
  total_xp: number;
  /** Stockholm-kalenderdag då användaren skapades (null = okänt → räknas som medlem). */
  created_date: string | null;
}

/**
 * Rank nu (total_xp) mot rank vid veckostart (`asOf`, en måndag).
 * previous_xp = total_xp − XP krediterad med datum ≥ asOf. Rank = (xp desc, name asc).
 * Användare skapade på/efter asOf får previous_rank/rank_delta null och tävlar inte i förra rankingen.
 * `diverged` = användare vars liggare överstiger total_xp (previous_xp klampas till 0).
 */
export function buildRankDelta(
  users: RankDeltaInput[],
  ledger: XpLedgerEntry[],
  asOf: string,
): { users: RankDeltaResultUser[]; diverged: string[] } {
  const creditedSince = new Map<string, number>();
  for (const e of ledger) {
    if (e.date >= asOf) creditedSince.set(e.user_id, (creditedSince.get(e.user_id) ?? 0) + e.xp);
  }

  const diverged: string[] = [];
  const rows = users.map((u) => {
    const raw = u.total_xp - (creditedSince.get(u.id) ?? 0);
    if (raw < 0) diverged.push(u.id);
    return { id: u.id, name: u.name, xp: u.total_xp, previous_xp: Math.max(0, raw), created_date: u.created_date };
  });

  const byXp = (key: 'xp' | 'previous_xp') => (a: typeof rows[number], b: typeof rows[number]) =>
    b[key] - a[key] || compareByNameThenId(a, b);

  const rank = new Map<string, number>();
  [...rows].sort(byXp('xp')).forEach((r, i) => rank.set(r.id, i + 1));

  const previousRank = new Map<string, number>();
  rows
    .filter((r) => r.created_date === null || r.created_date < asOf)
    .sort(byXp('previous_xp'))
    .forEach((r, i) => previousRank.set(r.id, i + 1));

  const out: RankDeltaResultUser[] = rows
    .map((r) => {
      const current = rank.get(r.id)!;
      const prev = previousRank.get(r.id) ?? null;
      return {
        user_id: r.id,
        xp: r.xp,
        rank: current,
        previous_xp: r.previous_xp,
        previous_rank: prev,
        rank_delta: prev === null ? null : prev - current,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  return { users: out, diverged };
}
