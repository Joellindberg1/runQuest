import { describe, it, expect } from 'vitest';
import { ACTIVITY_TYPES, type ActivityType } from '../activity.js';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  classifyNotification,
  isNotifiable,
  notifyKey,
  type ClassifiableRow,
  type NotifiableRow,
  type NotificationKind,
  type NotifyViewer,
} from '../notifications.js';

const ME = 'user-me';
const OTHER = 'user-other';
const THIRD = 'user-third';

const row = (
  type: string,
  actorId: string | null,
  targetId: string | null,
  payload: unknown = {},
): ClassifiableRow => ({ type, actorId, targetId, payload });

const WAVE_1_KINDS: NotificationKind[] = [
  'title_taken_from_me',
  'title_others',
  'challenge_received_me',
  'challenge_lost_me',
  'challenge_won_me',
  'challenge_draw_me',
  'challenges_others',
  'event_open',
  'event_closed_others',
  'level_up_others',
  'run_milestone_others',
  'badge_earned_others',
  'streak_broken_others',
  'release_published',
];

describe('NOTIFICATION_KINDS', () => {
  it('slagnycklarna är unika och varje slag har etikett, sektion, roll och default', () => {
    const kinds = NOTIFICATION_KINDS.map((k) => k.kind);
    const keys = NOTIFICATION_KINDS.map((k) => k.key);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(keys).size).toBe(keys.length);

    for (const def of NOTIFICATION_KINDS) {
      expect(def.key).toBe(`notify.${def.kind}`);
      expect(notifyKey(def.kind)).toBe(def.key);
      expect(def.label.trim().length).toBeGreaterThan(0);
      expect(NOTIFICATION_GROUPS).toContain(def.group);
      expect(['you', 'others', 'everyone']).toContain(def.role);
      expect(typeof def.default).toBe('boolean');
      expect([1, 2]).toContain(def.wave);
    }

    // Våg 1 är hela den här storyns omfång; alla börjar påslagna (ADR 011 beslut 3, Ö1).
    for (const kind of WAVE_1_KINDS) {
      const def = NOTIFICATION_KINDS.find((k) => k.kind === kind);
      expect(def, kind).toBeDefined();
      expect(def?.wave).toBe(1);
      expect(def?.default).toBe(true);
    }
    // Inga reglage utan fakta bakom: bara våg 1 finns registrerad tills våg 2 lägger till sina.
    expect(NOTIFICATION_KINDS.filter((k) => k.wave === 1).map((k) => k.kind).sort()).toEqual(
      [...WAVE_1_KINDS].sort(),
    );
  });
});

