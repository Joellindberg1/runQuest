import { STOCKHOLM_TZ, addDays, daysBetween, zoneDay, zoneMidnightIso } from './calendar.js';
import { isCalendarDay } from './titleWindow.js';

// Boost-tillämpning per runda — REN funktion så att omräkningen i
// reprocessRunsFromDate förblir deterministisk och idempotent.
//
// multiplier_days: deltat gäller alla rundor vars datum ligger i
// [startDate, endDate], båda inklusive (dag-granularitet, samma semantik som
// det tidigare inline-filtret i routes/runs.ts).
//
// multiplier_runs: deltat gäller de `charges` första rundorna med datum >=
// startDate, i datumordning. Ingen räknare i databasen muteras — "förbrukning"
// härleds ur löphistoriken, vilket gör att omräkning efter redigering/radering
// alltid ger samma svar. `usedBefore` är antalet kvalificerande rundor som
// ligger FÖRE det fönster som just nu räknas om (anroparen räknar dem i DB).

export type BoostType = 'multiplier_days' | 'multiplier_runs';

export interface BoostSpec {
  type: BoostType;
  /** Additiv på streak-multiplikatorn. Kan vara negativ (förlorar-handikapp). */
  delta: number;
  /** Första dag boosten gäller (YYYY-MM-DD, inklusive). */
  startDate: string;
  /** multiplier_days: sista dag boosten gäller (YYYY-MM-DD, inklusive). */
  endDate?: string | null;
  /** multiplier_runs: totalt antal rundor boosten omfattar. */
  charges?: number | null;
  /** multiplier_runs: rundor som redan förbrukats före beräkningsfönstret. */
  usedBefore?: number;
}

/**
 * Summerat boost-delta per runda.
 * @param runDates rundornas datum (YYYY-MM-DD) i stigande ordning —
 *                 samma ordning som omräkningsloopen processar dem.
 */
export function boostDeltasForRuns(runDates: string[], boosts: BoostSpec[]): number[] {
  const used = boosts.map(b => b.usedBefore ?? 0);

  return runDates.map(date =>
    boosts.reduce((sum, boost, i) => {
      if (boost.type === 'multiplier_days') {
        if (boost.startDate <= date && boost.endDate != null && date <= boost.endDate) {
          return sum + boost.delta;
        }
        return sum;
      }
      // multiplier_runs
      const charges = boost.charges ?? 0;
      if (date >= boost.startDate && used[i] < charges) {
        used[i]++;
        return sum + boost.delta;
      }
      return sum;
    }, 0)
  );
}

// ─── Boostens sparade fönster ────────────────────────────────────────────────────────────────────
//
// Före RUN-355 räknade XP-omräkningen fönstret ur created_at/expires_at som UTC-dygn, duellvyn ur Stockholmsdygn och ett ögonblick, och
// expires_at sattes som nu + n * 24 h. Nu sparas fönstret på raden (user_boosts.start_date/end_date, migration 059) och ALLA läser det:
// XP-omräkningen, boostkortet och sättet nya boostar skrivs.
//
//  - NYA boostar (ägarbeslut 2026-10-20): en dagsboost på n dagar gäller exakt n kalenderdagar i gruppens tidszon, från 00:00 dagen efter
//    duellens sista dag till och med dag n (slutdag = start + n − 1). En rundboost räknar de n första rundorna från samma start.
//  - GAMLA boostar behåller sin XP: migration 059 backfyller deras fönster med exakt det de alltid haft (UTC-dygnen ur created_at och
//    expires_at, n + 1 dagar). En rad utan sparat fönster (skriven av gammal kod under en deploy) läses på samma sätt, så resultatet är
//    detsamma före och efter backfyllet.

/** Raden ur user_boosts som fönstret räknas ur. */
export interface BoostRow {
  type: string;
  created_at: string;
  expires_at: string | null;
  /** Sparad första dag (YYYY-MM-DD). Saknas hos en rad som inte backfyllts än. */
  start_date?: string | null;
  /** Sparad sista dag (YYYY-MM-DD, inklusive). null = ingen slutdag (körboost). */
  end_date?: string | null;
}

