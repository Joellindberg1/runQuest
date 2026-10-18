// Group Settings Routes (ADR 012 beslut 6) — gruppinställningar, en rad per (grupp, nyckel) i group_settings.
// ADR 007 A: { success, data, meta? } / { error }, snake_case, typer i shared/contracts/settings. Mönstret är routes/settings.ts.
//
// Gruppen kommer ALDRIG ur token, URL, body eller header, för token är inaktuell efter groups/join och en admin ska inte kunna rikta
// en skrivning mot en annan grupp:
//   GET  gruppen ur anroparens aktiva medlemskap (getActiveMembership); utan medlemskap 200 med tomma värden. Alla medlemmar läser.
//   PUT  gruppen ur actingGroupForWriteOrRespond (utils/groupAccess.ts): färskt medlemskap + groupRoleCan(role, 'settings.write').
//        Icke-admin, icke-medlem och en lämnad admin får samma 403; databasfel ger 500. Roll prövas före validering av body.
// Vakten i scripts/ci-guards.mjs (regel 15) fäller bygget om en fil skriver group_settings utan den vägen, eller tar gruppen ur req.*.
// users.is_admin används inte (ADR 012 beslut 2.6).
//
// PUT svarar med nuläget efter skrivningen, läst på nytt. Lyckas skrivningen men läsningen efter den misslyckas blir svaret 500 trots att
// ändringen är sparad; klienten ska då läsa om med GET. Ändringen meddelas ändå (sömmen nedan): den räknas då ur begäran i stället.
//
// Sömmen onGroupSettingsChanged (services/groupSettings.ts): kallas en gång när en skrivning ändrat ett UPPLÖST värde, aldrig annars.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import { errorCode } from '../utils/errorCode.js';
import { actingGroupForWriteOrRespond } from '../utils/groupAccess.js';
import { getActiveMembership } from '../utils/membership.js';
import {
  logGroupSettingsChange,
  readStoredGroupSettings,
  type OnGroupSettingsChanged,
} from '../services/groupSettings.js';
import {
  SETTING_DEFINITIONS,
  customisedKeys,
  diffResolvedSettings,
  groupRoleCan,
  resolveSettings,
  sanitizePatch,
  type GroupSettingsApiResponse,
  type SanitizedPatch,
  type SettingDefinition,
} from '@runquest/shared';

/** Samma gräns som PUT /api/settings: 60 skrivningar per minut och IP stoppar bara ett skript som hamrar på tabellen. */
const PUT_WINDOW_MS = 60 * 1000;
const PUT_MAX_PER_WINDOW = 60;

export interface GroupSettingsRouterDeps {
  /** Utskicket till gruppen (ADR 012 beslut 6.5). Standard: loggar och gör inget. */
  onGroupSettingsChanged?: OnGroupSettingsChanged;
}

type OkPatch = Extract<SanitizedPatch, { ok: true }>;

/** Lagrade värden efter att patchen applicerats i minnet. Används bara när läsningen efter skrivningen misslyckats. */
function applyPatch(stored: Record<string, unknown>, patch: OkPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored };
  for (const key of patch.reset) delete next[key];
  for (const [key, value] of Object.entries(patch.set)) next[key] = value;
  return next;
}

/**
 * Routern byggs av en fabrik av samma skäl som createSettingsRouter: ett test ger den ett register med en gruppnyckel (det riktiga har
 * inga i v0.8.0) och en egen söm. `app.ts` monterar default-exporten, som alltid använder det riktiga registret och standardsömmen;
 * ingen request kan välja någotdera.
 */
