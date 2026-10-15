// Läsning av en användares lagrade inställningar (ADR 011 beslut 2), delad av GET/PUT /api/settings och
// oläst-räknaren i newsUnread. En källa för tabellnamnet och för hur raderna blir ett objekt.
import type { getSupabaseClient } from '../config/database.js';

export const USER_SETTINGS_TABLE = 'user_settings';

type Db = ReturnType<typeof getSupabaseClient>;
type StoredRow = { key: string; value: unknown };

/**
 * Anroparens egna rader som `{ nyckel: värde }`, alltid filtrerade på user_id. Kastar vid databasfel: anroparen avgör
 * om felet är ett 500 (settings-routen) eller ska falla tillbaka på defaults (oläst-räknaren).
 * fromEntries definierar egna fält, så en nyckel som `__proto__` ändrar aldrig prototypen.
 */
export async function readStoredSettings(db: Db, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from(USER_SETTINGS_TABLE).select('key, value').eq('user_id', userId);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as StoredRow[]).map((row) => [row.key, row.value]));
}
