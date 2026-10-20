import { STOCKHOLM_TZ, addDays, daysBetween, wallClockToInstantMs, zoneClock, zoneDay } from './calendar.js';

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

// ─── Fönstret i gruppens dygn ────────────────────────────────────────────────────────────────────
//
// Före RUN-355 hade boostfönstret fyra betydelser: backend räknade UTC-dygn (created_at.slice(0, 10)), duellvyn Stockholmsdygn och ett
// ögonblick, nyhetsflödet ett ögonblick, och expires_at sattes som nu + n * 24 h. En boost skapad 00-02 svensk tid fick olika startdag i
// XP-beräkningen och i UI:t. Nu finns EN definition här, i gruppens tidszon (groupTimeZone), och backend och frontend läser samma.
//
// Längden är oförändrad: n + 1 kalenderdagar, båda ändarna inklusive (skapad dag D, slutdag D + n). En boost vars start och slut inte
// ligger på olika dag i UTC och Stockholm får därför exakt samma fönster som förut; bara en boost skapad 00-02 svensk tid flyttar.

/** Raden ur user_boosts som fönstret räknas ur. */
export interface BoostRow {
  type: string;
  created_at: string;
  expires_at: string | null;
}

export interface BoostWindow {
  /** Första dag boosten gäller (YYYY-MM-DD, inklusive), dagen den skapades i gruppens zon. */
  startDay: string;
  /** Sista dag boosten gäller (YYYY-MM-DD, inklusive), dagen expires_at ligger på i gruppens zon. null = ingen slutdag. */
  endDay: string | null;
}

/** Boostens första och sista dag i `timeZone` (gruppens). En körboost har ingen slutdag; den förbrukas av rundorna. */
export function boostWindow(row: BoostRow, timeZone = STOCKHOLM_TZ): BoostWindow {
  return {
    startDay: zoneDay(new Date(row.created_at), timeZone),
    endDay: row.expires_at ? zoneDay(new Date(row.expires_at), timeZone) : null,
  };
}

/**
 * Kalenderdagar kvar av en dagsboost vid `now`, idag inräknad, till och med slutdagen; 0 från första midnatten efter slutdagen.
 * null för en boost klienten inte kan räkna på (en körboost, eller en dagsboost utan slut). Samma fönster som XP-beräkningen, så
 * UI:t visar aldrig en boost som slutat gälla eller döljer en som fortfarande ger XP.
 */
export function boostRemaining(row: BoostRow, now: Date, timeZone = STOCKHOLM_TZ): number | null {
  if (row.type !== 'multiplier_days') return null;
  const { startDay, endDay } = boostWindow(row, timeZone);
  if (endDay === null) return null;
  const today = zoneDay(now, timeZone);
  if (today > endDay) return 0;
  return daysBetween(today > startDay ? today : startDay, endDay) + 1;
}

/**
 * expires_at för en dagsboost med längden `days`: samma väggklocka som `createdAt`, `days` kalenderdagar senare i `timeZone`. Då är
 * slutdagen alltid startdag + days (fönstret n + 1 dagar) även över ett sommartidsskifte, där createdAt + days * 24 h kan hamna en
 * dag för sent för en boost skapad nära midnatt. RangeError om längden inte är ett heltal på minst 0.
 */
export function boostExpiresAt(createdAt: Date, days: number, timeZone = STOCKHOLM_TZ): string {
  if (!Number.isInteger(days) || days < 0) throw new RangeError(`Ogiltig boostlängd: ${days}`);
  const { date, msIntoDay } = zoneClock(createdAt, timeZone);
  const seconds = Math.floor(msIntoDay / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  const ms = wallClockToInstantMs(`${addDays(date, days)}T${clock}Z`, timeZone);
  if (Number.isNaN(ms)) throw new RangeError(`Ogiltigt boostslut: ${date} + ${days} dagar i ${timeZone}`);
  return new Date(ms).toISOString();
}
