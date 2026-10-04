// GET /api/runs/group-history och POST /api/runs (ADR 007 B9–B10).
// Befintliga endpoints behåller nyckeln `runs` och snake_case; fälten nedan är additiva.
import type { OffsetPageMeta } from './common.js';

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

export interface CreateRunRequest {
  date: string;
  distance: number;
  source?: string;
  /** Utelämnat → kolumnen förblir NULL (oförändrat beteende). Annan typ än boolean → 400. */
  is_treadmill?: boolean;
}
