// Settings Routes (ADR 011 beslut 2 och 8) — användarinställningar, en rad per nyckel i user_settings.
// ADR 007 A: { success, data, meta? } / { error }, snake_case, typer i shared/contracts/settings.
//
// Inställningar hör till användaren, inte gruppen: raderna filtreras alltid på token-användarens user_id, aldrig på
// group_id. En token utan group_id (inaktuell efter groups/join) har alltså fortfarande sina inställningar, och
// groupIdOrRespondEmpty (ADR 007 A6) ska INTE användas här. Det är inte ett fail-closed-hål: det finns inget gruppfilter
// som kan falla bort, och ingen annan användares rad kan nås eftersom varje fråga bär `.eq('user_id', …)`.
//
// PUT svarar med nuläget efter skrivningen, läst på nytt. Lyckas skrivningen men läsningen efter den misslyckas blir
// svaret 500 trots att ändringen är sparad; klienten ska då läsa om med GET i stället för att anta att inget hände.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import { USER_SETTINGS_TABLE, readStoredSettings } from '../services/userSettings.js';
import {
  SETTING_DEFINITIONS,
  customisedKeys,
  resolveSettings,
  sanitizePatch,
  type ApiError,
  type SettingDefinition,
  type SettingsApiResponse,
} from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';

const TABLE = USER_SETTINGS_TABLE;

/**
 * Reglage trycks i följd, så gränsen ska aldrig märkas vid riktig användning: 60 skrivningar per minut och IP
 * (limiterns nyckel). Den stoppar bara ett skript som hamrar på tabellen.
 */
const PUT_WINDOW_MS = 60 * 1000;
const PUT_MAX_PER_WINDOW = 60;

const readStored = (userId: string): Promise<Record<string, unknown>> => readStoredSettings(getSupabaseClient(), userId);

/**
 * Routern byggs av en fabrik så att ett test kan ge den ett annat register (en gruppnyckel finns inte i det riktiga).
 * `app.ts` monterar default-exporten, som alltid använder det riktiga registret; ingen request kan välja register.
 * Registret slås upp vid anrop, inte vid import, så att routern inte binder sig till värdet förrän det behövs
 * (modulen skapas som en sidoeffekt av att app.ts importeras). Det är en vana, inget prod-krav.
 */
export function createSettingsRouter(definitions?: readonly SettingDefinition[]): express.Router {
  const router = express.Router();
  const putLimiter = createRateLimiter(PUT_WINDOW_MS, PUT_MAX_PER_WINDOW);
  const registry = (): readonly SettingDefinition[] => definitions ?? SETTING_DEFINITIONS;

  /** Svaret efter läsning eller skrivning: upplösta värden för användar-scopet plus vilka nycklar som är anpassade. */
  async function currentSettings(userId: string): Promise<SettingsApiResponse> {
    const stored = await readStored(userId);
    const defs = registry();
    const values = resolveSettings(stored, 'user', defs, ({ key, reason }) =>
      logger.warn(`⚠️ Lagrad inställning ignoreras (${reason}): ${key}`),
    );
    return { success: true, data: { values }, meta: { customised: customisedKeys(stored, 'user', defs) } };
  }

  // ─── GET /api/settings ──────────────────────────────────────────────────────
  router.get('/', authenticateJWT, async (req, res): Promise<void> => {
    try {
      res.json(await currentSettings(req.user!.user_id) satisfies SettingsApiResponse);
    } catch (e) {
      logger.error(`❌ GET /api/settings misslyckades (${errorCode(e)})`);
      res.status(500).json({ error: 'Failed to fetch settings' } satisfies ApiError);
    }
  });

  // ─── PUT /api/settings ──────────────────────────────────────────────────────
  // Body { values: { <nyckel>: boolean | string | null } }. En upsert för alla satta nycklar (atomär per nyckel, ingen
  // read-modify-write) och en delete för de återställda; båda filtreras på anroparens user_id.
  router.put('/', authenticateJWT, putLimiter, async (req, res): Promise<void> => {
    const userId = req.user!.user_id;
    const patch = sanitizePatch(req.body, 'user', registry());
    if (!patch.ok) {
      res.status(400).json({ error: patch.error } satisfies ApiError);
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const setKeys = Object.keys(patch.set);
      if (setKeys.length > 0) {
        const updatedAt = new Date().toISOString();
        const rows = setKeys.map((key) => ({ user_id: userId, key, value: patch.set[key], updated_at: updatedAt }));
        const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'user_id,key' });
        if (error) throw error;
      }
      if (patch.reset.length > 0) {
        const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).in('key', patch.reset);
        if (error) throw error;
      }
      res.json(await currentSettings(userId) satisfies SettingsApiResponse);
    } catch (e) {
      logger.error(`❌ PUT /api/settings misslyckades (${errorCode(e)})`);
      res.status(500).json({ error: 'Failed to save settings' } satisfies ApiError);
    }
  });

  return router;
}

export default createSettingsRouter();
