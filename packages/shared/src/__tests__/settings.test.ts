import { describe, it, expect, vi } from 'vitest';
import { NOTIFICATION_KINDS, isKindEnabled } from '../notifications.js';
import {
  MAX_PATCH_KEYS,
  SETTING_DEFINITIONS,
  customisedKeys,
  resolveSettings,
  sanitizePatch,
  type SettingDefinition,
} from '../settings.js';

// Syntetiska definitioner: en grupp-scope-nyckel och en enum, så att scope- och enumvägarna testas utan att
// produktionsregistret behöver ha dem (RUN-94 återanvänder registret med scope 'group').
const GROUP_KEY: SettingDefinition = { key: 'group.rank_visibility', scope: 'group', type: 'boolean', default: true };
const ENUM_KEY: SettingDefinition = {
  key: 'display.density',
  scope: 'user',
  type: 'enum',
  default: 'comfortable',
  values: ['comfortable', 'compact'],
};
const SYNTHETIC: readonly SettingDefinition[] = [...SETTING_DEFINITIONS, GROUP_KEY, ENUM_KEY];

const FIRST_KIND = NOTIFICATION_KINDS[0];

it('nycklarna är unika och varje default har rätt typ för sin definition', () => {
  const keys = SETTING_DEFINITIONS.map((def) => def.key);
  expect(new Set(keys).size).toBe(keys.length);

  for (const def of SYNTHETIC) {
    if (def.type === 'boolean') {
      expect(typeof def.default, def.key).toBe('boolean');
    } else {
      expect(def.values.length, def.key).toBeGreaterThan(0);
      expect(def.values, def.key).toContain(def.default);
    }
  }
});

it('varje notisslag i NOTIFICATION_KINDS har en definition notify.<slag> med scope user', () => {
  for (const kind of NOTIFICATION_KINDS) {
    const def = SETTING_DEFINITIONS.find((d) => d.key === `notify.${kind.kind}`);
    expect(def, kind.kind).toBeDefined();
    expect(def?.scope).toBe('user');
    expect(def?.type).toBe('boolean');
    expect(def?.default).toBe(kind.default);
  }
  expect(SETTING_DEFINITIONS).toHaveLength(NOTIFICATION_KINDS.length);
});

it('resolveSettings: saknad nyckel ger default', () => {
  const values = resolveSettings({}, 'user');
  expect(Object.keys(values).sort()).toEqual(SETTING_DEFINITIONS.map((d) => d.key).sort());
  for (const def of SETTING_DEFINITIONS) expect(values[def.key], def.key).toBe(def.default);

  // Gles lagring: bara det som är satt skrivs över, resten är default.
  const sparse = resolveSettings({ [FIRST_KIND.key]: !FIRST_KIND.default }, 'user');
  expect(sparse[FIRST_KIND.key]).toBe(!FIRST_KIND.default);
  expect(sparse[NOTIFICATION_KINDS[1].key]).toBe(NOTIFICATION_KINDS[1].default);

  // Trasig inmatning kraschar aldrig.
  expect(resolveSettings(null, 'user')[FIRST_KIND.key]).toBe(FIRST_KIND.default);
  expect(resolveSettings(undefined, 'user')[FIRST_KIND.key]).toBe(FIRST_KIND.default);
});

