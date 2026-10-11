// GET /api/badges/user/:userId och GET /api/badges/group (ADR 009 beslut 4). Fältstil snake_case.
// Seriernycklar och tier-tal är desamma som i packages/shared/src/badges.ts; lagringen är en rad per
// (användare, serie) = bästa tier just nu.
import type { ApiSuccess } from './common.js';

export interface BadgeUserItem {
  /** Nyckel ur BADGE_SERIES. */
  series: string;
  /** Bästa tier just nu, 1..MAX_TIER. */
  tier: number;
  /** ISO-8601 UTC — när NUVARANDE tier uppnåddes. */
  earned_at: string;
  /** Popup-vattenmärke (tier > seen_tier = oviset). Finns bara när anroparen frågar om sig själv. */
  seen_tier?: number;
}

export interface BadgeUserResponse {
  /** Ägda serier i BADGE_SERIES-ordning; låsta serier ingår inte. */
  items: BadgeUserItem[];
  /** Valda badges (max 3), skurna mot ägda serier, i sparad ordning. */
  showcase: string[];
}

export interface BadgeShowcaseEntry {
  series: string;
  tier: number;
}

export interface BadgeGroupMember {
  user_id: string;
  /** Som BadgeUserResponse.showcase men med tier; tom när inget är valt/ägt. */
  showcase: BadgeShowcaseEntry[];
}

export interface BadgeGroupResponse {
  /** Alla gruppens medlemmar (även utan badges), sorterade på user_id. */
  members: BadgeGroupMember[];
  /**
   * `holders[serie][tier]` = antal i gruppen med tier eller högre (tier 3 räknas i 1–3). Fullständigt
   * rutnät: alla kända serier x tier 1..MAX_TIER, nollor inkluderade (JSON-nycklarna är tier som sträng).
   * Visas inte på låsta kort (frontendens sak).
   */
  holders: Record<string, Record<string, number>>;
}

export interface BadgeGroupMeta {
  member_count: number;
}

export type BadgeUserApiResponse = ApiSuccess<BadgeUserResponse>;
export type BadgeGroupApiResponse = ApiSuccess<BadgeGroupResponse, BadgeGroupMeta>;

// PUT /api/badges/showcase och POST /api/badges/seen (ADR 009 beslut 4 och 5).

export interface ShowcaseRequest {
  /** Valda serier i visningsordning: högst MAX_SHOWCASE, unika, kända och ägda av anroparen — annars 400. [] rensar. */
  series: string[];
}

export interface ShowcaseResponse {
  /** Det sparade valet, i angiven ordning (samma form som BadgeUserResponse.showcase). */
  showcase: string[];
}

export interface SeenRequest {
  /** Serier som ska markeras som sedda. Utelämnad = alla anroparens serier; [] = inga. Okänd serie → 400. */
  series?: string[];
}

export interface SeenResponse {
  /** Serier vars seen_tier höjdes av just det här anropet (i BADGE_SERIES-ordning); [] vid upprepat anrop. */
  updated: string[];
}

export type ShowcaseApiResponse = ApiSuccess<ShowcaseResponse>;
export type SeenApiResponse = ApiSuccess<SeenResponse>;
