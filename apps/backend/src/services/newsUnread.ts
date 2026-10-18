// Oläst-räknaren för klockan (ADR 011 beslut 4), delad av GET /news och POST /news/seen.
//
// Slaget beror på `payload` och inställningarna, så predikatet körs i appen med EN ren funktion i shared
// (`isNotifiable`, samma som klientens popover) och inte som SQL-filter. Tre läsningar går parallellt:
// kandidatraderna (de 501 senaste ovanför golvet), användarens news_read-id:n ovanför golvet och användarens
// inställningar. `/news` returnerar fortfarande ALLA rader; inställningarna styr bara klockan.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { ACTIVITY_LOG_TABLE } from './activityLog.js';
import { readStoredSettings } from './userSettings.js';
import {
  isNotifiable,
  resolveSettings,
  UNREAD_CAP,
  type NotifiableRow,
  type NotifyViewer,
} from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';

// Taket bor i shared (fejken i frontend delar det); återexporteras här för de som redan importerar det härifrån.
export { UNREAD_CAP };

export const NEWS_READ_TABLE = 'news_read';

/** Läsarens golv och registreringstid (users.news_last_seen_id, users.created_at). */
export interface Reader {
  news_last_seen_id: number | null;
  created_at: string | null;
}

/**
 * En activity_log-rad som den kommer ur databasen. `id` är `number | string` eftersom supabase-js kan ge en
 * bigint-kolumn som sträng. Sidans rader och kandidatraderna väljer båda alla de här kolumnerna, så en och samma
 * mappning gäller för båda (kandidaternas SQL-filter på backfill och created_at kontrolleras alltså om i appen).
 */
export interface CandidateRow {
  id: number | string;
  type: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  payload: unknown;
  is_backfill: boolean | null;
  created_at: string;
}

const CANDIDATE_COLUMNS = 'id, type, actor_user_id, target_user_id, payload, is_backfill, created_at';

export function toNotifiableRow(row: CandidateRow): NotifiableRow {
  return {
    id: Number(row.id),
    type: row.type,
    actorId: row.actor_user_id,
    targetId: row.target_user_id,
    payload: row.payload,
    // Bara exakt false är "inte backfill"; null (saknad flagga) räknas som backfill, som isNotifiable kräver.
    isBackfill: row.is_backfill !== false,
    createdAt: row.created_at,
  };
}

/** Är raden oläst för betraktaren? Samma predikat för sidans `is_unread` och för räknaren. */
export function isRowUnread(row: CandidateRow, viewer: NotifyViewer): boolean {
  return isNotifiable(toNotifiableRow(row), viewer);
}

export interface UnreadState {
  /** Betraktaren som `isRowUnread` behöver för sidans rader. */
  viewer: NotifyViewer;
  /** Antal olästa notiser bland kandidaterna, högst UNREAD_CAP. */
  unreadCount: number;
}

async function readCandidates(groupId: string, reader: Reader): Promise<CandidateRow[]> {
  let query = getSupabaseClient()
    .from(ACTIVITY_LOG_TABLE)
    .select(CANDIDATE_COLUMNS)
    .eq('group_id', groupId)
    .eq('is_backfill', false)
    .gt('id', reader.news_last_seen_id ?? 0)
    .order('id', { ascending: false })
    .limit(UNREAD_CAP + 1);
  // Utan created_at kan ingen rad vara "efter registreringen"; isNotifiable ger då false för alla.
  if (reader.created_at) query = query.gt('created_at', reader.created_at);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CandidateRow[];
}

async function readReadIds(userId: string, reader: Reader): Promise<Set<number>> {
  const { data, error } = await getSupabaseClient()
    .from(NEWS_READ_TABLE)
    .select('activity_id')
    .eq('user_id', userId)
    .gt('activity_id', reader.news_last_seen_id ?? 0)
    // Samma fönster som kandidaterna: de senaste raderna. Äldre kvitton hör till rader utanför räknaren, och
    // PostgREST skulle annars tyst kapa vid sitt eget tak (äldsta först) och släppa just de kvitton som behövs.
    .order('activity_id', { ascending: false })
    .limit(UNREAD_CAP + 1);
  if (error) throw error;
  return new Set((data ?? []).map((r: { activity_id: number | string }) => Number(r.activity_id)));
}

/**
 * Anroparens inställningar upplösta mot registret. Ett läsfel ska inte ta ner klockan: defaults gäller (alla slag på)
 * och felet loggas. Det är medvetet mildare än news_read, vars fel ger 500 eftersom ett saknat kvitto skulle visa
 * redan lästa rader som olästa.
 */
async function readSettings(userId: string): Promise<Record<string, unknown>> {
  let stored: Record<string, unknown> = {};
  try {
    stored = await readStoredSettings(getSupabaseClient(), userId);
  } catch (error) {
    logger.error(`❌ Kunde inte läsa user_settings, använder defaults för oläst-räknaren (${errorCode(error)})`);
  }
  return resolveSettings(stored, 'user', undefined, ({ key, reason }) =>
    logger.warn(`⚠️ Lagrad inställning ignoreras (${reason}): ${key}`),
  );
}

/** Läser kandidater, news_read och inställningar parallellt och räknar olästa notiser (högst UNREAD_CAP). */
export async function loadUnreadState(groupId: string, userId: string, reader: Reader): Promise<UnreadState> {
  const [candidates, readIds, settings] = await Promise.all([
    readCandidates(groupId, reader),
    readReadIds(userId, reader),
    readSettings(userId),
  ]);
  const viewer: NotifyViewer = {
    id: userId,
    createdAt: reader.created_at ?? '',
    floor: reader.news_last_seen_id,
    readIds,
    settings,
  };
  const unread = candidates.reduce((n, row) => (isRowUnread(row, viewer) ? n + 1 : n), 0);
  return { viewer, unreadCount: Math.min(unread, UNREAD_CAP) };
}
