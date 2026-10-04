// GET /api/leaderboard/week och /api/leaderboard/rank-delta (ADR 007 B1–B2).
// Fältstil snake_case. Kalenderdagar är YYYY-MM-DD i Stockholm-tid, veckan är mån–sön.
import type { ApiSuccess } from './common.js';

export interface WeekDay {
  date: string;
  km: number;
  xp: number;
  runs: number;
}

export interface WeekLeaderboardUser {
  user_id: string;
  name: string;
  profile_picture: string | null;
  level: number;
  km: number;
  runs: number;
  /** Σ runs.xp_gained för veckan. Event-XP ingår INTE (ADR 007 B1). */
  xp: number;
  /** 7 st, måndag–söndag. */
  days: WeekDay[];
  /** Rank = (xp desc, km desc, name asc) över alla gruppmedlemmar. */
  rank: number;
  /** null om användaren skapades efter förra veckans start. */
  previous_rank: number | null;
  /** previous_rank − rank; positivt = klättrat. null om previous_rank är null. */
  rank_delta: number | null;
}

export interface WeekLeaderboardTotals {
  km: number;
  runs: number;
  xp: number;
  /** Medlemmar med minst en runda veckan. */
  active_runners: number;
  members: number;
  /** Additivt (utöver ADR 007:s ursprungsform): gruppens bästa vecka någonsin i km (inkl. aktuell vecka). */
  best_week_km: number;
  /** Additivt: veckans km i % av best_week_km (0–100, avrundat); null om best_week_km är 0. */
  pct_of_best_week: number | null;
}

export interface WeekLeaderboardResponse {
  week: {
    start: string;
    end: string;
    previous_start: string;
    is_current: boolean;
    today: string;
  };
  /** Sorterad på rank stigande. */
  users: WeekLeaderboardUser[];
  totals: WeekLeaderboardTotals;
  /** Störst positivt rank_delta (tie → högst xp); null om ingen klättrat eller förra veckan saknar rundor. */
  mover: { user_id: string; rank_delta: number } | null;
}

export type WeekLeaderboardApiResponse = ApiSuccess<WeekLeaderboardResponse>;

export interface RankDeltaUser {
  user_id: string;
  /** users.total_xp — samma värde som Board sorterar på. */
  xp: number;
  rank: number;
  /** total_xp − XP krediterad sedan veckostart (runda- + event-XP). */
  previous_xp: number;
  /** null om användaren skapades på/efter veckostart. */
  previous_rank: number | null;
  /** previous_rank − rank; positivt = klättrat. */
  rank_delta: number | null;
}

export interface RankDeltaResponse {
  /** Veckans måndag (Stockholm) = jämförelsepunkt. */
  as_of: string;
  /** Sorterad på rank stigande. */
  users: RankDeltaUser[];
}

export type RankDeltaApiResponse = ApiSuccess<RankDeltaResponse>;
