/**
 * Tempo och summerad tid på ETT ställe (ADR 007, addendum 2026-10-26). Ren modul: ingen klocka, ingen I/O.
 * Klienterna (webb, mobil, vymodeller) har ingen egen division av tid med distans; de anropar funktionerna här.
 * Formatering (m:ss) bor i frontendens format.ts, inte här.
 */

/** Den minsta runda som funktionerna behöver. `moving_time` är sekunder, `null` för löpband och manuella rundor. */
export interface TimedRun {
  moving_time: number | null | undefined;
  distance_km: number;
}

export interface RunTimeSummary {
  total_seconds: number;
  distance_km: number;
  /** Heltals-sekunder per km, `null` när ingen runda har både giltig tid och distans. */
  pace_sec_per_km: number | null;
  runs_with_time: number;
  runs_total: number;
}

const isPositiveFinite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** `Math.round(tid / distans)`, eller `null` när tiden eller distansen saknas, inte är ändlig eller är ≤ 0. */
export function paceSecPerKm(
  movingTimeSeconds: number | null | undefined,
  distanceKm: number | null | undefined,
): number | null {
  if (!isPositiveFinite(movingTimeSeconds) || !isPositiveFinite(distanceKm)) return null;
  const pace = Math.round(movingTimeSeconds / distanceKm);
  return Number.isFinite(pace) ? pace : null;
}

/**
 * Summerar tid och distans över rundor med giltig tid och distans > 0. Rundor utan tid räknas inte i distansen
 * (annars blir tempot för högt). Tempot räknas på de ej avrundade summorna, inte som snitt av rundornas tempon.
 */
export function summariseRunTime(runs: readonly TimedRun[]): RunTimeSummary {
  let totalSeconds = 0;
  let distanceKm = 0;
  let runsWithTime = 0;
  for (const run of runs) {
    if (!isPositiveFinite(run.moving_time) || !isPositiveFinite(run.distance_km)) continue;
    totalSeconds += run.moving_time;
    distanceKm += run.distance_km;
    runsWithTime += 1;
  }
  return {
    total_seconds: totalSeconds,
    distance_km: distanceKm,
    pace_sec_per_km: paceSecPerKm(totalSeconds, distanceKm),
    runs_with_time: runsWithTime,
    runs_total: runs.length,
  };
}
