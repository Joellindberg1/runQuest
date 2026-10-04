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
