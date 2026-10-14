// Kvitton per rad (ADR 011 beslut 4): validering av POST /news/read, skrivning till news_read och rensning under golvet.
// Själva oläst-räkningen ligger kvar i newsUnread.ts; den här filen äger bara skrivsidan av tabellen.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { ACTIVITY_LOG_TABLE } from './activityLog.js';
import { NEWS_READ_TABLE } from './newsUnread.js';

/** Postgres foreign_key_violation: raden i activity_log togs bort (retract) mellan uppslagningen och skrivningen. */
const FOREIGN_KEY_VIOLATION = '23503';

/** Så många id:n får ett anrop innehålla (ADR 011 beslut 4). Klientens buntning (READ_FLUSH_MS) håller sig under det. */
export const MAX_READ_IDS = 50;

/** id:n ur en request-kropp, eller null om formen inte är { ids: 1–50 unika positiva säkra heltal }. */
export function parseReadIds(body: unknown): number[] | null {
  const ids = (body as { ids?: unknown } | null | undefined)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_READ_IDS) return null;
  if (!ids.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids as number[];
}

/**
 * De av `ids` som finns i gruppen och ligger över golvet. Övriga (annan grupp, finns inte, på eller under golvet) tappas
 * tyst, så att svaret aldrig avslöjar om ett id existerar och en FK-krasch aldrig fäller hela batchen.
 * `activity_log.id` är bigint och kan komma som sträng ur PostgREST, därför Number().
 */
export async function idsInGroupAboveFloor(groupId: string, ids: number[], floor: number): Promise<number[]> {
  const { data, error } = await getSupabaseClient()
    .from(ACTIVITY_LOG_TABLE)
    .select('id')
    .eq('group_id', groupId)
    .gt('id', floor)
    .in('id', ids);
  if (error) throw error;
  return (data ?? []).map((r: { id: number | string }) => Number(r.id));
}

/** Kvitterar raderna för användaren. Redan kvitterade rader ger ingenting (idempotent). Kastar vid databasfel. */
export async function markRowsRead(userId: string, activityIds: number[]): Promise<void> {
  if (activityIds.length === 0) return;
  const { error } = await getSupabaseClient()
    .from(NEWS_READ_TABLE)
    .upsert(
      activityIds.map((activity_id) => ({ user_id: userId, activity_id })),
      { onConflict: 'user_id,activity_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/**
 * Slår upp och kvitterar raderna. Om en rad återkallas (retract) mellan uppslagningen och skrivningen fäller FK:n (23503)
 * hela batchen; då görs uppslagningen och skrivningen om en gång, så att de rader som finns kvar ändå kvitteras. Faller även
 * andra försöket är det ett no-op (raden försvinner av sig själv): inget fel kastas. Alla andra fel kastas.
 */
export async function acknowledgeRows(groupId: string, userId: string, ids: number[], floor: number): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const valid = await idsInGroupAboveFloor(groupId, ids, floor);
    try {
      await markRowsRead(userId, valid);
      return;
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== FOREIGN_KEY_VIOLATION) throw error;
      if (attempt === 2) logger.warn('⚠️ news_read: raden återkallades under skrivningen, ingen kvittering sparades (ofarligt)');
    }
  }
}

/**
 * Raderar användarens kvitton på eller under golvet: rader under golvet är redan lästa, så kvittot är inert. Golvet är den
 * enda städningen av tabellen (revisit-trigger i ADR 011: > 1 000 rader per användare). Best-effort: ett fel loggas och
 * kastas inte, eftersom kvarlämnade rader är ofarliga och skrivningen före den redan lyckats.
 */
export async function pruneReadReceipts(userId: string, floor: number | null): Promise<void> {
  if (floor === null) return;
  try {
    const { error } = await getSupabaseClient()
      .from(NEWS_READ_TABLE)
      .delete()
      .eq('user_id', userId)
      .lte('activity_id', floor);
    if (error) throw error;
  } catch (error) {
    logger.error('❌ Kunde inte rensa news_read under golvet (ofarligt, rensas vid nästa anrop):', error);
  }
}
