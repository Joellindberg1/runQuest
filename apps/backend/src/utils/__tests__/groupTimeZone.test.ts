import { afterEach, describe, expect, it } from 'vitest';
import { STOCKHOLM_TZ } from '@runquest/shared';
import { groupTimeZone, setGroupTimeZoneSource } from '../groupTimeZone.js';

afterEach(() => setGroupTimeZoneSource());

describe('groupTimeZone (backend)', () => {
  it('is Stockholm for every group until a source is set', () => {
    expect(groupTimeZone('g1')).toBe(STOCKHOLM_TZ);
    expect(groupTimeZone(null)).toBe(STOCKHOLM_TZ);
  });

  it('returns the zone of a set source per group, and Stockholm for the others', () => {
    setGroupTimeZoneSource((groupId) => (groupId === 'ny' ? 'America/New_York' : undefined));
    expect(groupTimeZone('ny')).toBe('America/New_York');
    expect(groupTimeZone('g1')).toBe(STOCKHOLM_TZ);
  });

  it('goes back to Stockholm when the source is cleared', () => {
    setGroupTimeZoneSource(() => 'America/New_York');
    setGroupTimeZoneSource();
    expect(groupTimeZone('ny')).toBe(STOCKHOLM_TZ);
  });
});
