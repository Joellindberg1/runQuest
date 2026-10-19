import { afterEach, describe, expect, it } from 'vitest';
import { buildRightNow, formatRemaining, streakDeadline, type RightNowInput, type ShellEvent } from './rightNowItems';

// 2026-10-04 20:00 i Stockholm (sommartid, +02:00 till 25 okt) = 18:00 UTC.
const NOW = new Date('2026-10-04T18:00:00Z');
const HOUR = 3_600_000;

const baseInput: RightNowInput = { now: NOW, streak: null, events: [], duel: null, strava: null };

const event = (over: Partial<ShellEvent> = {}): ShellEvent => ({
  id: 'e1', kind: 'participation', name: 'Evening run', status: 'active',
  startsAt: '2026-10-04T15:00:00Z', endsAt: new Date(NOW.getTime() + 17 * HOUR).toISOString(),
  rewardXp: 25, done: false, rank: null, entered: true, ...over,
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

  it('räknar igår rätt över månads- och årsskifte', () => {
    expect(streakDeadline('2026-09-30', new Date('2026-10-01T10:00:00Z'))?.ranToday).toBe(false);
    expect(streakDeadline('2026-12-31', new Date('2027-01-01T10:00:00Z'))?.ranToday).toBe(false);
    expect(streakDeadline('2026-12-30', new Date('2027-01-01T10:00:00Z'))).toBeNull();
  });

  it('en runda daterad efter idag ger ingen deadline', () => {
    expect(streakDeadline('2026-10-05', NOW)).toBeNull();
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

  it('Strava: ej kopplat ger Connect-pill (länk till /settings, tour-ankare); kopplad ger ingen pill, och ingen nästa-synk-tid', () => {
    const connect = buildRightNow({ ...baseInput, strava: { connected: false } });
    expect(connect).toHaveLength(1);
    expect(connect[0]).toMatchObject({ kind: 'strava', value: 'Connect', tone: 'up', to: '/settings', tourAnchor: 'right-now-strava' });
    expect(buildRightNow({ ...baseInput, strava: null })).toEqual([]);
    expect(buildRightNow({ ...baseInput, strava: { connected: true } })).toEqual([]);
  });

  it('en tävling efter slutdatum står som Settling, inte som noll tid kvar', () => {
    const items = buildRightNow({
      ...baseInput,
      events: [event({ id: 'comp', kind: 'competition', name: 'Weekly km', endsAt: new Date(NOW.getTime() - 60_000).toISOString() })],
    });
    expect(items[0]).toMatchObject({ label: 'Weekly km', value: 'Settling' });
  });

  it('tävling: placering när jag är med, "Weekly competition" utan rank, "Not entered" när jag inte är med än', () => {
    const note = (over: Partial<ShellEvent>) => buildRightNow({ ...baseInput, events: [event({ kind: 'competition', ...over })] })[0].note;
    expect(note({ rank: 2 })).toBe('#2 in the pack');
    expect(note({ rank: null })).toBe('Weekly competition');
    expect(note({ rank: null, entered: false })).toBe('Not entered');
  });

  it('ordning: streak → event → duell → Strava (Connect-pillen)', () => {
    const items = buildRightNow({
      now: NOW,
      streak: { current: 2, lastRunDate: '2026-10-03' },
      events: [event()],
      duel: { id: 'd1', opponentName: 'Adam', metric: 'km', endDate: '2026-10-06' },
      strava: { connected: false },
    });
    expect(items.map((i) => i.kind)).toEqual(['streak', 'event', 'duel', 'strava']);
  });
});

describe('duellfönstret räknas i gruppens tid (Stockholm), inte webbläsarens', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // Vinterns offset i minuter (getTimezoneOffset): vaktar att TZ-bytet slog igenom, annars bevisar testet ingenting.
  const zones: Array<[string, number]> = [['America/New_York', 300], ['Asia/Tokyo', -540], ['Europe/Stockholm', -60]];
  const duelValue = (now: string, startDate: string | undefined, endDate: string) =>
    buildRightNow({ ...baseInput, now: new Date(now), duel: { id: 'd1', opponentName: 'Adam', metric: 'km', startDate, endDate } })[0].value;

  for (const [tz, winterOffset] of zones) {
    describe(`webbläsare i ${tz}`, () => {
      const useZone = () => {
        process.env.TZ = tz;
        expect(new Date(Date.UTC(2026, 0, 10, 12)).getTimezoneOffset()).toBe(winterOffset);
      };

      it('en duell som startar vid nästa Stockholm-midnatt står 30 minuter före midnatt som "in 30 m"', () => {
        useZone();
        // 23:30 i Stockholm den 4 okt (sommartid) = 21:30 UTC. Duellen startar 00:00 Stockholm = 22:00 UTC.
        expect(duelValue('2026-10-04T21:30:00Z', '2026-10-05', '2026-10-10')).toBe('in 30 m');
      });

      it('pågående duell: tiden kvar räknas till 00:00 Stockholm dagen efter slutdatumet', () => {
        useZone();
        // 12:00 Stockholm den 5 okt = 10:00 UTC. Slutdatum 5 okt slutar 00:00 den 6:e Stockholm = 22:00 UTC, 12 h senare.
        expect(duelValue('2026-10-05T10:00:00Z', '2026-10-05', '2026-10-05')).toBe('12h');
      });

      it('sommartidsbytet 25 okt (dygnet är 25 h) räknas med Stockholms klocka, inte som +24 h', () => {
        useZone();
        // Slutdatum 25 okt slutar 00:00 den 26:e Stockholm = 25 okt 23:00 UTC. Från 00:30 Stockholm den 25:e (22:30 UTC den 24:e) är det 24,5 h.
        expect(duelValue('2026-10-24T22:30:00Z', '2026-10-24', '2026-10-25')).toBe('1 d');
        expect(duelValue('2026-10-25T21:30:00Z', '2026-10-24', '2026-10-25')).toBe('1h');
      });
    });
  }

  it('utan startdatum räknas bara slutet, i Stockholm-tid', () => {
    process.env.TZ = 'America/New_York';
    expect(duelValue('2026-10-05T10:00:00Z', undefined, '2026-10-05')).toBe('12h');
  });
});
