import { describe, expect, it } from 'vitest';
import { buildStravaBanner, importLine } from './stravaModel';

const NOW = new Date('2026-10-04T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe('importLine', () => {
  it('när den senaste Strava-rundan kom in, utan någon rad om nästa synk', () => {
    expect(importLine({ connected: true, expired: false, last_import_at: at(-32) }, NOW)).toBe('Last import 32 min ago');
    expect(importLine({ connected: true, expired: false, last_import_at: at(-3 * 60) }, NOW)).toBe('Last import 3 h ago');
  });

  it('ingen runda har kommit in (null eller saknas): en neutral rad', () => {
    expect(importLine({ connected: true, expired: false, last_import_at: null }, NOW)).toBe('Your runs sync automatically');
    expect(importLine({ connected: true, expired: false }, NOW)).toBe('Your runs sync automatically');
  });
});

describe('buildStravaBanner', () => {
  it('ingen status än → ingen banderoll', () => {
    expect(buildStravaBanner(undefined, NOW)).toBeNull();
  });

  it('kopplad: grön med synkraden', () => {
    expect(buildStravaBanner({ connected: true, expired: false, last_import_at: at(-32) }, NOW)).toEqual({
      tone: 'up', title: 'Strava connected', text: 'Last import 32 min ago', needsSettings: false,
    });
  });

  it('inte kopplad: neutral och pekar på Settings', () => {
    expect(buildStravaBanner({ connected: false, expired: false }, NOW)).toMatchObject({ tone: 'muted', title: 'Strava not connected', needsSettings: true });
  });

  it('utgången koppling: röd och pekar på Settings', () => {
    expect(buildStravaBanner({ connected: true, expired: true }, NOW)).toMatchObject({ tone: 'down', needsSettings: true });
  });
});
