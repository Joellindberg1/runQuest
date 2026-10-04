// GET /api/config/xp (ADR 007 B4) — effektiva XP-värden, läsbara för alla inloggade.
// Innehåller aldrig admin_password_hash, id eller tidsstämplar.
import type { ApiSuccess } from './common.js';

export interface XpConfigSettings {
  base_xp: number;
  xp_per_km: number;
  bonus_5km: number;
  bonus_10km: number;
  bonus_15km: number;
  bonus_20km: number;
  min_run_distance: number;
}

export interface XpConfigResponse {
  settings: XpConfigSettings;
  /** Stigande days. */
  streak_multipliers: Array<{ days: number; multiplier: number }>;
}

export interface XpConfigMeta {
  /** 'defaults' = DB-läsningen saknade/felade och shared-defaults användes. */
  settings_source: 'db' | 'defaults';
  multipliers_source: 'db' | 'defaults';
}

export type XpConfigApiResponse = ApiSuccess<XpConfigResponse, XpConfigMeta>;
