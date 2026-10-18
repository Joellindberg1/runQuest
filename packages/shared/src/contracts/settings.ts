// GET /api/settings och PUT /api/settings (ADR 011 beslut 2, ADR 007 A). Fältstil snake_case.
// Endast typer. Registret och reglerna bor i ../settings.ts och delas av backend och klient.
import type { ApiSuccess } from './common.js';

/** Ett inställningsvärde: boolean-reglage eller ett enumvärde (sträng). */
export type SettingsValue = boolean | string;

export interface SettingsResponse {
  /** ALLA nycklar i användarens scope, upplösta (saknad nyckel = default). */
  values: Record<string, SettingsValue>;
}

export interface SettingsMeta {
  /** Nycklar med ett uttryckligen lagrat, giltigt värde, även när det är lika med defaulten. */
  customised: string[];
}

export type SettingsApiResponse = ApiSuccess<SettingsResponse, SettingsMeta>;

export interface UpdateSettingsRequest {
  /** Högst 40 nycklar. `null` = återställ nyckeln till default (raden raderas). */
  values: Record<string, SettingsValue | null>;
}

// ─── GET /api/groups/settings och PUT /api/groups/settings (ADR 012 beslut 6.3) ────────────────────────────

export interface GroupSettingsMeta extends SettingsMeta {
  /** Får anroparen ändra gruppens inställningar (admin-rollen i det aktiva medlemskapet)? Styr bara UI:t; servern prövar om vid PUT. */
  can_edit: boolean;
}

/** Utan aktivt medlemskap: `values` är tomt, `customised` tomt och `can_edit` false. */
export type GroupSettingsApiResponse = ApiSuccess<SettingsResponse, GroupSettingsMeta>;

/** Samma form som användarens PUT: `{ values: { <nyckel>: värde | null } }`, men bara nycklar med scope 'group'. */
export type UpdateGroupSettingsRequest = UpdateSettingsRequest;
