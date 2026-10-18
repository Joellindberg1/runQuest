import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  SETTING_DEFINITIONS,
  isAnalyticsSettingKey,
  sanitizeAnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsProps,
} from '../index.js';

// Webbanalysen får aldrig se rundata, mått, namn, e-post eller id:n (Stravas API-policy 5.4, ägarbeslut i epic RUN-19). Vakten är sista
// försvaret: typerna gör fel namn och fel nycklar till kompileringsfel, vakten gör samma sak vid körning för det som kommer utifrån (cast, JS).

const UUID = '3f2b8c1e-5d4a-4b9e-8c1f-2a7d6e9b0c11';

// Vad som aldrig får bli en nyckel i registret, vad värdena än är. Allowlisten släpper ändå bara igenom det som står i registret; det här fäller
// ett registerbygge där någon lägger till en sådan nyckel.
const FORBIDDEN_KEYS = ['distance', 'km', 'time', 'duration', 'pace', 'name', 'email', 'id', 'user_id', 'userid', 'athlete_id', 'title', 'xp', 'url'];

describe('the analytics event list', () => {
  it('is a fixed list of kebab-case names that fit Umami (50 characters at most)', () => {
    expect([...ANALYTICS_EVENT_NAMES].sort()).toEqual(
      [
        'challenge-accepted',
        'film-started',
        'login-click',
        'notifications-opened',
        'setting-changed',
        'strava-connected',
        'waitlist-click',
        'waitlist-joined',
      ].sort(),
    );
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(name.length).toBeLessThanOrEqual(50);
    }
  });

  it('allows only small enumerated values: short lowercase tokens, never anything that looks like an id, a number or an address', () => {
    for (const [event, definition] of Object.entries(ANALYTICS_EVENTS)) {
      for (const [key, values] of Object.entries(definition)) {
        expect(FORBIDDEN_KEYS,`${event}.${key}`).not.toContain(key.toLowerCase());
        expect(values.length, `${event}.${key} has values`).toBeGreaterThan(0);
        for (const value of values) {
          expect(value, `${event}.${key}`).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*)?$/);
          expect(value.length).toBeLessThanOrEqual(40);
        }
      }
    }
  });

  it('lets only setting-changed carry a prop, and that prop is the name of the setting, never the value (as the privacy text promises)', () => {
    const withProps = Object.entries(ANALYTICS_EVENTS).filter(([, definition]) => Object.keys(definition).length > 0);
    expect(withProps.map(([event, definition]) => [event, Object.keys(definition)])).toEqual([['setting-changed', ['setting']]]);
    const settingValues: readonly string[] = ANALYTICS_EVENTS['setting-changed'].setting;
    expect(settingValues).not.toContain('true');
    expect(settingValues).not.toContain('false');
    expect(settingValues.every((value) => value.startsWith('notify.'))).toBe(true);
  });

  it('can name every user setting in the settings registry, so a new setting is never silently left out of or smuggled into the statistics', () => {
    const allowed: readonly string[] = ANALYTICS_EVENTS['setting-changed'].setting;
    const userKeys = SETTING_DEFINITIONS.filter((definition) => definition.scope === 'user').map((definition) => definition.key);
    expect(userKeys.length).toBeGreaterThan(0);
    expect([...allowed].sort()).toEqual([...userKeys].sort());
  });
});

