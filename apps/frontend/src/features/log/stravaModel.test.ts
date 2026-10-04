import { describe, expect, it } from 'vitest';
import { buildStravaBanner, syncLine } from './stravaModel';

const NOW = new Date('2026-10-04T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe('syncLine', () => {
  it('senaste och nästa synk', () => {
    expect(syncLine({ last_sync_attempt: at(-32), next_sync_estimated: at(28) }, NOW)).toBe('Last sync 32 min ago · next in 28 min');
  });

  it('en synk som ligger efter sin tid (nästa körning har inte hänt) säger "any moment"', () => {
    expect(syncLine({ last_sync_attempt: at(-95), next_sync_estimated: at(-3) }, NOW)).toBe('Last sync 1 h ago · next any moment');
  });

  it('bara en av dem, eller ingen', () => {
    expect(syncLine({ last_sync_attempt: at(-5), next_sync_estimated: null }, NOW)).toBe('Last sync 5 min ago');
    expect(syncLine({ last_sync_attempt: null, next_sync_estimated: null }, NOW)).toBe('Your runs sync automatically');
    expect(syncLine(undefined, NOW)).toBe('Your runs sync automatically');
  });
});

describe('buildStravaBanner', () => {
  it('ingen status än → ingen banderoll', () => {
    expect(buildStravaBanner(undefined, undefined, NOW)).toBeNull();
  });

  it('kopplad: grön med synkraden', () => {
    expect(buildStravaBanner({ connected: true, expired: false }, { last_sync_attempt: at(-32), next_sync_estimated: at(28) }, NOW)).toEqual({
      tone: 'up', title: 'Strava connected', text: 'Last sync 32 min ago · next in 28 min', needsSettings: false,
    });
  });

  it('inte kopplad: neutral och pekar på Settings', () => {
    expect(buildStravaBanner({ connected: false, expired: false }, undefined, NOW)).toMatchObject({ tone: 'muted', title: 'Strava not connected', needsSettings: true });
  });

  it('utgången koppling: röd och pekar på Settings', () => {
    expect(buildStravaBanner({ connected: true, expired: true }, undefined, NOW)).toMatchObject({ tone: 'down', needsSettings: true });
  });
});
