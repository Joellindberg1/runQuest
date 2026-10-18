// Gruppinställningar: läsning av lagrade rader och sömmen för utskick till gruppen (ADR 012 beslut 6, ADR 011 beslut 2).
//
// Den här filen LÄSER bara group_settings. Skrivningen sker i routes/groupSettings.ts, i samma fil som rollkontrollen
// (actingGroupForWriteOrRespond), så att vakten i scripts/ci-guards.mjs (regel 15) kan kräva att varje skrivning går via den.
import type { SettingChange } from '@runquest/shared';
import type { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';

// Inte exporterad med flit: bara läsningen här använder konstanten. Skrivningen i routes/groupSettings.ts skriver tabellnamnet som en bokstavlig
// sträng, så att vakten (ci-guards regel 15) ser det; vakten fäller också `.from(GROUP_SETTINGS_TABLE)` med skrivmetod i vilken fil som helst.
const GROUP_SETTINGS_TABLE = 'group_settings';

type Db = ReturnType<typeof getSupabaseClient>;
type StoredRow = { key: string; value: unknown };

/**
 * Gruppens lagrade rader som `{ nyckel: värde }`, alltid filtrerade på group_id. Gruppen kommer från anroparen, som tar den ur
 * användarens aktiva medlemskap (aldrig token, URL eller body). Kastar vid databasfel.
 * fromEntries definierar egna fält, så en nyckel som `__proto__` ändrar aldrig prototypen.
 */
export async function readStoredGroupSettings(db: Db, groupId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from(GROUP_SETTINGS_TABLE).select('key, value').eq('group_id', groupId);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as StoredRow[]).map((row) => [row.key, row.value]));
}

/** Det sömmen får när en skrivning faktiskt ändrat gruppens upplösta värden. */
export interface GroupSettingsChangedEvent {
  groupId: string;
  /** Admin som skrev (users.id). */
  actorId: string;
  /** Skillnaden mellan upplösta värden före och efter, i registrets ordning. Aldrig tom. */
  changes: SettingChange[];
  /**
   * ISO-tidsstämpeln som raderna skrevs med (updated_at); samma värde för alla nycklar i skrivningen. Den skiljer olika skrivningar åt men
   * räcker INTE som enda dedupe-underlag: PUT serialiseras per grupp bara inom en process, och sömmen anropas efter låset. Utskicket ska
   * deduplicera på INNEHÅLL (groupId + key + from -> to), inte bara på tid.
   */
  updatedAt: string;
}

/**
 * Sömmen onGroupSettingsChanged (ADR 012 beslut 6.5, ägarbeslut F4): anropas EN gång per skrivning som ändrat ett upplöst värde, aldrig för
 * en skrivning utan ändring. En ändring av en gruppinställning ska gå ut till gruppen som ett gruppsynligt faktum i activity_log.
 *
 * Den som kopplar utskicket (storyn som registrerar den första gruppnyckeln) bygger raden så här, enligt ADR:en:
 *   type        group_setting_changed (reserverad, ligger ännu inte i ACTIVITY_TYPES; vakttestet i shared tvingar fram den)
 *   aktör       actorId; mål null; group_id = groupId
 *   payload     { changes: [{ key, from, to }] }  (icke-känsliga konfigurationsvärden, ingen Strava-rådata)
 *   dedupe_key  group_setting_changed:<groupId>:<updatedAt i ms>:<hash av nycklarna i changes>
 * Dedupe-nyckeln gör att en omspelning av samma skrivning inte ger två nyheter. Utskicksstoryn ska dessutom deduplicera på innehåll
 * (groupId + key + from -> to) och inte bara på tid: updated_at-ms skiljer två skrivningar åt men skyddar inte mot samma ändring som
 * meddelas två gånger om låset per grupp inte gäller (flera instanser, se routes/groupSettings.ts) eller anropen kommer i omvänd ordning.
 *
 * Sömmen ersätts via `createGroupSettingsRouter(definitions, { onGroupSettingsChanged })`; ingen request kan välja den. Den kallas efter
 * att skrivningen lyckats, och ett fel i den får inte göra skrivningen till ett 500 (routen loggar felkoden och går vidare).
 */
export type OnGroupSettingsChanged = (event: GroupSettingsChangedEvent) => void | Promise<void>;

/** Standardsömmen: loggar vad som hände och gör inget mer. Inga värden loggas, bara nycklarna. */
export const logGroupSettingsChange: OnGroupSettingsChanged = ({ groupId, actorId, changes }) => {
  logger.info('📣 group settings changed (no announcement wired yet)', {
    group_id: groupId,
    actor_id: actorId,
    keys: changes.map((change) => change.key),
  });
};
