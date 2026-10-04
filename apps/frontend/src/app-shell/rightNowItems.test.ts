import { describe, expect, it } from 'vitest';
import { buildRightNow, formatRemaining, streakDeadline, type RightNowInput, type ShellEvent } from './rightNowItems';

// 2026-10-04 20:00 i Stockholm (sommartid, +02:00 till 25 okt) = 18:00 UTC.
const NOW = new Date('2026-10-04T18:00:00Z');
const HOUR = 3_600_000;

const baseInput: RightNowInput = { now: NOW, streak: null, events: [], duel: null, strava: null };

const event = (over: Partial<ShellEvent> = {}): ShellEvent => ({
  id: 'e1', kind: 'participation', name: 'Evening run', status: 'active',
  startsAt: '2026-10-04T15:00:00Z', endsAt: new Date(NOW.getTime() + 17 * HOUR).toISOString(),
  rewardXp: 25, done: false, rank: null, ...over,
});

describe('formatRemaining', () => {
  it.each([
    [20_000, '<1 m'],
    [28 * 60_000, '28 m'],
    [6 * HOUR, '6h'],
    [30 * HOUR, '1 d'],
    [72 * HOUR, '3 d'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});

describe('streakDeadline (Stockholm-dagar)', () => {
  it('senaste rundan igår: deadline är slutet på idag (4 h kvar kl 20:00)', () => {
    expect(streakDeadline('2026-10-03', NOW)).toEqual({ msLeft: 4 * HOUR, ranToday: false });
  });

  it('senaste rundan idag: deadline är slutet på morgondagen', () => {
    expect(streakDeadline('2026-10-04', NOW)).toEqual({ msLeft: 28 * HOUR, ranToday: true });
  });

  it('äldre än igår: streaken är redan bruten', () => {
    expect(streakDeadline('2026-10-02', NOW)).toBeNull();
    expect(streakDeadline(null, NOW)).toBeNull();
  });

  it('läser dagen i Stockholm, inte UTC (23:30 UTC = 01:30 nästa dag i Stockholm)', () => {
    const lateUtc = new Date('2026-10-04T23:30:00Z');
    expect(streakDeadline('2026-10-05', lateUtc)?.ranToday).toBe(true);
  });
});

describe('buildRightNow', () => {
  it('saknas data visas inga piller', () => {
    expect(buildRightNow(baseInput)).toEqual([]);
  });

  it('streak: röd när dagens runda saknas, grön när den är gjord; ingen streak → inget piller', () => {
    const atRisk = buildRightNow({ ...baseInput, streak: { current: 4, lastRunDate: '2026-10-03' } });
    expect(atRisk[0]).toMatchObject({ kind: 'streak', tone: 'down', value: '4h left' });

    const safe = buildRightNow({ ...baseInput, streak: { current: 4, lastRunDate: '2026-10-04' } });
    expect(safe[0]).toMatchObject({ kind: 'streak', tone: 'up', value: '1 d left' });

    expect(buildRightNow({ ...baseInput, streak: { current: 0, lastRunDate: '2026-10-04' } })).toEqual([]);
  });

  it('event: öppna före kommande, med nedräkning; klart event visas som Done', () => {
    const items = buildRightNow({
      ...baseInput,
      events: [
        event({ id: 'later', name: 'Sunday long', status: 'scheduled', startsAt: new Date(NOW.getTime() + 5 * HOUR).toISOString() }),
        event({ id: 'open' }),
        event({ id: 'finished', name: 'Morning run', done: true, endsAt: new Date(NOW.getTime() + 2 * HOUR).toISOString() }),
      ],
    });
    expect(items.map((i) => i.label)).toEqual(['Morning run', 'Evening run', 'Sunday long']);
    expect(items.find((i) => i.label === 'Evening run')).toMatchObject({ value: '17h', tone: 'gold', note: '+25 XP' });
    expect(items.find((i) => i.label === 'Morning run')).toMatchObject({ value: 'Done', tone: 'up' });
    expect(items.find((i) => i.label === 'Sunday long')?.value).toBe('in 5h');
  });

  it('duell: etikett ur metric, tid kvar t.o.m. slutdatumets slut', () => {
    const items = buildRightNow({
      ...baseInput,
      duel: { id: 'd1', opponentName: 'Adam', metric: 'runs', startDate: '2026-10-01', endDate: '2026-10-05' },
    });
    expect(items[0]).toMatchObject({ kind: 'duel', label: 'Most runs', note: 'vs Adam', tone: 'duel' });
    expect(items[0].value).toMatch(/^(\d+h|\d+ m|1 d)$/);
  });

  it('Strava: ej kopplat ger Connect-pill (länk till /settings, tour-ankare); kopplad utan känd sync ger ingen; förfallen sync visas som Overdue', () => {
    const connect = buildRightNow({ ...baseInput, strava: { connected: false, nextSyncAt: null } });
    expect(connect).toHaveLength(1);
    expect(connect[0]).toMatchObject({ kind: 'strava', value: 'Connect', tone: 'up', to: '/settings', tourAnchor: 'right-now-strava' });
    expect(buildRightNow({ ...baseInput, strava: null })).toEqual([]);
    expect(buildRightNow({ ...baseInput, strava: { connected: true, nextSyncAt: null } })).toEqual([]);

    const soon = buildRightNow({ ...baseInput, strava: { connected: true, nextSyncAt: '2026-10-04T18:28:00Z' } });
    expect(soon[0]).toMatchObject({ kind: 'strava', value: '28 m', tourAnchor: 'right-now-strava' });

    const late = buildRightNow({ ...baseInput, strava: { connected: true, nextSyncAt: '2026-10-04T17:00:00Z' } });
    expect(late[0].value).toBe('Overdue');
  });

  it('en tävling efter slutdatum står som Settling, inte som noll tid kvar', () => {
    const items = buildRightNow({
      ...baseInput,
      events: [event({ id: 'comp', kind: 'competition', name: 'Weekly km', endsAt: new Date(NOW.getTime() - 60_000).toISOString() })],
    });
    expect(items[0]).toMatchObject({ label: 'Weekly km', value: 'Settling' });
  });

  it('ordning: streak → event → duell → Strava', () => {
    const items = buildRightNow({
      now: NOW,
      streak: { current: 2, lastRunDate: '2026-10-03' },
      events: [event()],
      duel: { id: 'd1', opponentName: 'Adam', metric: 'km', endDate: '2026-10-06' },
      strava: { connected: true, nextSyncAt: '2026-10-04T18:20:00Z' },
    });
    expect(items.map((i) => i.kind)).toEqual(['streak', 'event', 'duel', 'strava']);
  });
});