describe('sanitizeAnalyticsEvent', () => {
  it('accepts an event without props as it is', () => {
    expect(sanitizeAnalyticsEvent('waitlist-click')).toEqual({ name: 'waitlist-click' });
    expect(sanitizeAnalyticsEvent('waitlist-click', {})).toEqual({ name: 'waitlist-click' });
  });

  it('accepts an allowed prop with an allowed value and returns it as plain data', () => {
    const result = sanitizeAnalyticsEvent('setting-changed', { setting: 'notify.title_taken_from_me' });
    expect(result).toEqual({ name: 'setting-changed', data: { setting: 'notify.title_taken_from_me' } });
  });

  it('knows no event about logged runs, since the owner has not decided on one', () => {
    expect(ANALYTICS_EVENT_NAMES.filter((name) => /run/.test(name))).toEqual([]);
    expect(sanitizeAnalyticsEvent('run-logged-manual')).toBeNull();
  });

  it.each([undefined, null, '', 'unknown-event', 'Waitlist-Click', 'waitlist_click', 'constructor', '__proto__', 'toString', 42, {}, ['waitlist-click']])(
    'rejects the event name %j',
    (name) => {
      expect(sanitizeAnalyticsEvent(name)).toBeNull();
    },
  );

  it.each([
    ['distance', 5.2],
    ['distance', '5.2'],
    ['name', 'Anna Andersson'],
    ['email', 'anna@example.com'],
    ['user_id', UUID],
    ['userId', UUID],
    ['id', 7],
    ['athlete_id', 12345],
    ['time', 1_800],
    ['duration', '30:12'],
    ['title', 'Morning run'],
    ['xp', 120],
  ])('rejects the prop %s=%j on an event that takes no props', (key, value) => {
    expect(sanitizeAnalyticsEvent('login-click', { [key]: value })).toBeNull();
    expect(sanitizeAnalyticsEvent('waitlist-joined', { [key]: value })).toBeNull();
  });

  it('rejects a forbidden prop next to an allowed one, instead of sending the allowed one alone', () => {
    expect(sanitizeAnalyticsEvent('setting-changed', { setting: 'notify.title_taken_from_me', distance: 5.2 })).toBeNull();
    expect(sanitizeAnalyticsEvent('setting-changed', { setting: 'notify.title_taken_from_me', user_id: UUID })).toBeNull();
    expect(sanitizeAnalyticsEvent('setting-changed', { setting: 'notify.title_taken_from_me', email: 'anna@example.com' })).toBeNull();
    expect(sanitizeAnalyticsEvent('setting-changed', { setting: 'notify.title_taken_from_me', name: 'Anna' })).toBeNull();
  });

  it.each([
    ['a uuid', UUID],
    ['an email address', 'anna@example.com'],
    ['a name', 'Anna Andersson'],
    ['a number', 5.2],
    ['a numeric string', '5.2'],
    ['a boolean', true],
    ['null', null],
    ['an object', { id: UUID }],
    ['an array', ['notify.title_taken_from_me']],
    ['a key that is not in the registry', 'notify.not_a_real_kind'],
    ['an inherited property name', 'constructor'],
    ['the key with a trailing space', 'notify.title_taken_from_me '],
    ['the right key in capitals', 'NOTIFY.TITLE_TAKEN_FROM_ME'],
  ])('rejects %s as the value of the setting prop', (_label, value) => {
    expect(sanitizeAnalyticsEvent('setting-changed', { setting: value })).toBeNull();
  });

  it('rejects a missing required prop, so an event never arrives half described', () => {
    expect(sanitizeAnalyticsEvent('setting-changed')).toBeNull();
    expect(sanitizeAnalyticsEvent('setting-changed', {})).toBeNull();
  });

  it.each([null, 'notify.title_taken_from_me', 7, [], [['setting', 'notify.title_taken_from_me']]])('rejects props that are not a plain object: %j', (props) => {
    expect(sanitizeAnalyticsEvent('setting-changed', props)).toBeNull();
    expect(sanitizeAnalyticsEvent('waitlist-click', props)).toBeNull();
  });

  it('rejects a poisoned prototype key from parsed JSON', () => {
    const props: unknown = JSON.parse('{"__proto__": {"setting": "notify.title_taken_from_me"}}');
    expect(sanitizeAnalyticsEvent('setting-changed', props)).toBeNull();
    expect(sanitizeAnalyticsEvent('waitlist-click', props)).toBeNull();
  });

  it('rejects a prop hidden as a symbol key or as a non-enumerable property', () => {
    const symbolKeyed = { [Symbol('distance')]: 5.2 };
    const hidden = Object.defineProperty({}, 'distance', { value: 5.2, enumerable: false });
    expect(sanitizeAnalyticsEvent('waitlist-click', symbolKeyed)).toBeNull();
    expect(sanitizeAnalyticsEvent('waitlist-click', hidden)).toBeNull();
    const settingPlusHidden = Object.defineProperty({ setting: 'notify.title_others' }, 'user_id', { value: UUID, enumerable: false });
    expect(sanitizeAnalyticsEvent('setting-changed', settingPlusHidden)).toBeNull();
  });

  it('does not take a registry prop from a polluted Object.prototype', () => {
    Object.defineProperty(Object.prototype, 'setting', { value: 'notify.title_taken_from_me', configurable: true });
    try {
      expect(sanitizeAnalyticsEvent('setting-changed', { distance: 5.2 })).toBeNull();
    } finally {
      Reflect.deleteProperty(Object.prototype, 'setting');
    }
  });

  it('does not read props that are inherited rather than own', () => {
    const inherited = Object.create({ setting: 'notify.title_taken_from_me' }) as object;
    expect(sanitizeAnalyticsEvent('setting-changed', inherited)).toBeNull();
  });
});

describe('isAnalyticsSettingKey', () => {
  it('is true for every user setting in the registry and false for anything else', () => {
    for (const definition of SETTING_DEFINITIONS.filter((candidate) => candidate.scope === 'user')) {
      expect(isAnalyticsSettingKey(definition.key)).toBe(true);
    }
    for (const other of ['', 'notify.not_in_the_registry', 'constructor', '__proto__', 'NOTIFY.TITLE_OTHERS', UUID, 'anna@example.com']) {
      expect(isAnalyticsSettingKey(other)).toBe(false);
    }
  });
});

describe('the analytics types', () => {
  it('turn an unknown event name or a wrong prop key into a compile error', () => {
    // Raderna körs aldrig som anrop; tsc är det som prövar dem. Ett @ts-expect-error utan fel är i sig ett fel.
    const compileOnly = () => {
      const name: AnalyticsEventName = 'waitlist-click';
      // @ts-expect-error not in the fixed event list
      const unknown: AnalyticsEventName = 'page-viewed-by-anna';
      const ok: AnalyticsProps<'setting-changed'> = { setting: 'notify.title_taken_from_me' };
      // @ts-expect-error distance is not a prop of any event
      const wrongKey: AnalyticsProps<'setting-changed'> = { setting: 'notify.title_taken_from_me', distance: 5 };
      // @ts-expect-error a free string is not an enumerated value
      const freeValue: AnalyticsProps<'setting-changed'> = { setting: 'anna@example.com' };
      // @ts-expect-error an event without props takes no props
      const extra: AnalyticsProps<'waitlist-click'> = { email: 'anna@example.com' };
      return [name, unknown, ok, wrongKey, freeValue, extra];
    };
    expect(typeof compileOnly).toBe('function');
  });
});
