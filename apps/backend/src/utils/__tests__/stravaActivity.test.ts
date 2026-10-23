/**
 * Stravas rundag och km finns på ETT ställe (utils/stravaActivity.ts). Rundans dag är atletens lokala datum ur `start_date_local`
 * och räknas inte om till gruppens tidszon; testerna kör fejkade aktiviteter, aldrig Strava.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));

import { buildStravaRunRow } from '../../services/stravaImport.js';
import { stravaActivity } from '../../test-utils/fakeStrava.js';
import { setGroupTimeZoneSource } from '../groupTimeZone.js';
import { stravaDayIfValid, stravaKm, stravaRunDay } from '../stravaActivity.js';

afterEach(() => setGroupTimeZoneSource());

describe('stravaRunDay', () => {
  it('is the date part of start_date_local, the athlete\'s own day', () => {
    expect(stravaRunDay(stravaActivity({ start_date_local: '2026-10-12T07:30:00Z' }))).toBe('2026-10-12');
  });

  it('keeps the athlete\'s local date after midnight and does not move it to another day', () => {
    // 00:30 lokal tid; med falskt Z ser det ut som 00:30 UTC, men datumet är löparens.
    expect(stravaRunDay(stravaActivity({ start_date_local: '2026-10-13T00:30:00Z' }))).toBe('2026-10-13');
    expect(stravaRunDay(stravaActivity({ start_date_local: '2026-10-12T23:59:59Z' }))).toBe('2026-10-12');
  });

  it('is not recounted into the time zone of the group', () => {
    setGroupTimeZoneSource(() => 'America/New_York');
    const activity = stravaActivity({ start_date_local: '2026-10-13T00:30:00Z' });
    expect(stravaRunDay(activity)).toBe('2026-10-13');
    expect(buildStravaRunRow('user-1', activity).date).toBe('2026-10-13');
  });

  it('takes a plain date as it is', () => {
    expect(stravaRunDay({ start_date_local: '2026-10-12' })).toBe('2026-10-12');
  });
});

describe('stravaDayIfValid', () => {
  it('gives the date of a timestamp or a plain date', () => {
    expect(stravaDayIfValid('2026-10-12T07:30:00Z')).toBe('2026-10-12');
    expect(stravaDayIfValid('2026-10-12')).toBe('2026-10-12');
  });

  it('gives null for anything that does not start with a date', () => {
    expect(stravaDayIfValid('')).toBeNull();
    expect(stravaDayIfValid('yesterday')).toBeNull();
    expect(stravaDayIfValid('12/10/2026')).toBeNull();
    expect(stravaDayIfValid(undefined)).toBeNull();
    expect(stravaDayIfValid(null)).toBeNull();
    expect(stravaDayIfValid(20261012)).toBeNull();
  });
});

describe('stravaKm', () => {
  it('turns Strava metres into kilometres', () => {
    expect(stravaKm(5000)).toBe(5);
    expect(stravaKm(1000)).toBe(1);
    expect(stravaKm(5234.5)).toBe(5.2345);
    expect(stravaKm(0)).toBe(0);
  });

  it('is what the run row stores', () => {
    expect(buildStravaRunRow('user-1', stravaActivity({ distance: 8575 })).distance).toBe(8.575);
  });
});
