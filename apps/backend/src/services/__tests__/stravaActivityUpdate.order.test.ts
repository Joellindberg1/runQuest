/**
 * Strava delivers webhook events out of order, twice, and late. The handlers are built so that the ORDER does not matter: every
 * handler fetches the activity afresh and brings the database into line with what Strava shows NOW. This test pins that.
 *
 * Design: the Strava fake has ONE fixed final state per scenario (the activity is public with 7 km, or it is gone, private, or turned
 * into a ride), whatever event arrives. For each scenario and each starting database (no run, or a stale run) the same events are
 * delivered in EVERY order, once as one batch and once as one batch per event, through the real worker, the real adapters and the
 * real recompute. The final state of the runs table (every column, XP and streak of the neighbours included) must be identical in
 * every order, and equal to what ONE update event gives alone. The reference state is also checked against the plain facts, so a
 * bug that is the same in every order cannot hide in the comparison.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRAVA_CLIENT_ID = 'client-id';
process.env.STRAVA_CLIENT_SECRET = 'client-secret';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));
vi.mock('../../utils/calculateUserTotals.js', () => ({ calculateUserTotals: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../eventService.js', () => ({
  checkEventQualification: vi.fn().mockResolvedValue(undefined),
  maybeCreateEvent: vi.fn(),
  activateScheduledEvents: vi.fn(),
  settleCompetitionEvents: vi.fn(),
  settleExpiredParticipationEvents: vi.fn(),
}));
vi.mock('../weatherService.js', () => ({
  WeatherService: { fetchAndSaveWeatherForRuns: vi.fn().mockResolvedValue(undefined), backfillMissingWeather: vi.fn() },
}));
vi.mock('../xpConfig.js', async () => {
  const shared = await import('@runquest/shared');
  return {
    getXpConfig: vi.fn(async () => ({
      settings: shared.DEFAULT_ADMIN_SETTINGS,
      streak_multipliers: shared.DEFAULT_STREAK_MULTIPLIERS,
      meta: { settings_source: 'defaults', multipliers_source: 'defaults' },
    })),
    invalidateXpConfigCache: vi.fn(),
  };
});

import { getSupabaseClient } from '../../config/database.js';
import { tokenCols } from '../../test-utils/stravaTokens.js';
import { logger } from '../../utils/logger.js';
import { buildStravaRunRow } from '../stravaImport.js';
import { createStravaWebhookWorker } from '../stravaWebhookWorker.js';
import { STRAVA_WEBHOOK_HANDLERS } from '../stravaWebhook/handlers.js';
import { createRecompute, createRunStore, createStravaApi } from '../stravaWebhook/supabaseAdapters.js';
import type { WebhookAspectType } from '../stravaWebhook/constants.js';
import { createFakeDb, type Row } from '../../routes/__tests__/helpers/fakeDb.js';
import { createInMemoryWebhookStore } from '../../test-utils/inMemoryWebhookPorts.js';
import { withRunForeignKeys } from '../../test-utils/runForeignKeys.js';
import { installFakeStravaFetch, stravaActivity, stravaError } from '../../test-utils/fakeStrava.js';

const START = new Date('2026-10-14T12:07:00.000Z');
const ID = 5001;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const activityOf = (over: Parameters<typeof stravaActivity>[0] = {}) =>
  stravaActivity({ id: ID, start_date: '2026-10-12T05:30:00Z', start_date_local: '2026-10-12T07:30:00Z', distance: 7000, ...over });

/** What Strava shows at the end, whatever was delivered before. */
const FINAL_STATES = {
  public: { answer: () => activityOf(), present: true },
  gone: { answer: () => stravaError(404), present: false },
  private: { answer: () => activityOf({ private: true }), present: false },
  ride: { answer: () => activityOf({ sport_type: 'Ride', type: 'Ride' }), present: false },
} as const;

const neighbour = (id: number, date: string): Row => {
  const { created_at: _createdAt, ...columns } = buildStravaRunRow('user-1', stravaActivity({ id, start_date_local: `${date}T07:30:00Z` }));
  return { id: `run-${id}`, ...columns, xp_gained: 1, base_xp: 1, km_xp: 1, distance_bonus: 0, streak_bonus: 0, multiplier: 1, streak_day: 9 };
};

/** The database before the events: neighbours on the days around the activity, and optionally an older version of the run itself. */
const STARTS = {
  'no run': (): Row[] => [neighbour(100, '2026-10-10'), neighbour(101, '2026-10-13')],
  'a stale run': (): Row[] => [
    neighbour(100, '2026-10-10'),
    { ...neighbour(ID, '2026-10-11'), id: 'run-stale', distance: 3, start_time: '2026-10-11T18:00:00Z', total_elevation_gain: 5 },
    neighbour(101, '2026-10-13'),
  ],
} as const;

const EVENT_KINDS: readonly WebhookAspectType[] = ['create', 'update', 'delete'];

