// Typat inställningsregister och rena funktioner över det (ADR 011 beslut 2, SSOT enligt ADR 004).
//
// Delas av backend (GET/PUT /api/settings) och klienten (och en framtida mobilapp), så att inställningar tolkas
// likadant överallt. Sparse lagring: bara uttryckligen satta värden finns lagrade; resten är default.
// `scope` finns från start så att gruppinställningarna (RUN-94) kan återanvända registret; bara user är byggt.
//
// En källa med notisslagen: definitionerna för `notify.<slag>` härleds ur NOTIFICATION_KINDS, och värderegeln
// (settingsCore.ts) används även av isKindEnabled i notifications.ts. Beroendet går bara åt ett håll:
// settings.ts -> notifications.ts -> settingsCore.ts.
import { NOTIFICATION_KINDS } from './notifications.js';
import type { SettingsValue } from './contracts/settings.js';
import {
  isValidSettingValue,
  readOwn,
  resolveSettingValue,
  userBooleanSetting,
  type SettingDefinition,
  type SettingScope,
} from './settingsCore.js';

export type {
  BooleanSettingDefinition,
  EnumSettingDefinition,
  SettingDefinition,
  SettingScope,
} from './settingsCore.js';

/** Högst så många nycklar per PUT. */
export const MAX_PATCH_KEYS = 40;

/** En användarinställning per notisslag, med slagets nyckel och default. Parameter så att härledningen kan testas. */
export function notificationSettingDefinitions(
  kinds: readonly { key: string; default: boolean }[],
): SettingDefinition[] {
  return kinds.map((kind) => userBooleanSetting(kind.key, kind.default));
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = notificationSettingDefinitions(NOTIFICATION_KINDS);

export interface SettingsWarning {
  key: string;
  reason: 'wrong_type' | 'unknown_enum_value';
}

type StoredSettings = Readonly<Record<string, unknown>> | null | undefined;

/**
 * Fullt värdeobjekt för scopet. Saknad nyckel = default. Ett lagrat värde med fel typ eller okänt enumvärde ger
 * default och en varning via `onWarn` (loggas av anroparen, kraschar aldrig). Okända och pensionerade lagrade
 * nycklar ignoreras.
 */
export function resolveSettings(
  stored: StoredSettings,
  scope: SettingScope,
  definitions: readonly SettingDefinition[] = SETTING_DEFINITIONS,
  onWarn?: (warning: SettingsWarning) => void,
): Record<string, SettingsValue> {
  const values: Record<string, SettingsValue> = {};
  for (const def of definitions) {
    if (def.scope !== scope) continue;
    const { present, value } = readOwn(stored, def.key);
    if (present && !isValidSettingValue(def, value)) {
      const reason = def.type === 'enum' && typeof value === 'string' ? 'unknown_enum_value' : 'wrong_type';
      onWarn?.({ key: def.key, reason });
    }
    values[def.key] = resolveSettingValue(def, value);
  }
  return values;
}

/**
 * Nycklarna (i definitionsordning) som användaren uttryckligen har satt: ett lagrat, giltigt värde räknas som
 * anpassat även när det är lika med defaulten (ADR 011: användarens val överlever en ändrad default). Ett
 * ogiltigt lagrat värde löses upp till default och räknas inte. Detta är `SettingsMeta.customised`.
 */
export function customisedKeys(
  stored: StoredSettings,
  scope: SettingScope,
  definitions: readonly SettingDefinition[] = SETTING_DEFINITIONS,
): string[] {
  return definitions
    .filter((def) => {
      if (def.scope !== scope) return false;
      const { present, value } = readOwn(stored, def.key);
      return present && isValidSettingValue(def, value);
    })
    .map((def) => def.key);
}

export type SanitizedPatch =
  | { ok: true; set: Record<string, SettingsValue>; reset: string[] }
  | { ok: false; error: string };

function describeKey(key: string): string {
  return JSON.stringify(key.length > 80 ? `${key.slice(0, 80)}...` : key);
}

/**
 * Validerar en PUT-body `{ values: { <nyckel>: värde | null } }` strikt: okänd nyckel, fel typ eller fel scope är ett
 * fel (anroparen svarar 400), högst MAX_PATCH_KEYS nycklar, `null` = återställ (raden raderas). Allt eller inget:
 * ett enda fel avvisar hela patchen.
 */
export function sanitizePatch(
  body: unknown,
  scope: SettingScope,
  definitions: readonly SettingDefinition[] = SETTING_DEFINITIONS,
): SanitizedPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object with a values object' };
  }
  const patch: unknown = (body as Record<string, unknown>).values;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, error: 'values must be an object' };
  }

  const keys = Object.keys(patch);
  if (keys.length > MAX_PATCH_KEYS) {
    return { ok: false, error: `At most ${MAX_PATCH_KEYS} settings per request` };
  }

  const set: Record<string, SettingsValue> = {};
  const reset: string[] = [];
  for (const key of keys) {
    const def = definitions.find((d) => d.key === key);
    if (!def) return { ok: false, error: `Unknown setting ${describeKey(key)}` };
    if (def.scope !== scope) return { ok: false, error: `Setting ${describeKey(key)} is not a ${scope} setting` };

    const value: unknown = (patch as Record<string, unknown>)[key];
    if (value === null) {
      reset.push(key);
    } else if (isValidSettingValue(def, value)) {
      set[key] = value;
    } else {
      const expected = def.type === 'boolean' ? 'a boolean' : `one of ${def.values.join(', ')}`;
      return { ok: false, error: `Invalid value for ${describeKey(key)}: expected ${expected} or null` };
    }
  }
  return { ok: true, set, reset };
}
