// GET /api/titles/leaderboard, GET /api/titles/user/:userId och GET /api/titles/group-eligibility (ADR 012 beslut 8, ADR 007 A).
// Endast typer. Svaren gäller anroparens grupp: rankingen (topp 10) och innehavarna är per grupp, och en användare utan
// grupp får en tom lista. Formerna är oförändrade jämfört med de handskrivna typerna i klienten (fältstil snake_case,
// utom group-eligibility som behåller sina camelCase-fält).
import type { ApiSuccess } from './common.js';

/** Den som innehar eller ligger tvåa/trea på en titel i gruppen. */
export interface TitleStanding {
  user_id: string;
  user_name: string;
  user_gender?: string | null;
  /** Databasen ger null för den som saknar profilbild. */
  profile_picture?: string | null;
  value: number;
  earned_at: string;
}

export interface TitleRunnerUp extends TitleStanding {
  /** 2 eller 3 (position 1 är innehavaren). */
  position: number;
}

/** En titel i katalogen med gruppens innehavare. En titel utan innehavare i gruppen finns kvar med `holder: null`. */
export interface TitleLeaderboardEntry {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  metric_key?: string;
  holder: TitleStanding | null;
  runners_up: TitleRunnerUp[];
}

export interface TitleLeaderboardMeta {
  total_titles: number;
  timestamp: string;
  cache_optimized: boolean;
}

export type TitleLeaderboardResponse = ApiSuccess<TitleLeaderboardEntry[], TitleLeaderboardMeta>;

/**
 * Hur användaren står på en titel i gruppen: `holder` = position 1, `runner_up` = 2–3, `top_10` = 4–10,
 * `participant` = har ett värde men ligger utanför topp 10.
 */
export type UserTitleStatus = 'holder' | 'runner_up' | 'top_10' | 'participant';

export interface UserTitleEntry {
  title_id: string;
  title_name: string;
  title_description: string;
  /** Placering i gruppens topp 10, eller null utanför den. */
  position: number | null;
  value: number;
  earned_at: string;
  is_current_holder: boolean;
  status: UserTitleStatus;
}

export interface UserTitlesMeta {
  user_id: string;
  total_titles: number;
  current_holder_count: number;
  timestamp: string;
}

export type UserTitlesResponse = ApiSuccess<UserTitleEntry[], UserTitlesMeta>;

/** Serverberäknade titelvärden för en gruppmedlem, räknade på rundorna i medlemskapets fönster. `values` nycklas på metric_key. */
export interface GroupEligibilityEntry {
  userId: string;
  name: string;
  gender: string | null;
  values: Record<string, number>;
}

export type GroupEligibilityResponse = ApiSuccess<GroupEligibilityEntry[]>;