it('resolveSettings: fel typ och okänt enumvärde ger default och en varning', () => {
  const onWarn = vi.fn();
  const values = resolveSettings(
    { [FIRST_KIND.key]: 'false', [ENUM_KEY.key]: 'spacious' },
    'user',
    SYNTHETIC,
    onWarn,
  );
  expect(values[FIRST_KIND.key]).toBe(FIRST_KIND.default);
  expect(values[ENUM_KEY.key]).toBe('comfortable');
  expect(onWarn).toHaveBeenCalledTimes(2);
  expect(onWarn.mock.calls.map(([w]) => w.key).sort()).toEqual([ENUM_KEY.key, FIRST_KIND.key].sort());

  // Ett enumvärde av fel typ (inte sträng) är också ogiltigt.
  expect(resolveSettings({ [ENUM_KEY.key]: 1 }, 'user', SYNTHETIC)[ENUM_KEY.key]).toBe('comfortable');
  // Giltigt enumvärde behålls och varnar inte.
  const quiet = vi.fn();
  expect(resolveSettings({ [ENUM_KEY.key]: 'compact' }, 'user', SYNTHETIC, quiet)[ENUM_KEY.key]).toBe('compact');
  expect(quiet).not.toHaveBeenCalled();
});

it('resolveSettings: okända och pensionerade lagrade nycklar ignoreras', () => {
  const onWarn = vi.fn();
  const values = resolveSettings(
    { 'notify.retired_kind': true, 'something.else': 'x', __proto__: { polluted: true }, constructor: 1 },
    'user',
    SETTING_DEFINITIONS,
    onWarn,
  );
  expect(Object.keys(values).sort()).toEqual(SETTING_DEFINITIONS.map((d) => d.key).sort());
  expect(values).not.toHaveProperty('notify.retired_kind');
  expect(values).not.toHaveProperty('something.else');
  expect(onWarn).not.toHaveBeenCalled();
});

it('resolveSettings: ett uttryckligt värde som råkar vara lika med defaulten behålls som anpassat', () => {
  const stored = { [FIRST_KIND.key]: FIRST_KIND.default };
  expect(resolveSettings(stored, 'user')[FIRST_KIND.key]).toBe(FIRST_KIND.default);
  expect(customisedKeys(stored, 'user')).toEqual([FIRST_KIND.key]);

  // Saknad, ogiltig och okänd nyckel är inte anpassade; ordningen följer definitionerna.
  expect(customisedKeys({}, 'user')).toEqual([]);
  expect(customisedKeys({ [FIRST_KIND.key]: 'yes', 'notify.retired_kind': true }, 'user')).toEqual([]);
  const both = { [NOTIFICATION_KINDS[2].key]: false, [FIRST_KIND.key]: true };
  expect(customisedKeys(both, 'user')).toEqual([FIRST_KIND.key, NOTIFICATION_KINDS[2].key]);
  // Scope begränsar: en gruppnyckel räknas inte i användarens lista.
  expect(customisedKeys({ [GROUP_KEY.key]: false }, 'user', SYNTHETIC)).toEqual([]);
});

it('sanitizePatch: okänd nyckel, fel typ och fel scope ger fel', () => {
  const bad: unknown[] = [
    { values: { 'notify.no_such_kind': true } },
    { values: { [FIRST_KIND.key]: 'true' } },
    { values: { [FIRST_KIND.key]: 1 } },
    { values: { [FIRST_KIND.key]: {} } },
    { values: { [ENUM_KEY.key]: 'spacious' } },
    { values: { [ENUM_KEY.key]: true } },
    { values: { [GROUP_KEY.key]: false } },
    { values: { [FIRST_KIND.key]: true, 'notify.no_such_kind': null } },
    // Själva bodyn måste vara ett objekt med ett values-objekt.
    null,
    'x',
    [],
    {},
    { values: null },
    { values: [] },
    { values: 'x' },
  ];
  // JSON.parse ger en riktig egen __proto__-nyckel (ett objektliteral gör det inte).
  bad.push(JSON.parse('{"values":{"__proto__":true}}'), JSON.parse('{"values":{"constructor":null}}'));
  for (const body of bad) {
    const result = sanitizePatch(body, 'user', SYNTHETIC);
    expect(result.ok, JSON.stringify(body)).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  }
});

