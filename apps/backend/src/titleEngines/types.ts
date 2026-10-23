export interface RunData {
  date: string;
  distance_km: number;
  start_time?: string | null;
  total_elevation_gain?: number | null;
  /** Löpband (runs.is_treadmill); true ger 0 höjdmeter i titlarna (countedElevationGain). null/saknas = utomhus. */
  is_treadmill?: boolean | null;
  pace_std_dev?: number | null;
  moving_time?: number | null;
  /** Väder vid rundan (run_weather). null = ingen väderrad (inomhus, utan koordinater eller ännu inte hämtad). */
  temperature_c?: number | null;
  wind_speed_ms?: number | null;
  wind_gusts_ms?: number | null;
}

export interface UserStats {
  totalKm: number;
  longestStreak: number;
}

/**
 * Sådant motorerna inte ska läsa ur globala tillstånd. `now` injiceras så att tidsberoende motorer
 * (t.ex. Winter Warrior) går att testa; en omräkningskörning delar ett och samma `now` för alla användare.
 */
export interface TitleContext {
  now: Date;
}

export interface TitleEngine {
  metricKey: string;
  /** `ctx` är valfri: motorer som inte behöver den ignorerar den (de 21 första gör det). */
  calculate(runs: RunData[], userStats: UserStats, ctx?: TitleContext): number;
}
