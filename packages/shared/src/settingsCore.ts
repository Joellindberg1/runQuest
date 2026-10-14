// Registrets typer och värderegeln (ADR 011 beslut 2, ADR 004). Ett löv: importerar inget från notifications.ts
// eller settings.ts, så att båda kan bygga på samma regel utan cirkulär import.
//
// Regeln "är det lagrade värdet giltigt för definitionen? annars definitionens default" finns bara här.
// settings.ts (resolveSettings, sanitizePatch) och notifications.ts (isKindEnabled) anropar den.
import type { SettingsValue } from './contracts/settings.js';

export type SettingScope = 'user' | 'group';

interface SettingDefinitionBase {
  /** Namnrymd med punkt, t.ex. `notify.<slag>`. Högst 80 tecken (user_settings.key). */
  key: string;
  scope: SettingScope;
}

export interface BooleanSettingDefinition extends SettingDefinitionBase {
  type: 'boolean';
  default: boolean;
}

export interface EnumSettingDefinition extends SettingDefinitionBase {
  type: 'enum';
  default: string;
  /** Tillåtna värden; defaulten ska ingå. */
  values: readonly string[];
}

export type SettingDefinition = BooleanSettingDefinition | EnumSettingDefinition;

/** Användarscope-definitionen för ett boolean-reglage. EN plats, så registret och isKindEnabled bygger den lika. */
export function userBooleanSetting(key: string, defaultValue: boolean): BooleanSettingDefinition {
  return { key, scope: 'user', type: 'boolean', default: defaultValue };
}

/**
 * Läs en EGEN nyckel ur lagrad data. Ärvda nycklar (Object.prototype) räknas aldrig, så en förgiftad prototyp kan
 * inte ändra ett värde. (hasOwnProperty.call i stället för Object.hasOwn: frontendens lib är ES2020.)
 */
export function readOwn(stored: unknown, key: string): { present: boolean; value?: unknown } {
  if (typeof stored !== 'object' || stored === null || !Object.prototype.hasOwnProperty.call(stored, key)) {
    return { present: false };
  }
  return { present: true, value: (stored as Record<string, unknown>)[key] };
}

/** Är värdet giltigt för definitionen (rätt typ, och för enum ett tillåtet värde)? */
export function isValidSettingValue(def: SettingDefinition, value: unknown): value is SettingsValue {
  return def.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && def.values.includes(value);
}

/** Lagrat värde om det är giltigt, annars definitionens default. Kraschar aldrig på okänd data. */
export function resolveSettingValue(def: SettingDefinition, stored: unknown): SettingsValue {
  return isValidSettingValue(def, stored) ? stored : def.default;
}
