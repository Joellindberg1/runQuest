// GET /api/runs/group-history, POST /api/runs, PUT /api/runs/:id och DELETE /api/runs/:id (ADR 007 B9–B10, A2).
// Befintliga endpoints behåller nyckeln `runs`/`run` och snake_case; fälten nedan är additiva.
import type { OffsetPageMeta } from './common.js';

/**
 * En rad ur `runs` som servern skickar (users-with-runs, POST- och PUT-svaren). Vilka kolumner som följer med beror på route: PUT-svaret läser
 * inte `is_treadmill`, och de utökade Strava-fälten (från `moving_time`) skickas ingen route ännu, men raden bär dem när de väljs.
 * Delas av backend och klient; `Run` i @runquest/types är samma typ.
 */
export interface RunRow {
  id: string;
  user_id: string;
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
  base_xp: number;
  km_xp: number;
  distance_bonus: number;
  streak_bonus: number;
  /**
   * Ursprung: 'manual' (default) eller 'strava'. Med i users-with-runs sedan i9 (additivt). Profile blockerar
   * Delete för 'strava'-rundor — DELETE saknar gravsten och synken återimporterar inom 7-dagarsfönstret
   * (open-assumptions, backend-fråga 6). null/saknas = äldre rad → behandla som 'manual'.
   */
  source?: string | null;
  external_id?: string | null;
  // Extended Strava data — all nullable (not all devices/users share this)
  start_time?: string | null;
  /** När raden skapades (users-with-runs, ADR 007 B3): "X h ago" för manuellt loggade rundor utan start_time. */
  created_at?: string | null;
  moving_time?: number | null;
  total_elevation_gain?: number | null;
  sport_type?: string | null;
  avg_heartrate?: number | null;
  max_heartrate?: number | null;
  suffer_score?: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  pace_std_dev?: number | null;
  is_treadmill?: boolean | null;
}

export interface GroupRunHistoryItem {
  id: string;
  user_id: string;
  /** Kalenderdag YYYY-MM-DD (Stockholm). */
  date: string;
  distance: number;
  xp_gained: number;
  multiplier: number;
  streak_day: number;
  base_xp: number;
  km_xp: number;
  distance_bonus: number;
  streak_bonus: number;
  source?: string;
  /** null = okänt (manuella rundor före/utan flaggan). */
  is_treadmill: boolean | null;
  weather_code: number | null;
  temperature_c: number | null;
  user_name: string;
  user_level: number;
  user_total_xp: number;
  user_profile_picture?: string;
  /** ISO-8601 UTC; satt av Strava-importen. */
  start_time: string | null;
  /** ISO-8601 UTC; radens skapandetid. */
  created_at: string | null;
}

export interface GroupRunHistoryResponse {
  runs: GroupRunHistoryItem[];
  meta: OffsetPageMeta;
}

/**
 * Brödtext till POST /api/runs. `Idempotency-Key` (uuid v4) skickas som header, inte här.
 * Servern äger `source` ('manual'): ett `source` i brödtexten ignoreras, så typen har inget sådant fält.
 */
export interface CreateRunRequest {
  date: string;
  distance: number;
  /** Utelämnat → kolumnen förblir NULL (oförändrat beteende). Annan typ än boolean → 400. */
  is_treadmill?: boolean;
}

/** Det POST /api/runs skickar som `run` när rundan skapades men inte gick att läsa tillbaka (felet varnas i loggen): bara id. */
export type RunIdOnly = Pick<RunRow, 'id'>;

/**
 * Svar från POST /api/runs: rundan efter omräkningen, eller bara dess id (`RunIdOnly`) om återläsningen föll. Läsaren måste därför kontrollera formen
 * (`'xp_gained' in run`) innan den läser siffrorna. En upprepning med samma Idempotency-Key ger samma form med den först skapade rundan.
 */
export interface CreateRunResponse {
  success: true;
  message: string;
  run: RunRow | RunIdOnly;
}

/**
 * Brödtext till PUT /api/runs/:id. `date` utelämnas när datumet inte ändrats — en ren distansändring ska inte falla på serverns datumvalidering
 * (UTC-"idag"). Servern kräver `distance` och ignorerar alla andra nycklar.
 */
export interface UpdateRunRequest {
  date?: string;
  distance: number;
}

/** Svar från PUT /api/runs/:id: rundan efter omräkningen, eller null om den inte gick att läsa tillbaka. `is_treadmill` ingår inte. */
export interface UpdateRunResponse {
  success: true;
  message: string;
  run: RunRow | null;
}

/** Svar från DELETE /api/runs/:id. */
export interface DeleteRunResponse {
  success: true;
  message: string;
}