export function createGroupSettingsRouter(
  definitions?: readonly SettingDefinition[],
  deps: GroupSettingsRouterDeps = {},
): express.Router {
  const router = express.Router();
  const putLimiter = createRateLimiter(PUT_WINDOW_MS, PUT_MAX_PER_WINDOW);
  const registry = (): readonly SettingDefinition[] => definitions ?? SETTING_DEFINITIONS;
  const announce = deps.onGroupSettingsChanged ?? logGroupSettingsChange;

  /** Upplösta värden. Varningen för ett ogiltigt lagrat värde loggas bara när `warn` är satt, så att en PUT inte loggar samma rad två gånger. */
  const resolve = (stored: Record<string, unknown>, warn = true) =>
    resolveSettings(
      stored,
      'group',
      registry(),
      warn ? ({ key, reason }) => logger.warn(`⚠️ Lagrad gruppinställning ignoreras (${reason}): ${key}`) : undefined,
    );

  // ─── GET /api/groups/settings ───────────────────────────────────────────────
  router.get('/', authenticateJWT, async (req, res): Promise<void> => {
    try {
      const membership = await getActiveMembership(req.user!.user_id);
      if (!membership) {
        const empty: GroupSettingsApiResponse = { success: true, data: { values: {} }, meta: { customised: [], can_edit: false } };
        res.json(empty);
        return;
      }
      const stored = await readStoredGroupSettings(getSupabaseClient(), membership.group_id);
      const body: GroupSettingsApiResponse = {
        success: true,
        data: { values: resolve(stored) },
        meta: { customised: customisedKeys(stored, 'group', registry()), can_edit: groupRoleCan(membership.role, 'settings.write') },
      };
      res.json(body);
    } catch (e) {
      logger.error(`❌ GET /api/groups/settings misslyckades (${errorCode(e)})`);
      res.status(500).json({ error: 'Failed to fetch group settings' });
    }
  });

  // ─── PUT /api/groups/settings ───────────────────────────────────────────────
  // Body { values: { <nyckel>: boolean | string | null } }. En upsert för alla satta nycklar (atomär per nyckel) och en delete för de
  // återställda; båda filtreras på gruppen ur medlemskapet. updated_at sätts här (migration 054 har ingen trigger), updated_by = admin.
  router.put('/', authenticateJWT, putLimiter, async (req, res): Promise<void> => {
    const groupId = await actingGroupForWriteOrRespond(req, res);
    if (!groupId) return;
    const actorId = req.user!.user_id;

    const patch = sanitizePatch(req.body, 'group', registry());
    if (!patch.ok) {
      res.status(400).json({ error: patch.error });
      return;
    }

    const supabase = getSupabaseClient();
    const updatedAt = new Date().toISOString();

    let before: Record<string, unknown>;
    try {
      before = await readStoredGroupSettings(supabase, groupId);
    } catch (e) {
      logger.error(`❌ PUT /api/groups/settings kunde inte läsa nuläget (${errorCode(e)})`);
      res.status(500).json({ error: 'Failed to save group settings' });
      return;
    }

    let writeFailed = false;
    try {
      const setKeys = Object.keys(patch.set);
      if (setKeys.length > 0) {
        const rows = setKeys.map((key) => ({ group_id: groupId, key, value: patch.set[key], updated_by: actorId, updated_at: updatedAt }));
        const { error } = await supabase.from('group_settings').upsert(rows, { onConflict: 'group_id,key' });
        if (error) throw error;
      }
      if (patch.reset.length > 0) {
        const { error } = await supabase.from('group_settings').delete().eq('group_id', groupId).in('key', patch.reset);
        if (error) throw error;
      }
    } catch (e) {
      writeFailed = true;
      logger.error(`❌ PUT /api/groups/settings misslyckades (${errorCode(e)})`);
    }

    // Läs om, så att svaret och skillnaden bygger på det som faktiskt ligger i databasen (också efter en delvis misslyckad skrivning).
    let after: Record<string, unknown>;
    let rereadFailed = false;
    try {
      after = await readStoredGroupSettings(supabase, groupId);
    } catch (e) {
      rereadFailed = true;
      logger.error(`❌ PUT /api/groups/settings kunde inte läsa om nuläget (${errorCode(e)})`);
      after = writeFailed ? before : applyPatch(before, patch);
    }

    if (!writeFailed) {
      logger.info('💾 group settings saved', { user_id: actorId, group_id: groupId, keys: [...Object.keys(patch.set), ...patch.reset] });
    }

    const changes = diffResolvedSettings(resolve(before, false), resolve(after, false));
    if (changes.length > 0) {
      try {
        await announce({ groupId, actorId, changes, updatedAt });
      } catch (e) {
        logger.error(`❌ onGroupSettingsChanged misslyckades (${errorCode(e)})`);
      }
    }

    if (writeFailed || rereadFailed) {
      res.status(500).json({ error: 'Failed to save group settings' });
      return;
    }
    const body: GroupSettingsApiResponse = {
      success: true,
      data: { values: resolve(after) },
      meta: { customised: customisedKeys(after, 'group', registry()), can_edit: true },
    };
    res.json(body);
  });

  return router;
}

export default createGroupSettingsRouter();
