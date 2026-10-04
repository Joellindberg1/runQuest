// GET /api/events och /api/events/history (ADR 007 B7–B8).
// Befintliga endpoints behåller nyckeln `events` och camelCase (ADR 007 A2); fälten nedan är additiva.
import type { OffsetPageMeta } from './common.js';

export type EventType = 'competition' | 'participation';

export interface EventTemplateInfo {
  name: string;
  icon: string;
  description: string;
  minKm: number;
  rewardXp: number;
  rewardXp1st: number;
  rewardXp2nd: number;
  rewardXp3rd: number;
  requiresWeather?: string | null;
}

export interface EventMyEntry {
  qualified: boolean;
  qualifiedAt: string | null;
  rank: number | null;
  xpAwarded: number | null;
  totalValue: number | null;
}

export interface EventLeaderboardRow {
  userId: string;
  userName: string;
  totalValue: number;
  rank: number | null;
  isMe: boolean;
  xpAwarded?: number | null;
  qualified?: boolean;
}

export interface EventCounts {
  /** Antal deltagare (distinkta användare med event_entries) — nu för ALLA eventtyper. */
  participantCount: number;
  /** Antal användare i gruppen ("4 of 6 finished it"). */
  memberCount: number;
}

export interface EventItem extends EventCounts {
  id: string;
  type: EventType;
  metric: string;
  status: string;
  startsAt: string;
  endsAt: string;
  template: EventTemplateInfo;
  myEntry: EventMyEntry | null;
  leaderboard: EventLeaderboardRow[] | null;
}

export interface EventsResponse {
  events: EventItem[];
}

export interface EventsHistoryResponse {
  events: EventItem[];
  /** Additivt block (ADR 007 A2/A5). */
  meta: OffsetPageMeta;
}