export interface BoostWindow {
  /** Första dag boosten gäller (YYYY-MM-DD, inklusive). */
  startDay: string;
  /** Sista dag boosten gäller (YYYY-MM-DD, inklusive). null = ingen slutdag. */
  endDay: string | null;
}

/** Det fönster en boost hade före sparade fönster: UTC-dygnen ur created_at och expires_at. Exakt vad migration 059 backfyller. */
export function legacyBoostWindow(row: BoostRow): BoostWindow {
  return {
    startDay: row.created_at.slice(0, 10),
    endDay: row.expires_at ? row.expires_at.slice(0, 10) : null,
  };
}

/** Boostens fönster: det sparade, eller för en rad utan sparat fönster det gamla UTC-fönstret. */
export function boostWindow(row: BoostRow): BoostWindow {
  if (typeof row.start_date === 'string' && row.start_date !== '') {
    return { startDay: row.start_date, endDay: row.end_date ?? null };
  }
  return legacyBoostWindow(row);
}

/**
 * Kalenderdagar kvar av en dagsboost vid `now`, i gruppens tidszon: hela fönstrets längd före och på startdagen (en ny 3-dagarsboost visar 3),
 * sedan en färre per lokal midnatt, till och med slutdagen; 0 från första midnatten efter slutdagen. null för en boost klienten inte kan
 * räkna på (en körboost, eller en dagsboost utan slut).
 */
export function boostRemaining(row: BoostRow, now: Date, timeZone = STOCKHOLM_TZ): number | null {
  if (row.type !== 'multiplier_days') return null;
  const { startDay, endDay } = boostWindow(row);
  if (endDay === null) return null;
  const today = zoneDay(now, timeZone);
  if (today > endDay) return 0;
  return daysBetween(today > startDay ? today : startDay, endDay) + 1;
}

export interface BoostPlanInput {
  type: string;
  /** Längden: dagar för en dagsboost, antal rundor för en rundboost. */
  days: number | null;
  /** Boostens delta. 0 = en boost utan effekt, som inte behöver en giltig längd. */
  delta: number;
  /** Duellens sista dag (YYYY-MM-DD). Saknas den börjar boosten idag i gruppens tidszon. */
  duelEndDay: string | null;
  now: Date;
  timeZone?: string;
}

export interface BoostPlan {
  startDay: string | null;
  endDay: string | null;
  /** Ögonblicket fönstret slutar: lokal midnatt efter slutdagen. null för en körboost. */
  expiresAt: string | null;
}

const NO_PLAN: BoostPlan = { startDay: null, endDay: null, expiresAt: null };

/**
 * Fönstret för en NY boost. Ren och kastar före allt som skrivs: settleChallenge planerar båda boostarna innan duellen claimas, så ett fel
 * lämnar duellen orörd. RangeError om längden inte är ett heltal på minst 1 för en dag- eller körboost med effekt (delta ≠ 0).
 * En boost som varken är dag- eller körboost (xp_flat), eller en utan effekt och utan giltig längd, får inget fönster.
 */
export function planBoostWindow(input: BoostPlanInput): BoostPlan {
  const { type, days, delta, duelEndDay, now, timeZone = STOCKHOLM_TZ } = input;
  if (type !== 'multiplier_days' && type !== 'multiplier_runs') return NO_PLAN;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
    if (delta === 0) return NO_PLAN;
    throw new RangeError(`Ogiltig boostlängd: ${days}`);
  }
  const startDay = duelEndDay !== null && isCalendarDay(duelEndDay) ? addDays(duelEndDay, 1) : zoneDay(now, timeZone);
  if (type === 'multiplier_runs') return { startDay, endDay: null, expiresAt: null };
  const endDay = addDays(startDay, days - 1);
  return { startDay, endDay, expiresAt: zoneMidnightIso(addDays(endDay, 1), timeZone) };
}
