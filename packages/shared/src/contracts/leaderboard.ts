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

// GET /api/leaderboard/positions (ADR 007 B11): placering i total-XP-ordningen vid slutet av varje vecka, härledd bakåt ur total_xp.
// Konstanter och fältnamn ändras bara additivt (webb och kommande PWA läser dem). Dagar är i gruppens tidszon.
export const POSITION_WEEKS_DEFAULT = 8;
export const POSITION_WEEKS_MAX = 26;

export interface PositionWeek {
  /** Måndag, YYYY-MM-DD i gruppens tidszon. */
  start: string;
  /** Söndag. */
  end: string;
  /** 1–53, isoWeekNumber(start). */
  iso_week: number;
  /** ISO-veckans år, isoWeekYear(start); skiljer sig från start-året runt årsskiftet. */
  iso_year: number;
  /** Sant för sista elementet, falskt för alla andra. */
  is_current_week: boolean;
}

export interface PositionRunner {
  user_id: string;
  name: string;
  profile_picture: string | null;
  /** Dagen kontot skapades i gruppens tidszon (users.created_at); null = okänt. */
  member_since: string | null;
  /** Parallell med `weeks`: positions[i] hör till weeks[i]. 1-baserad; null = ingen placering (före inträdet). Sista elementet är live-placeringen = Standings. */
  positions: Array<number | null>;
}

export interface PositionHistoryResponse {
  /** Gruppens "idag" (YYYY-MM-DD). */
  as_of: string;
  /** Äldst först; sista = pågående vecka. */
  weeks: PositionWeek[];
  /** Sorterad på live-placeringen stigande = Standings ordning. */
  runners: PositionRunner[];
}

export type PositionHistoryApiResponse = ApiSuccess<PositionHistoryResponse>;
