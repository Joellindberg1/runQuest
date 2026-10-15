/** findUserByAthleteId — mappningen från Stravas athlete-id (webhookens owner_id) till RunQuest-användaren. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createFakeDb } from '../../routes/__tests__/helpers/fakeDb.js';
import { findUserByAthleteId } from '../stravaAthlete.js';

beforeEach(() => vi.clearAllMocks());

const tokenRow = (user_id: string, strava_athlete_id: number | null) => ({
  user_id, access_token: 'at', refresh_token: 'rt', expires_at: 9999999999, strava_athlete_id,
});

describe('findUserByAthleteId', () => {
  it('findUserByAthleteId returns the owning user or null', async () => {
    const db = createFakeDb({ strava_tokens: [tokenRow('user-1', 111), tokenRow('user-2', 222), tokenRow('user-3', null)] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    expect(await findUserByAthleteId(222)).toBe('user-2');
    expect(await findUserByAthleteId(111)).toBe('user-1');
    expect(await findUserByAthleteId(999)).toBeNull(); // okänd ägare
  });

  it('throws on a database error instead of answering null, so a failure is never read as "unknown owner"', async () => {
    const db = createFakeDb({ strava_tokens: [] }, { errors: { strava_tokens: { message: 'connection lost' } } });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    await expect(findUserByAthleteId(111)).rejects.toThrow(/connection lost/);
  });

  it('returns null without a query for an id that cannot be a Strava athlete id', async () => {
    const db = createFakeDb({ strava_tokens: [tokenRow('user-3', null)] });
    vi.mocked(getSupabaseClient).mockReturnValue(db.client as any);

    for (const bad of [Number.NaN, 0, -5, 1.5, Number.POSITIVE_INFINITY]) expect(await findUserByAthleteId(bad)).toBeNull();
    expect(db.queries).toHaveLength(0); // användare utan id (null) får aldrig matcha
  });
});