it('sanitizePatch: null blir reset och ett giltigt värde blir set', () => {
  const result = sanitizePatch(
    { values: { [FIRST_KIND.key]: false, [NOTIFICATION_KINDS[1].key]: null, [ENUM_KEY.key]: 'compact' } },
    'user',
    SYNTHETIC,
  );
  expect(result).toEqual({
    ok: true,
    set: { [FIRST_KIND.key]: false, [ENUM_KEY.key]: 'compact' },
    reset: [NOTIFICATION_KINDS[1].key],
  });

  // Ett värde lika med defaulten är ett uttryckligt val och hamnar i set, inte reset.
  const same = sanitizePatch({ values: { [FIRST_KIND.key]: FIRST_KIND.default } }, 'user');
  expect(same).toEqual({ ok: true, set: { [FIRST_KIND.key]: FIRST_KIND.default }, reset: [] });

  // En tom patch är giltig och gör ingenting.
  expect(sanitizePatch({ values: {} }, 'user')).toEqual({ ok: true, set: {}, reset: [] });
});

it('sanitizePatch: fler än 40 nycklar ger fel', () => {
  expect(MAX_PATCH_KEYS).toBe(40);
  const many = (n: number): SettingDefinition[] =>
    Array.from({ length: n }, (_, i) => ({ key: `test.flag_${i}`, scope: 'user', type: 'boolean', default: true }));
  const patchOf = (defs: readonly SettingDefinition[]) => ({
    values: Object.fromEntries(defs.map((d) => [d.key, false])),
  });

  const atLimit = many(40);
  expect(sanitizePatch(patchOf(atLimit), 'user', atLimit).ok).toBe(true);

  const overLimit = many(41);
  const result = sanitizePatch(patchOf(overLimit), 'user', overLimit);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain('40');
});

it('gruppscope-nyckel avvisas för user-scope och godtas för group-scope (syntetisk definition)', () => {
  const body = { values: { [GROUP_KEY.key]: false } };
  expect(sanitizePatch(body, 'user', SYNTHETIC).ok).toBe(false);
  expect(sanitizePatch(body, 'group', SYNTHETIC)).toEqual({ ok: true, set: { [GROUP_KEY.key]: false }, reset: [] });

  // Omvänt: en användarnyckel är fel scope för en grupp-patch.
  expect(sanitizePatch({ values: { [FIRST_KIND.key]: false } }, 'group', SYNTHETIC).ok).toBe(false);

  // resolveSettings filtrerar på scope i båda riktningarna.
  const userValues = resolveSettings({ [GROUP_KEY.key]: false }, 'user', SYNTHETIC);
  expect(userValues).not.toHaveProperty(GROUP_KEY.key);
  expect(resolveSettings({ [GROUP_KEY.key]: false }, 'group', SYNTHETIC)).toEqual({ [GROUP_KEY.key]: false });
  expect(resolveSettings({}, 'group')).toEqual({});
});

describe('en källa för notisslagens på/av', () => {
  const INVALID: unknown[] = [null, 0, 1, '', 'false', 'true', undefined, {}, [], NaN];

  it('resolveSettings och isKindEnabled ger samma svar för varje slag, utelämnat värde och ogiltigt värde', () => {
    for (const def of NOTIFICATION_KINDS) {
      const stored = (value: unknown) => ({ [def.key]: value });
      const viaRegistry = (s: Record<string, unknown>) => resolveSettings(s, 'user')[def.key];

      expect(viaRegistry({}), def.kind).toBe(isKindEnabled(def.kind, {}));
      expect(viaRegistry(stored(true)), def.kind).toBe(isKindEnabled(def.kind, stored(true)));
      expect(viaRegistry(stored(false)), def.kind).toBe(isKindEnabled(def.kind, stored(false)));
      for (const bad of INVALID) {
        expect(viaRegistry(stored(bad)), `${def.kind} ${String(bad)}`).toBe(isKindEnabled(def.kind, stored(bad)));
        expect(isKindEnabled(def.kind, stored(bad)), `${def.kind} ${String(bad)}`).toBe(def.default);
      }
    }
  });
});
