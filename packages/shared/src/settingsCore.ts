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

/** Är värdet giltigt för definitionen (rätt typ, och för enum ett tillåtet värde)? */
export function isValidSettingValue(def: SettingDefinition, value: unknown): value is SettingsValue {
  return def.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && def.values.includes(value);
}

/** Lagrat värde om det är giltigt, annars definitionens default. Kraschar aldrig på okänd data. */
export function resolveSettingValue(def: SettingDefinition, stored: unknown): SettingsValue {
  return isValidSettingValue(def, stored) ? stored : def.default;
}
