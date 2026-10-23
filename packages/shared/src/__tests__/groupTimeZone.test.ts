import { describe, it, expect } from 'vitest';
import { STOCKHOLM_TZ, zoneClock, zoneDay, zoneMidnightIso, stockholmDay, stockholmMidnightIso } from '../calendar.js';
import { groupTimeZone } from '../groupTimeZone.js';

describe('groupTimeZone', () => {
  it('is Stockholm for every group until a time zone per group exists', () => {
    expect(groupTimeZone('group-1')).toBe(STOCKHOLM_TZ);
    expect(groupTimeZone('group-2')).toBe(STOCKHOLM_TZ);
  });

  it('is Stockholm when no group is known', () => {
    expect(groupTimeZone(null)).toBe(STOCKHOLM_TZ);
    expect(groupTimeZone(undefined, () => 'America/New_York')).toBe(STOCKHOLM_TZ);
  });

  it('returns the zone the source gives for the group', () => {
    const source = (groupId: string) => (groupId === 'ny' ? 'America/New_York' : null);
    expect(groupTimeZone('ny', source)).toBe('America/New_York');
    expect(groupTimeZone('other', source)).toBe(STOCKHOLM_TZ);
  });

  it('falls back to Stockholm for an empty or invalid zone instead of throwing', () => {
    expect(groupTimeZone('g', () => '')).toBe(STOCKHOLM_TZ);
    expect(groupTimeZone('g', () => undefined)).toBe(STOCKHOLM_TZ);
    expect(groupTimeZone('g', () => 'Mars/Olympus_Mons')).toBe(STOCKHOLM_TZ);
  });
});

describe('zone functions', () => {
  const at = new Date('2026-10-20T02:30:00.000Z');

  it('zoneDay and zoneClock give the day in the given zone and default to Stockholm', () => {
    expect(zoneDay(at)).toBe('2026-10-20');
    expect(zoneDay(at, 'America/New_York')).toBe('2026-10-19');
    expect(zoneClock(at, 'America/New_York')).toEqual({ date: '2026-10-19', msIntoDay: 22.5 * 3_600_000 });
  });

  it('zoneMidnightIso gives the instant the day starts in the zone, with the offset at midnight', () => {
    expect(zoneMidnightIso('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(zoneMidnightIso('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
    expect(zoneMidnightIso('2026-10-20', 'America/New_York')).toBe('2026-10-20T04:00:00.000Z');
  });

  it('the Stockholm names are the default zone, not another implementation', () => {
    expect(stockholmDay(at)).toBe(zoneDay(at));
    expect(stockholmMidnightIso('2026-03-29')).toBe(zoneMidnightIso('2026-03-29'));
  });
});
