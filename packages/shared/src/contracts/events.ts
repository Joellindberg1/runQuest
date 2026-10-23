// GET /api/events och /api/events/history (ADR 007 B7–B8).
// Befintliga endpoints behåller nyckeln `events` och camelCase (ADR 007 A2); fälten nedan är additiva. Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20): `success` och
// `data` ligger bredvid `events` (dubbelsvar, DualEnvelope) tills steg 2 (RUN-364) tar bort den gamla toppnivånyckeln; innanför `data` är fältstilen oförändrad.
import type { DualEnvelope, OffsetPageMeta } from './common.js';

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
  /** Medlemmens riktiga namn, aldrig ett lokaliserat ("Du"). `isMe` markerar anroparens rad och klienten skriver själv "You"; ingen utgiven bundle har läst "Du". */
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

/** Svar från GET /api/events: `{ success, events, data: { events } }`. Utan grupp eller utan events: 200 med tom lista. */
export type EventsResponse = DualEnvelope<{ events: EventItem[] }>;

/** Svar från GET /api/events/history: `{ success, events, data: { events }, meta }`. `meta` ligger på toppnivå (ADR 007 A2/A5). */
export type EventsHistoryResponse = DualEnvelope<{ events: EventItem[] }, { events: EventItem[] }, OffsetPageMeta>;

/**
 * Svar från POST /api/events/admin/trigger-daily-draw (admin): utfallet av den dagliga lottningen. Ingen kuvert (äldre endpoint, ADR 007 A2).
 * Samma form som schedulern loggar: `fired` = ett event skapades, `picked` = dess namn, `pool` = kandidaterna med vikt och andel.
 */
export interface DailyDraw {
  fired: boolean;
  picked: string | null;
  stormQualifies: boolean;
  totalWeight: number;
  pool: Array<{ name: string; weight: number; sharePct: number }>;
}

/** Svar från POST /api/events/admin/trigger-daily-draw: lottningens utfall på toppnivå (gammal klient) och i `data` (ny klient). */
export type DailyDrawResponse = DualEnvelope<DailyDraw>;
