/**
 * activityTypeProbe.ts — delad förkravskontroll för skript som skriver en NY händelsetyp till activity_log (RUN-156, RUN-161).
 *
 * Frågan: tillåter activity_log_type_check i måldatabasen typen? Svaret ges av en testinsert av en rad med den typen och ett
 * slumpat group_id som inte finns (FK activity_log.group_id → groups). Postgres utvärderar CHECK-constrainten FÖRE
 * foreign key-kontrollen, så utfallet säger vad som saknas:
 *   - 23514 / activity_log_type_check  → constrainten avvisar typen (migrationen saknas): 'rejected', inget skrevs.
 *   - 23503 (foreign key)              → CHECK:en släppte igenom typen: 'allowed' via 'foreign_key'; inget skrevs.
 *   - lyckad insert (oväntat)          → raden raderas direkt på sin egen unika testnyckel: 'allowed' via
 *                                        'inserted_and_removed'. Går raderingen inte: 'cleanup_failed'.
 *   - annat fel                        → kan inte verifieras: 'unverifiable'.
 * Valet: kräver ingen RPC eller ny migration, lämnar inga data kvar och går via service-role-klienten.
 *
 * Hjälparen tolkar bara databasens svar. Texten till användaren (vilken migration som saknas, vad som är nästa steg) hör till
 * skriptet som anropar den — därför returneras ett utfall i stället för att kasta.
 */
import { randomUUID } from 'node:crypto';
import type { ActivityType } from '@runquest/shared';
import type { getSupabaseClient } from '../../config/database.js';
import { ACTIVITY_LOG_TABLE } from '../../services/activityLog.js';

type Client = ReturnType<typeof getSupabaseClient>;

export type ActivityTypeProbeVerdict =
  /** CHECK:en tillåter typen. `via` säger hur det syntes. */
  | { kind: 'allowed'; via: 'foreign_key' | 'inserted_and_removed' }
  /** activity_log_type_check avvisar typen: migrationen saknas. Inget skrevs. */
  | { kind: 'rejected' }
  /** Testinserten lyckades men raden kunde inte tas bort igen (nyckeln står i `probeKey`). */
  | { kind: 'cleanup_failed'; probeKey: string; detail: string }
  /** Oväntat fel: det går inte att veta. Inget skrevs. */
  | { kind: 'unverifiable'; detail: string };

/**
 * Kör testinserten för `type`. `keyPrefix` ger testnyckeln ett igenkännbart namn (`<prefix>:<uuid>`), så en eventuell kvarglömd
 * rad går att spåra till skriptet. Kastar inte på databasfel — felet ÄR svaret.
 */
export async function probeActivityType(supabase: Client, type: ActivityType, keyPrefix: string): Promise<ActivityTypeProbeVerdict> {
  const probeKey = `${keyPrefix}:${randomUUID()}`;
  const { error } = await supabase.from(ACTIVITY_LOG_TABLE).insert({
    group_id: randomUUID(), // finns inte i groups → raden kan aldrig bli kvar
    type,
    actor_user_id: null,
    target_user_id: null,
    payload: {},
    payload_version: 1,
    dedupe_key: probeKey,
    is_backfill: false,
  });

  if (!error) {
    // Oväntat: FK:n släppte igenom. Städa vår egen testrad (unik nyckel) och godkänn — CHECK:en tillät typen.
    const cleanup = await supabase.from(ACTIVITY_LOG_TABLE).delete().eq('dedupe_key', probeKey);
    if (cleanup.error) return { kind: 'cleanup_failed', probeKey, detail: cleanup.error.message };
    return { kind: 'allowed', via: 'inserted_and_removed' };
  }
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  if (error.code === '23514' || /activity_log_type_check/.test(text)) return { kind: 'rejected' };
  if (error.code === '23503' || /foreign key/i.test(text)) return { kind: 'allowed', via: 'foreign_key' };
  return { kind: 'unverifiable', detail: text.trim() };
}
