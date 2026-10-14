/**
 * The decision table of the athlete deauthorize handler (ADR 010 decision 7.4.3), on its own: what each answer from the token path
 * and from GET /athlete means. The ports are stubs and removeStravaConnection is a spy, so a case here says "removed" or "not
 * removed" and never anything about the chain behind it (that is stravaAthleteDeauthorize.test.ts, with the real worker).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({ default: {}, supabase: { client: {} }, getSupabaseClient: vi.fn() }));
vi.mock('../stravaConnection.js', () => ({ removeStravaConnection: vi.fn().mockResolvedValue(undefined) }));

import { removeStravaConnection } from '../stravaConnection.js';
import { createAthleteDeauthorizeHandler } from '../stravaWebhook/handlers/athleteDeauthorize.js';
import type { RunStore, StravaApi, StravaConnection } from '../stravaWebhook/ports.js';
import type { StravaResponse } from '../stravaWebhook/decideAction.js';
import { createInMemoryRunStore } from '../../test-utils/inMemoryWebhookPorts.js';
import type { WebhookHandlerContext } from '../stravaWebhookWorker.js';

type TokenAnswer = Awaited<ReturnType<StravaApi['getAccessToken']>>;
const state = { expiresAt: null, connectionDate: null, consentVersion: null };
const goodToken: TokenAnswer = { ok: true, accessToken: 'the-access-token', refreshed: false, ...state };
const notConnected: TokenAnswer = { ok: false, reason: 'not_connected' };

interface Setup {
  token?: TokenAnswer;
  athlete?: StravaResponse | (() => StravaResponse | Promise<StravaResponse>);
  /** What getConnection answers on its 1st, 2nd, ... call (the last one repeats). An Error is thrown. */
  connections?: Array<StravaConnection | null | Error>;
  updates?: Record<string, unknown>;
  budget?: { usage: () => { daily: number; limitDaily: number } };
}

