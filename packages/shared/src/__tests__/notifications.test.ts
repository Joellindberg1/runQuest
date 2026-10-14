import { describe, it, expect } from 'vitest';
import { ACTIVITY_TYPES, type ActivityType } from '../activity.js';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  classifyNotification,
  isKindEnabled,
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

const WAVE_2_KINDS: NotificationKind[] = [
  'challenge_accepted_me',
  'rank_passed_xp_me',
  'rank_passed_challenge_me',
  'rank_passed_others',
  'event_closed_me',
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
    // Inga reglage utan fakta bakom: våg 2 får sina slag tillsammans med sina skrivpunkter (event_closed_me kom med entrant_ids).
    expect(NOTIFICATION_KINDS.filter((k) => k.wave === 1).map((k) => k.kind).sort()).toEqual(
      [...WAVE_1_KINDS].sort(),
    );
    expect(NOTIFICATION_KINDS.filter((k) => k.wave === 2).map((k) => k.kind).sort()).toEqual([...WAVE_2_KINDS].sort());
  });

  it('rank_passed_others är avstängd som default och övriga nya slag är påslagna', () => {
    for (const kind of WAVE_2_KINDS) {
      const def = NOTIFICATION_KINDS.find((k) => k.kind === kind);
      expect(def, kind).toBeDefined();
      expect(def?.default, kind).toBe(kind !== 'rank_passed_others');
      expect(isKindEnabled(kind, {}), kind).toBe(kind !== 'rank_passed_others');
    }
    // Det enda slaget som startar avstängt (ADR 011 Ö1); ett uttryckligt "på" slår defaulten.
    expect(NOTIFICATION_KINDS.filter((k) => !k.default).map((k) => k.kind)).toEqual(['rank_passed_others']);
    expect(isKindEnabled('rank_passed_others', { [notifyKey('rank_passed_others')]: true })).toBe(true);
  });

  it('event_closed_me är påslagen som default', () => {
    const def = NOTIFICATION_KINDS.find((k) => k.kind === 'event_closed_me');
    expect(def?.default).toBe(true);
    expect(isKindEnabled('event_closed_me', {})).toBe(true);
    expect(isKindEnabled('event_closed_me', { [notifyKey('event_closed_me')]: false })).toBe(false);
  });

  it('varje slags sektion, roll och etikett är låsta mot ADR 011 beslut 3 och designerns förslag', () => {
    const expected: Array<[NotificationKind, string, string, string]> = [
      ['title_taken_from_me', 'Titles', 'you', 'Someone takes a title from you'],
      ['title_others', 'Titles', 'others', 'Other title changes in the pack'],
      ['challenge_received_me', 'Challenges', 'you', 'Someone challenges you'],
      ['challenge_accepted_me', 'Challenges', 'you', 'Someone accepts your challenge'],
      ['challenge_lost_me', 'Challenges', 'you', 'Someone beats you in a challenge'],
      ['challenge_won_me', 'Challenges', 'you', 'You beat someone in a challenge'],
      ['challenge_draw_me', 'Challenges', 'you', 'Your challenge ends in a draw'],
      ['challenges_others', 'Challenges', 'others', 'Other challenges in the pack'],
      ['rank_passed_xp_me', 'Ranks', 'you', 'Someone passes you on the leaderboard'],
      ['rank_passed_challenge_me', 'Ranks', 'you', 'Someone passes you on the challenge standings'],
      ['rank_passed_others', 'Ranks', 'others', 'Rank changes between others'],
      ['event_open', 'Events', 'everyone', 'A new event opens'],
      ['event_closed_me', 'Events', 'you', 'An event you took part in closes'],
      ['event_closed_others', 'Events', 'others', 'Other events close'],
      ['level_up_others', 'The pack', 'others', 'Someone levels up'],
      ['run_milestone_others', 'The pack', 'others', 'Someone passes a distance milestone'],
      ['badge_earned_others', 'The pack', 'others', 'Someone earns a badge'],
      ['streak_broken_others', 'The pack', 'others', 'Someone loses a streak'],
      ['release_published', 'System', 'everyone', 'A new RunQuest version is out'],
    ];
    expect(NOTIFICATION_KINDS.map((k) => [k.kind, k.group, k.role, k.label])).toEqual(expected);
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

  it('classifyNotification: rank_passed med mål jag ger rätt slag per mått', () => {
    expect(classifyNotification(row('rank_passed', OTHER, ME, { measure: 'xp', passer_rank: 1, passed_rank: 2 }), ME)).toBe('rank_passed_xp_me');
    expect(classifyNotification(row('rank_passed', OTHER, ME, { measure: 'challenge_points', passer_rank: 1, passed_rank: 2 }), ME)).toBe(
      'rank_passed_challenge_me',
    );
    // Ett okänt, saknat eller trasigt mått ger aldrig fel reglage: raden räknas inte (fail-closed, som en okänd typ).
    for (const payload of [{}, null, undefined, { measure: 'weekly' }, { measure: 5 }, 'xp']) {
      expect(classifyNotification(row('rank_passed', OTHER, ME, payload), ME), JSON.stringify(payload)).toBeNull();
    }
  });

  it('rank_passed med aktör jag är own, med två andra är rank_passed_others', () => {
    for (const measure of ['xp', 'challenge_points']) {
      const payload = { measure, passer_rank: 1, passed_rank: 2 };
      expect(classifyNotification(row('rank_passed', ME, OTHER, payload), ME), measure).toBe('own');
      expect(classifyNotification(row('rank_passed', OTHER, THIRD, payload), ME), measure).toBe('rank_passed_others');
    }
    // Raderad passerare eller passerad är aldrig jag.
    expect(classifyNotification(row('rank_passed', null, THIRD, { measure: 'xp' }), ME)).toBe('rank_passed_others');
    expect(classifyNotification(row('rank_passed', OTHER, null, { measure: 'xp' }), ME)).toBe('rank_passed_others');
  });

  it('challenge_accepted med mål jag ger challenge_accepted_me, aktör jag är own, annars challenges_others', () => {
    expect(classifyNotification(row('challenge_accepted', OTHER, ME), ME)).toBe('challenge_accepted_me');
    expect(classifyNotification(row('challenge_accepted', ME, OTHER), ME)).toBe('own');
    expect(classifyNotification(row('challenge_accepted', OTHER, THIRD), ME)).toBe('challenges_others');
    expect(classifyNotification(row('challenge_accepted', null, null), ME)).toBe('challenges_others');
  });

  it('event_closed med mig i entrant_ids är event_closed_me, annars event_closed_others', () => {
    const closed = (payload: unknown) => classifyNotification(row('event_closed', null, null, payload), ME);
    expect(closed({ entrant_ids: [OTHER, ME, THIRD] })).toBe('event_closed_me');
    expect(closed({ entrant_ids: [ME] })).toBe('event_closed_me');
    expect(closed({ entrant_ids: [OTHER, THIRD] })).toBe('event_closed_others');
    // Exakt id-jämförelse som övriga slag: ett annat skiftläge eller en delsträng är inte jag.
    expect(closed({ entrant_ids: [ME.toUpperCase(), `${ME}x`, ME.slice(1)] })).toBe('event_closed_others');

    // Fail-safe: saknat, tomt eller felformat fält ger others och aldrig ett undantag.
    for (const payload of [
      undefined, null, 'text', 7, [], {}, { entrant_ids: [] }, { entrant_ids: null }, { entrant_ids: ME },
      { entrant_ids: { 0: ME } }, { entrant_ids: [null, 5, {}, [ME]] }, { top: [{ user_id: ME }] }, { details: { entrant_ids: [ME] } },
    ]) {
      expect(() => closed(payload), JSON.stringify(payload)).not.toThrow();
      expect(closed(payload), JSON.stringify(payload)).toBe('event_closed_others');
    }
    // Lagrade id:n är gemener (normalizeEntrantIds): betraktarens id gemeniseras, aldrig det lagrade.
    const closedFor = (viewer: string, ids: string[]) => classifyNotification(row('event_closed', null, null, { entrant_ids: ids }), viewer);
    expect(closedFor('U-ME', ['u-me'])).toBe('event_closed_me');
    expect(closedFor('u-me', ['U-ME'])).toBe('event_closed_others');
    expect(closedFor('U-ME', ['U-ME'])).toBe('event_closed_others');
    // Ett tomt betraktar-id matchar aldrig ett tomt id i listan.
    expect(classifyNotification(row('event_closed', null, null, { entrant_ids: [''] }), '')).toBe('event_closed_others');
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

  it('challenge_received med mig som både aktör och mål är challenge_received_me', () => {
    expect(classifyNotification(row('challenge_received', ME, ME), ME)).toBe('challenge_received_me');
  });

  it('ett tomt id är aldrig betraktaren, inte ens när betraktar-id:t är tomt', () => {
    expect(classifyNotification(row('level_up', '', null), '')).toBe('level_up_others');
    expect(classifyNotification(row('challenge_won', '', ''), '')).toBe('challenges_others');
    expect(classifyNotification(row('challenge_draw', '', ''), '')).toBe('challenges_others');
    expect(classifyNotification(row('title_taken', '', ''), '')).toBe('title_others');
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
    const targetedTypes = new Set<string>([
      'title_taken', 'challenge_received', 'challenge_won', 'challenge_draw', 'challenge_accepted', 'rank_passed',
    ]);
    const targetsOf = (type: string): Array<string | null> =>
      targetedTypes.has(type) ? [null, ME, OTHER, THIRD] : [null];
    // rank_passed har alltid ett mått i loggen; utan det är en rad som rör mig inte klassificerbar (se egen test).
    const payloadOf = (type: string): unknown => (type === 'rank_passed' ? { measure: 'xp' } : {});
    const roleOf = new Map(NOTIFICATION_KINDS.map((k) => [k.kind, k.role]));
    let checked = 0;

    for (const type of ACTIVITY_TYPES) {
      for (const actor of actorsOf(type)) {
        for (const target of targetsOf(type)) {
          const r = row(type, actor, target, payloadOf(type));
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

  it('varje ActivityType är fortfarande klassificerad (kontraktstest)', () => {
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

  it('isNotifiable: event_closed där jag deltog styrs av event_closed_me, övriga av event_closed_others', () => {
    const mine = notifiable({ type: 'event_closed', actorId: null, payload: { entrant_ids: [OTHER, ME] } });
    const theirs = notifiable({ type: 'event_closed', actorId: null, payload: { entrant_ids: [OTHER] } });
    expect(isNotifiable(mine, viewer())).toBe(true);
    expect(isNotifiable(mine, viewer({ settings: { [notifyKey('event_closed_me')]: false } }))).toBe(false);
    // De två reglagen delar aldrig en rad.
    expect(isNotifiable(mine, viewer({ settings: { [notifyKey('event_closed_others')]: false } }))).toBe(true);
    expect(isNotifiable(theirs, viewer({ settings: { [notifyKey('event_closed_me')]: false } }))).toBe(true);
    expect(isNotifiable(theirs, viewer({ settings: { [notifyKey('event_closed_others')]: false } }))).toBe(false);
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

  it('isNotifiable: ett golv eller id som inte är ett ändligt tal är aldrig en notis, null-golv betyder 0', () => {
    expect(isNotifiable(notifiable({ id: 1 }), viewer({ floor: null }))).toBe(true);
    for (const bad of [Number.NaN, undefined, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isNotifiable(notifiable(), viewer({ floor: bad as unknown as number })), String(bad)).toBe(false);
    }
    for (const bad of [Number.NaN, undefined, null, Number.POSITIVE_INFINITY]) {
      expect(isNotifiable(notifiable({ id: bad as unknown as number }), viewer({ floor: null })), String(bad)).toBe(
        false,
      );
    }
  });

  it('isNotifiable: bara isBackfill === false släpps igenom', () => {
    expect(isNotifiable(notifiable({ isBackfill: false }), viewer())).toBe(true);
    for (const bad of [undefined, null, 0, '']) {
      expect(isNotifiable(notifiable({ isBackfill: bad as unknown as boolean }), viewer()), String(bad)).toBe(false);
    }
  });

  it('isNotifiable: ett sträng-id matchas inte mot readIds och är aldrig en notis (anroparen använder Number)', () => {
    const asString = '150' as unknown as number;
    expect(isNotifiable(notifiable({ id: asString }), viewer())).toBe(false);
    expect(isNotifiable(notifiable({ id: asString }), viewer({ readIds: new Set([150]) }))).toBe(false);
    expect(isNotifiable(notifiable({ id: Number('150') }), viewer())).toBe(true);
  });

  it('isNotifiable: ett inställningsvärde som inte är boolean faller tillbaka på default', () => {
    for (const bad of [null, 0, '', 'false', undefined]) {
      expect(
        isNotifiable(notifiable(), viewer({ settings: { [notifyKey('level_up_others')]: bad } })),
        String(bad),
      ).toBe(true);
    }
  });
});

describe('isKindEnabled', () => {
  it('isKindEnabled: boolean ur inställningarna, annars slagets default', () => {
    for (const def of NOTIFICATION_KINDS) {
      expect(isKindEnabled(def.kind, {}), def.kind).toBe(def.default);
      expect(isKindEnabled(def.kind, { [def.key]: false }), def.kind).toBe(false);
      expect(isKindEnabled(def.kind, { [def.key]: true }), def.kind).toBe(true);
      for (const bad of [null, 0, '', 'false', 'off', undefined, {}]) {
        expect(isKindEnabled(def.kind, { [def.key]: bad }), `${def.kind} ${String(bad)}`).toBe(def.default);
      }
    }
    // Ett annat slags nyckel påverkar inte.
    expect(isKindEnabled('level_up_others', { [notifyKey('badge_earned_others')]: false })).toBe(true);
  });
});
