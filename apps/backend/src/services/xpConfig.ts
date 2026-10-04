// EN källa för XP-konfig (ADR 007 B4): runs-vägen (reprocessRunsFromDate) och
// GET /api/config/xp läser härifrån, så Estimated XP i UI:t inte kan avvika från
// vad backend räknar. Explicit kolumnlista — admin_settings innehåller även
// admin_password_hash, som aldrig får selectas här (select('*') är förbjudet).
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_ADMIN_SETTINGS,
  DEFAULT_STREAK_MULTIPLIERS,
  type AdminSettings,
  type StreakMultiplier,
  type XpConfigMeta,
} from '@runquest/shared';

export interface XpConfig {
  settings: AdminSettings;
  streak_multipliers: StreakMultiplier[];
  meta: XpConfigMeta;
}

export const XP_SETTINGS_COLUMNS =
  'base_xp, xp_per_km, bonus_5km, bonus_10km, bonus_15km, bonus_20km, min_run_distance';

// Cachen är process-lokal: en Railway-instans i dag. Med fler instanser kan värdena vara upp till
// 60 s skeva mellan dem efter en admin-ändring (invalideringen når bara den egna processen) — revisit vid skalning.
const TTL_MS = 60_000;

let cached: { value: XpConfig; expiresAt: number } | null = null;

/** Anropas av admin-PUT:arna så att ändringar slår igenom direkt. */
export function invalidateXpConfigCache(): void {
  cached = null;
}

async function loadXpConfig(): Promise<XpConfig> {
  const supabase = getSupabaseClient();
  const [settingsResult, multipliersResult] = await Promise.all([
    supabase.from('admin_settings').select(XP_SETTINGS_COLUMNS).single(),
    supabase.from('streak_multipliers').select('days, multiplier'),
  ]);

  let settings: AdminSettings = { ...DEFAULT_ADMIN_SETTINGS };
  let settingsSource: XpConfigMeta['settings_source'] = 'defaults';
  const d = settingsResult?.data;
  if (!settingsResult?.error && d) {
    // Plocka fält explicit — svaret får aldrig vidarebefordra okända kolumner.
    settings = {
      base_xp: d.base_xp,
      xp_per_km: d.xp_per_km,
      bonus_5km: d.bonus_5km,
      bonus_10km: d.bonus_10km,
      bonus_15km: d.bonus_15km,
      bonus_20km: d.bonus_20km,
      min_run_distance: Number(d.min_run_distance),
    };
    settingsSource = 'db';
  } else {
    logger.warn('⚠️ Could not fetch admin settings, using defaults');
  }

  let multipliers: StreakMultiplier[] = DEFAULT_STREAK_MULTIPLIERS.map((m) => ({ ...m }));
  let multipliersSource: XpConfigMeta['multipliers_source'] = 'defaults';
  const rows = multipliersResult?.data;
  if (!multipliersResult?.error && Array.isArray(rows) && rows.length > 0) {
    multipliers = rows
      .map((m: { days: number; multiplier: number | string }) => ({ days: Number(m.days), multiplier: Number(m.multiplier) }))
      .sort((a, b) => a.days - b.days);
    multipliersSource = 'db';
  } else {
    logger.warn('⚠️ Could not fetch streak multipliers, using defaults');
  }

  return {
    settings,
    streak_multipliers: multipliers,
    meta: { settings_source: settingsSource, multipliers_source: multipliersSource },
  };
}

/** Effektiva XP-värden (DB, annars shared-defaults). TTL-cache 60 s; fallback-resultat cachas inte. */
export async function getXpConfig(): Promise<XpConfig> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await loadXpConfig();
  const fromDb = value.meta.settings_source === 'db' && value.meta.multipliers_source === 'db';
  if (fromDb) cached = { value, expiresAt: now + TTL_MS };
  return value;
}