function build(setup: Setup = {}) {
  const order: string[] = [];
  const connections = setup.connections ?? [{ syncPaused: false, connectionDate: null }];
  let reads = 0;
  const base = createInMemoryRunStore();
  const runs: RunStore = {
    ...base,
    async getConnection() {
      order.push('getConnection');
      const answer = connections[Math.min(reads, connections.length - 1)];
      reads += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const calls = { fetchAthlete: [] as string[], refresh: 0 };
  const strava: StravaApi = {
    async getAccessToken() {
      order.push('getAccessToken');
      return setup.token ?? goodToken;
    },
    async refreshAccessToken() {
      calls.refresh += 1;
      return goodToken;
    },
    async fetchActivity() {
      throw new Error('a deauthorize never reads an activity');
    },
    async fetchAthlete(accessToken) {
      order.push('fetchAthlete');
      calls.fetchAthlete.push(accessToken);
      const answer = setup.athlete ?? { kind: 'http', status: 401 };
      return typeof answer === 'function' ? answer() : answer;
    },
  };
  const handler = createAthleteDeauthorizeHandler(setup.budget ? { budget: setup.budget } : {});
  const ctx = {
    event: { id: 1, object_type: 'athlete', aspect_type: 'update', object_id: 5001, owner_id: 5001, updates: setup.updates ?? { authorized: 'false' } },
    userId: 'user-1',
    attempts: 0,
    strava,
    runs,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  } as unknown as WebhookHandlerContext;
  return { run: () => handler(ctx), order, calls };
}

beforeEach(() => {
  vi.mocked(removeStravaConnection).mockReset().mockResolvedValue(undefined);
});

const removedWithoutRevoke = { status: 'done', outcome: 'deauthorized_runs_deleted', recalculateFrom: null };

describe('athlete deauthorize: what Strava says', () => {
  it('a 401 from GET /athlete confirms and removes the connection, without a revoke and with no recalculation of its own', async () => {
    const { run, calls } = build({ athlete: { kind: 'http', status: 401 } });

    const result = await run();

    expect(result).toEqual(removedWithoutRevoke);
    // The exact options: the reason and nothing else, so there is no revoke callback to call Strava again.
    expect(removeStravaConnection).toHaveBeenCalledTimes(1);
    expect(removeStravaConnection).toHaveBeenCalledWith('user-1', { reason: 'deauthorized' });
    expect(calls.fetchAthlete).toEqual(['the-access-token']);
  });

  it('a 200 from GET /athlete is not confirmed and removes nothing', async () => {
    const { run } = build({ athlete: { kind: 'http', status: 200 } });

    expect(await run()).toEqual({ status: 'done', outcome: 'ignored_not_confirmed', recalculateFrom: null });
    expect(removeStravaConnection).not.toHaveBeenCalled();
  });

  it('a 5xx, a network error or any other status from GET /athlete is a retry and removes nothing', async () => {
    const cases: Array<[StravaResponse, string]> = [
      [{ kind: 'http', status: 500 }, 'server_error'],
      [{ kind: 'http', status: 503 }, 'server_error'],
      [{ kind: 'network_error' }, 'network_error'],
      [{ kind: 'http', status: 403 }, 'unexpected_status'],
      [{ kind: 'http', status: 404 }, 'unexpected_status'],
      [{ kind: 'http', status: 400 }, 'unexpected_status'],
    ];
    for (const [athlete, error] of cases) {
      const { run } = build({ athlete });
      expect(await run(), JSON.stringify(athlete)).toEqual({ status: 'retry', error });
    }
    expect(removeStravaConnection).not.toHaveBeenCalled();
  });

  it('a 429 from GET /athlete is a wait, of the kind the budget says, and removes nothing', async () => {
    const rate = build({ athlete: { kind: 'http', status: 429 }, budget: { usage: () => ({ daily: 10, limitDaily: 3000 }) } });
    const daily = build({ athlete: { kind: 'http', status: 429 }, budget: { usage: () => ({ daily: 3000, limitDaily: 3000 }) } });

    expect(await rate.run()).toEqual({ status: 'wait', kind: 'rate_limit' });
    expect(await daily.run()).toEqual({ status: 'wait', kind: 'daily_limit' });
    expect(removeStravaConnection).not.toHaveBeenCalled();
  });

  it('a 401 is final: the token is not renewed and Strava is asked once', async () => {
    const { run, calls } = build({ athlete: { kind: 'http', status: 401 } });

    await run();

    expect(calls.refresh).toBe(0);
    expect(calls.fetchAthlete).toHaveLength(1);
  });
});

describe('athlete deauthorize: the token path', () => {
  it('a failed token refresh is a retry and never a confirmation, because a rejected refresh token cannot be told from a network error', async () => {
    const { run, calls } = build({ token: { ok: false, reason: 'refresh_failed', ...state } });

    expect(await run()).toEqual({ status: 'retry', error: 'token_refresh_failed' });
    expect(calls.fetchAthlete).toEqual([]);
    expect(removeStravaConnection).not.toHaveBeenCalled();
  });

  it('a stored connection with no refresh token cannot be verified with Strava, so it is a retry and removes nothing', async () => {
    const { run, calls } = build({ token: { ok: false, reason: 'no_refresh_token', ...state } });

    expect(await run()).toEqual({ status: 'retry', error: 'no_refresh_token' });
    expect(removeStravaConnection).not.toHaveBeenCalled();
    expect(calls.fetchAthlete).toEqual([]);
  });

  it('no connection row is an unknown owner and removes nothing', async () => {
    const { run, calls } = build({ connections: [null] });

    expect(await run()).toEqual({ status: 'done', outcome: 'ignored_unknown_owner', recalculateFrom: null });
    expect(calls.fetchAthlete).toEqual([]);
    expect(removeStravaConnection).not.toHaveBeenCalled();
  });

  it('the connection is read before the token and before Strava is asked', async () => {
    const { run, order } = build({ athlete: { kind: 'http', status: 200 } });

    await run();

    expect(order).toEqual(['getConnection', 'getAccessToken', 'fetchAthlete']);
  });

  it('a database error on the connection read is a retry that touches neither the token nor Strava', async () => {
    const { run, order } = build({ connections: [new Error('db down')] });

    expect(await run()).toEqual({ status: 'retry', error: 'connection_read_failed' });
    expect(order).toEqual(['getConnection']);
    expect(removeStravaConnection).not.toHaveBeenCalled();
  });

  it('not connected from the token path is an unknown owner only when the connection read confirms it', async () => {
    const connected: StravaConnection = { syncPaused: false, connectionDate: null };
    // getAccessToken reports a failed database read as "not connected" (stravaClient). The row was there a moment ago.
    const stillThere = build({ token: notConnected, connections: [connected, connected] });
    const gone = build({ token: notConnected, connections: [connected, null] });
    const unreadable = build({ token: notConnected, connections: [connected, new Error('db down')] });

    expect(await stillThere.run()).toEqual({ status: 'retry', error: 'token_read_failed' });
    expect(await gone.run()).toEqual({ status: 'done', outcome: 'ignored_unknown_owner', recalculateFrom: null });
    expect(await unreadable.run()).toEqual({ status: 'retry', error: 'token_read_failed' });
    expect(removeStravaConnection).not.toHaveBeenCalled();
    expect(stillThere.calls.fetchAthlete).toEqual([]);
  });
});

describe('athlete deauthorize: the removal', () => {
  it('a removal that throws is a retry with its code, and the event is not finished', async () => {
    vi.mocked(removeStravaConnection).mockRejectedValue(Object.assign(new Error('failed for 5001 at 59.3,18.0 "secret"'), { code: '57P01' }));
    const { run } = build();

    const result = await run();

    expect(result).toEqual({ status: 'retry', error: 'removal_failed:57P01' });
  });

  it('a paused connection is verified and removed like any other', async () => {
    const { run } = build({ connections: [{ syncPaused: true, connectionDate: null }] });

    expect(await run()).toEqual(removedWithoutRevoke);
  });

  it('the boolean false is read like the string "false"', async () => {
    const asString = build({ updates: { authorized: 'false' } });
    const asBoolean = build({ updates: { authorized: false } });

    expect(await asString.run()).toEqual(removedWithoutRevoke);
    expect(await asBoolean.run()).toEqual(removedWithoutRevoke);
    expect(removeStravaConnection).toHaveBeenCalledTimes(2);
  });
});
