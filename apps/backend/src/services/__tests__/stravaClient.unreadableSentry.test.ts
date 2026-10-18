/**
 * A token that cannot be read, seen in Sentry (ADR 013 decision 9): one event per cause and process, not one per read. The real logger
 * feeds a fake Sentry transport. Database: createFakeDb. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { startFakeSentry, type FakeSentry } from '../../observability/__tests__/helpers/fakeSentry.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { legacyToken } from '../../test-utils/stravaTokens.js';
import { ACTIVE_KEY_ENV } from '../../utils/secretBox.js';
import { getValidAccessToken, resetUnreadableLogThrottle } from '../stravaClient.js';

let sentry: FakeSentry;
beforeEach(() => {
  resetUnreadableLogThrottle();
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, n) => ({ user_id: `user-${n}`, access_token: 'enc:v1:test-1:AAAA', refresh_token: legacyToken('legacy-r'), expires_at: 9999999999 }));

function use(data: Row[]) {
  const db = createFakeDb({ strava_tokens: data }, { primaryKeys: { strava_tokens: ['user_id'] } });
  vi.mocked(getSupabaseClient).mockReturnValue(db.client as never);
}

describe('unreadable tokens in sentry', () => {
  it('many reads that fail for the same cause are one event', async () => {
    use(rows(6));

    for (let round = 0; round < 3; round += 1) {
      for (let n = 0; n < 6; n += 1) expect(await getValidAccessToken(`user-${n}`)).toEqual({ ok: false, reason: 'token_unreadable' });
    }

    const sent = await sentry.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('error');
    expect(sent[0].tags?.alert).toBeUndefined(); // not a critical alarm: that is the startup one
    expect(JSON.stringify(sent[0])).toContain('bad_format');
  });

  it('a missing key is one event for the reads, whoever meets it', async () => {
    use(rows(4));
    vi.stubEnv(ACTIVE_KEY_ENV, '');

    for (let n = 0; n < 4; n += 1) await getValidAccessToken(`user-${n}`);
    await getValidAccessToken('user-0');

    const sent = await sentry.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('key_missing');
  });

  it('a second cause is a second event', async () => {
    use([...rows(2), { user_id: 'odd', access_token: 'x', refresh_token: legacyToken('legacy-r'), expires_at: 9999999999 }]);

    await getValidAccessToken('user-0');
    await getValidAccessToken('user-1');
    await getValidAccessToken('odd');

    expect(await sentry.flush()).toHaveLength(2);
  });
});