describe('classifyNotification', () => {
  it('titel tagen från mig är title_taken_from_me, med mig som aktör är own, mellan andra title_others', () => {
    const table: Array<[ClassifiableRow, ReturnType<typeof classifyNotification>]> = [
      [row('title_taken', OTHER, ME), 'title_taken_from_me'],
      [row('title_taken', ME, OTHER), 'own'],
      [row('title_taken', OTHER, THIRD), 'title_others'],
      // Målet går före aktören: personliga slag före "others".
      [row('title_taken', ME, ME), 'title_taken_from_me'],
    ];
    for (const [r, expected] of table) {
      expect(classifyNotification(r, ME), JSON.stringify(r)).toBe(expected);
    }
  });

  it('title_unlocked och title_revoked: egen är own, andras är title_others', () => {
    for (const type of ['title_unlocked', 'title_revoked']) {
      expect(classifyNotification(row(type, ME, null), ME)).toBe('own');
      expect(classifyNotification(row(type, OTHER, null), ME)).toBe('title_others');
    }
  });

  it('challenge_received: mål jag, aktör jag och utomstående ger rätt slag', () => {
    expect(classifyNotification(row('challenge_received', OTHER, ME), ME)).toBe('challenge_received_me');
    expect(classifyNotification(row('challenge_received', ME, OTHER), ME)).toBe('own');
    expect(classifyNotification(row('challenge_received', OTHER, THIRD), ME)).toBe('challenges_others');
  });

  it('challenge_won: mål jag är challenge_lost_me, aktör jag är challenge_won_me (undantaget), utomstående är challenges_others', () => {
    expect(classifyNotification(row('challenge_won', OTHER, ME), ME)).toBe('challenge_lost_me');
    expect(classifyNotification(row('challenge_won', ME, OTHER), ME)).toBe('challenge_won_me');
    expect(classifyNotification(row('challenge_won', OTHER, THIRD), ME)).toBe('challenges_others');
  });

  it('challenge_draw: aktör eller mål jag är challenge_draw_me', () => {
    expect(classifyNotification(row('challenge_draw', ME, OTHER), ME)).toBe('challenge_draw_me');
    expect(classifyNotification(row('challenge_draw', OTHER, ME), ME)).toBe('challenge_draw_me');
    expect(classifyNotification(row('challenge_draw', OTHER, THIRD), ME)).toBe('challenges_others');
  });

  it('event_closed utan entrant_ids är event_closed_others', () => {
    expect(classifyNotification(row('event_closed', null, null, { event_id: 'e1' }), ME)).toBe(
      'event_closed_others',
    );
    // Äldre rader och backfill saknar payload eller fält.
    expect(classifyNotification(row('event_closed', null, null, null), ME)).toBe('event_closed_others');
  });

  it('level_up, run_milestone, badge_earned och streak_broken: egen är own, andras är others', () => {
    const table: Array<[string, NotificationKind]> = [
      ['level_up', 'level_up_others'],
      ['run_milestone', 'run_milestone_others'],
      ['badge_earned', 'badge_earned_others'],
      ['streak_broken', 'streak_broken_others'],
    ];
    for (const [type, others] of table) {
      expect(classifyNotification(row(type, ME, null), ME), type).toBe('own');
      expect(classifyNotification(row(type, OTHER, null), ME), type).toBe(others);
    }
  });

  it('event_open och release_published klassas oavsett aktör', () => {
    for (const actor of [null, ME, OTHER]) {
      expect(classifyNotification(row('event_open', actor, null), ME)).toBe('event_open');
      expect(classifyNotification(row('release_published', actor, null), ME)).toBe('release_published');
    }
  });

  it('raderad användare eller aktör null klassas aldrig som jag', () => {
    // En raderad användare blir null i activity_log; null är aldrig lika med betraktaren, inte ens när betraktar-id:t är tomt.
    for (const viewer of [ME, '']) {
      expect(classifyNotification(row('title_taken', null, null), viewer)).toBe('title_others');
      expect(classifyNotification(row('challenge_received', null, null), viewer)).toBe('challenges_others');
      expect(classifyNotification(row('challenge_won', null, null), viewer)).toBe('challenges_others');
      expect(classifyNotification(row('challenge_draw', null, null), viewer)).toBe('challenges_others');
      expect(classifyNotification(row('level_up', null, null), viewer)).toBe('level_up_others');
      expect(classifyNotification(row('badge_earned', null, null), viewer)).toBe('badge_earned_others');
    }
    // Raderat mål bredvid en riktig aktör: utomstående ser "others", aktören ser "own"/undantaget.
    expect(classifyNotification(row('challenge_won', OTHER, null), ME)).toBe('challenges_others');
    expect(classifyNotification(row('challenge_won', ME, null), ME)).toBe('challenge_won_me');
    expect(classifyNotification(row('title_taken', OTHER, null), ME)).toBe('title_others');
  });

  it('okänd typ ger null', () => {
    expect(classifyNotification(row('some_future_type', OTHER, ME), ME)).toBeNull();
    expect(classifyNotification(row('', null, null), ME)).toBeNull();
    // Arvade nycklar på objekt är inte typer.
    expect(classifyNotification(row('constructor', OTHER, ME), ME)).toBeNull();
    expect(classifyNotification(row('toString', OTHER, ME), ME)).toBeNull();
  });

  it('varje rad ger exakt ett slag ur betraktarens perspektiv (ingen överlappning)', () => {
    // Systemhändelser har ingen aktör i loggen.
    const actorlessTypes = new Set<string>(['event_open', 'event_closed', 'release_published']);
    const actorsOf = (type: string): Array<string | null> =>
      actorlessTypes.has(type) ? [null] : [null, ME, OTHER];
    // Bara dessa typer har ett mål i loggen (ADR 011 kontext: aktör/mål per typ); övriga har alltid target null.
    const targetedTypes = new Set<string>(['title_taken', 'challenge_received', 'challenge_won', 'challenge_draw']);
    const targetsOf = (type: string): Array<string | null> =>
      targetedTypes.has(type) ? [null, ME, OTHER, THIRD] : [null];
    const roleOf = new Map(NOTIFICATION_KINDS.map((k) => [k.kind, k.role]));
    let checked = 0;

    for (const type of ACTIVITY_TYPES) {
      for (const actor of actorsOf(type)) {
        for (const target of targetsOf(type)) {
          const r = row(type, actor, target);
          const result = classifyNotification(r, ME);
          // Exakt ett utfall: ett registrerat slag, own eller (aldrig för kända typer) null.
          expect(result, `${type} ${actor} -> ${target}`).not.toBeNull();
          const involved = actor === ME || target === ME;
          if (result === 'own') {
            expect(actor, `${type} own`).toBe(ME);
          } else {
            const role = roleOf.get(result as NotificationKind);
            expect(role, `${type} ${String(result)} saknas i registret`).toBeDefined();
            // "Others"-slag får aldrig träffa en rad som rör mig, och personliga slag kräver att den rör mig.
            if (role === 'others') expect(involved, `${type} ${String(result)}`).toBe(false);
            if (role === 'you') expect(involved, `${type} ${String(result)}`).toBe(true);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(
      ACTIVITY_TYPES.reduce((sum, type) => sum + actorsOf(type).length * targetsOf(type).length, 0),
    );
  });

  it('varje ActivityType är klassificerad (kontraktstest: en ny typ utan klassificering fäller testet)', () => {
    // Betraktaren är en utomstående: en känd typ får då aldrig ge null. Typsystemet fäller bygget först
    // (Record<ActivityType, …> i notifications.ts); det här testet fäller det om någon kringgår typen.
    for (const type of ACTIVITY_TYPES satisfies readonly ActivityType[]) {
      const result = classifyNotification(row(type, OTHER, THIRD), ME);
      expect(result, type).not.toBeNull();
      expect(result, type).not.toBe('own');
    }
  });
});

describe('isNotifiable', () => {
  const FLOOR = 100;
  const VIEWER_CREATED = '2026-01-01T00:00:00.000Z';

  const viewer = (overrides: Partial<NotifyViewer> = {}): NotifyViewer => ({
    id: ME,
    createdAt: VIEWER_CREATED,
    floor: FLOOR,
    readIds: new Set<number>(),
    settings: {},
    ...overrides,
  });

  const notifiable = (overrides: Partial<NotifiableRow> = {}): NotifiableRow => ({
    id: 150,
    type: 'level_up',
    actorId: OTHER,
    targetId: null,
    payload: { level: 5 },
    isBackfill: false,
    createdAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  });

  it('isNotifiable: ett avstängt slag är inte en notis', () => {
    expect(isNotifiable(notifiable(), viewer())).toBe(true);
    expect(isNotifiable(notifiable(), viewer({ settings: { [notifyKey('level_up_others')]: false } }))).toBe(false);
    // Ett annat slags avstängning rör inte raden.
    expect(isNotifiable(notifiable(), viewer({ settings: { [notifyKey('badge_earned_others')]: false } }))).toBe(true);
    // Uttryckligen påslaget är påslaget.
    expect(isNotifiable(notifiable(), viewer({ settings: { [notifyKey('level_up_others')]: true } }))).toBe(true);
    // Ett värde av fel typ faller tillbaka på defaulten (på) i stället för att tysta raden.
    expect(isNotifiable(notifiable(), viewer({ settings: { [notifyKey('level_up_others')]: 'off' } }))).toBe(true);
  });

  it('isNotifiable: backfill, rad före betraktarens created_at, id på eller under golvet och rad i readIds är inte notiser', () => {
    expect(isNotifiable(notifiable({ isBackfill: true }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ createdAt: '2025-12-31T23:59:59.999Z' }), viewer())).toBe(false);
    // Exakt samma ögonblick som betraktarens created_at är inte "efter".
    expect(isNotifiable(notifiable({ createdAt: VIEWER_CREATED }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ id: FLOOR }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ id: FLOOR - 1 }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ id: FLOOR + 1 }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ id: 150 }), viewer({ readIds: new Set([150]) }))).toBe(false);
    expect(isNotifiable(notifiable({ id: 150 }), viewer({ readIds: new Set([151]) }))).toBe(true);
    // Okänd tid eller okänd typ är aldrig en notis (fail-closed).
    expect(isNotifiable(notifiable({ createdAt: 'inte ett datum' }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ type: 'some_future_type' }), viewer())).toBe(false);
  });

  it('isNotifiable: egen handling är inte notis men challenge_won_me och challenge_draw_me är det', () => {
    expect(isNotifiable(notifiable({ type: 'level_up', actorId: ME }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ type: 'badge_earned', actorId: ME }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ type: 'streak_broken', actorId: ME }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ type: 'title_taken', actorId: ME, targetId: OTHER }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ type: 'challenge_received', actorId: ME, targetId: OTHER }), viewer())).toBe(false);

    expect(isNotifiable(notifiable({ type: 'challenge_won', actorId: ME, targetId: OTHER }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ type: 'challenge_draw', actorId: ME, targetId: OTHER }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ type: 'challenge_draw', actorId: OTHER, targetId: ME }), viewer())).toBe(true);

    // Undantagen kan ändå stängas av med sina egna reglage.
    expect(
      isNotifiable(
        notifiable({ type: 'challenge_won', actorId: ME, targetId: OTHER }),
        viewer({ settings: { [notifyKey('challenge_won_me')]: false } }),
      ),
    ).toBe(false);
  });

  it('isNotifiable: påslaget slag ovanför golvet och ej läst är en notis', () => {
    expect(isNotifiable(notifiable({ type: 'title_taken', actorId: OTHER, targetId: ME }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ type: 'challenge_received', actorId: OTHER, targetId: ME }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ type: 'event_open', actorId: null }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ type: 'release_published', actorId: null }), viewer())).toBe(true);
    expect(isNotifiable(notifiable({ createdAt: '2026-01-01T00:00:00.001Z' }), viewer())).toBe(true);
    // Golv 0 (ingen kvittering ännu) räknar allt ovanför.
    expect(isNotifiable(notifiable({ id: 1 }), viewer({ floor: 0 }))).toBe(true);
  });
});