/** Every distinct order of a multiset of event kinds. */
function orders(kinds: readonly WebhookAspectType[]): WebhookAspectType[][] {
  if (kinds.length <= 1) return [[...kinds]];
  const seen = new Set<string>();
  const result: WebhookAspectType[][] = [];
  kinds.forEach((kind, index) => {
    for (const rest of orders([...kinds.slice(0, index), ...kinds.slice(index + 1)])) {
      const order = [kind, ...rest];
      if (!seen.has(order.join())) {
        seen.add(order.join());
        result.push(order);
      }
    }
  });
  return result;
}

async function deliver(
  final: keyof typeof FINAL_STATES,
  start: keyof typeof STARTS,
  order: readonly WebhookAspectType[],
  mode: 'one batch' | 'one batch per event',
) {
  const strava = installFakeStravaFetch({ activities: { [ID]: FINAL_STATES[final].answer() } });
  try {
    const tables: Record<string, Row[]> = {
      strava_tokens: [{ user_id: 'user-1', ...tokenCols('user-1', 'at', 'rt'), expires_at: 9999999999, connection_date: '2026-09-01T09:00:00+00:00', sync_paused: false }],
      runs: STARTS[start](),
      user_boosts: [],
      run_weather: [],
      event_entries: [],
      user_badges: [],
      users: [{ id: 'user-1', event_xp: 0 }],
    };
    const db = createFakeDb(tables, {
      autoIds: true,
      uniqueIndexes: [{ table: 'runs', name: 'idx_runs_external_id', columns: ['user_id', 'external_id'] }],
      primaryKeys: { strava_tokens: ['user_id'] },
    });
    vi.mocked(getSupabaseClient).mockReturnValue(withRunForeignKeys(db.client, tables) as any);
    const store = createInMemoryWebhookStore({ now: () => START });
    const worker = createStravaWebhookWorker({
      store,
      strava: createStravaApi(),
      runs: createRunStore(),
      recompute: createRecompute(),
      handlers: STRAVA_WEBHOOK_HANDLERS,
      now: () => START,
    });

    for (const aspect of order) {
      store.seed({ object_id: ID, aspect_type: aspect });
      if (mode === 'one batch per event') await worker.drain();
    }
    if (mode === 'one batch') await worker.drain();

    return {
      runs: tables.runs
        .map(({ id: _id, created_at: _createdAt, ...columns }) => columns)
        .sort((a, b) => String(a.external_id).localeCompare(String(b.external_id))),
      events: store.rows().map((row) => [row.status, row.attempts]),
    };
  } finally {
    strava.restore();
  }
}

describe('events in any order', () => {
  it('create, update and delete events in any order end in the same final state', async () => {
    const plans: Array<{ label: string; kinds: readonly WebhookAspectType[] }> = [
      { label: 'create, update, delete', kinds: EVENT_KINDS },
      { label: 'create, update, update, delete', kinds: ['create', 'update', 'update', 'delete'] },
    ];
    let compared = 0;

    for (const final of Object.keys(FINAL_STATES) as Array<keyof typeof FINAL_STATES>) {
      for (const start of Object.keys(STARTS) as Array<keyof typeof STARTS>) {
        // The reference: one update event on its own.
        const reference = await deliver(final, start, ['update'], 'one batch');
        const mine = reference.runs.find((run) => run.external_id === String(ID));
        const where = `final state ${final}, starting from ${start}`;

        // The plain facts, so that a bug shared by every order is not hidden by the comparison.
        if (FINAL_STATES[final].present) {
          expect(mine, where).toMatchObject({ source: 'strava', date: '2026-10-12', distance: 7, start_time: '2026-10-12T07:30:00Z' });
          expect(mine!.xp_gained, where).toBeGreaterThan(0);
          expect(mine!.streak_day, where).toBe(1); // the 11th is empty: a fresh streak
          expect(reference.runs.find((run) => run.external_id === '101'), where).toMatchObject({ streak_day: 2 }); // the 13th follows it
        } else {
          expect(mine, where).toBeUndefined();
        }
        expect(reference.runs.filter((run) => run.external_id !== String(ID)).map((run) => run.date), where).toEqual(['2026-10-10', '2026-10-13']);

        for (const { label, kinds } of plans) {
          for (const order of orders(kinds)) {
            for (const mode of ['one batch', 'one batch per event'] as const) {
              const outcome = await deliver(final, start, order, mode);
              const context = `${where}, events ${order.join(' > ')} (${label}), ${mode}`;
              expect(outcome.events.every(([status, attempts]) => status === 'done' && attempts === 0), context).toBe(true);
              expect(outcome.runs, context).toEqual(reference.runs);
              compared += 1;
            }
          }
        }
      }
    }

    // 4 final states x 2 starts x (6 + 12 orders) x 2 modes
    expect(compared).toBe(4 * 2 * (6 + 12) * 2);
  });
});
