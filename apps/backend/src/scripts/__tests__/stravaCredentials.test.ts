import { describe, it, expect } from 'vitest';
import { missingStravaCredentials } from '../lib/stravaCredentials.js';

describe('missingStravaCredentials', () => {
  it('names each Strava credential that is not set, so main can stop before the first call', () => {
    expect(missingStravaCredentials({})).toEqual(['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET']);
    expect(missingStravaCredentials({ STRAVA_CLIENT_ID: 'x' })).toEqual(['STRAVA_CLIENT_SECRET']);
    expect(missingStravaCredentials({ STRAVA_CLIENT_ID: 'x', STRAVA_CLIENT_SECRET: 'y' })).toEqual([]);
    expect(missingStravaCredentials({ STRAVA_CLIENT_ID: '', STRAVA_CLIENT_SECRET: 'y' })).toEqual(['STRAVA_CLIENT_ID']);
  });
});
