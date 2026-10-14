/**
 * The Strava rate budget (ADR 010 decision 9): usage from the response headers, a local counter when they are missing,
 * the soft limit and the wait time. Time is an injected clock, so no test depends on the wall clock or on fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { logger } from '../../utils/logger.js';
import { createStravaRateBudget, isOverSoftLimit, nextResumeAt, registerStravaRateBudget, stravaRateBudget } from '../stravaRateBudget.js';
import { stravaFetch } from '../stravaClient.js';
import { installFakeStravaFetch, stravaActivity, stravaError, stravaTokenResponse, type FakeStrava } from '../../test-utils/fakeStrava.js';

const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities?after=0&per_page=200';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const MINUTE = 60_000;

let now: number;
const at = (hour: number, minute: number, second = 0) => Date.UTC(2026, 9, 14, hour, minute, second);

function newBudget() {
  return createStravaRateBudget({ now: () => now });
}

function response(headers: Record<string, string> = {}, status = 200) {
  return new Response('{}', { status, headers });
}
const readHeaders = (usage: string, limit = '300,3000') => ({ 'X-ReadRateLimit-Usage': usage, 'X-ReadRateLimit-Limit': limit });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  now = at(10, 7);
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Strava rate budget', () => {
  it('rate budget parses read usage and limit from response headers', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('123,1456', '300,3000')));

    expect(budget.usage()).toEqual({ last15Min: 123, daily: 1456, limit15Min: 300, limitDaily: 3000 });
  });

  it('rate budget falls back to a local sliding counter when headers are missing', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response());
    now += 10 * MINUTE;
    budget.recordResponse(ACTIVITIES_URL, response());
    budget.recordResponse(ACTIVITIES_URL, response());
    expect(budget.usage()).toMatchObject({ last15Min: 3, daily: 3, limit15Min: 300, limitDaily: 3000 });

    // The first call is now more than 15 minutes old; it is still inside the day.
    now += 6 * MINUTE;
    expect(budget.usage()).toMatchObject({ last15Min: 2, daily: 3 });

    now += 24 * 60 * MINUTE;
    expect(budget.usage()).toMatchObject({ last15Min: 0, daily: 0 });
  });

  it('rate budget keeps counting local reads on top of the last reported usage', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('100,1000')));
    budget.recordResponse(ACTIVITIES_URL, response());
    budget.recordResponse(ACTIVITIES_URL, response());

    expect(budget.usage()).toMatchObject({ last15Min: 102, daily: 1002 });
  });

  it('rate budget starts a new 15 minute window on the quarter hour once headers are known', () => {
    const budget = newBudget();
    now = at(10, 14, 50);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('250,900')));

    now = at(10, 15, 5);
    expect(budget.usage()).toMatchObject({ last15Min: 0, daily: 900 });
    expect(budget.isOverSoftLimit()).toBe(false);

    budget.recordResponse(ACTIVITIES_URL, response());
    expect(budget.usage()).toMatchObject({ last15Min: 1, daily: 901 });
  });

  it('rate budget starts a new day at UTC midnight once headers are known', () => {
    const budget = newBudget();
    now = at(23, 59, 30);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('10,2500')));

    now = Date.UTC(2026, 9, 15, 0, 0, 10);
    expect(budget.usage()).toMatchObject({ daily: 0 });
  });

  it('rate budget reports over the soft limit at 210 reads in 15 minutes', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('209,500')));
    expect(budget.isOverSoftLimit()).toBe(false);

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('210,501')));
    expect(budget.isOverSoftLimit()).toBe(true);
  });

  it('rate budget reports over the soft limit at 2100 reads in a day', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('5,2099')));
    expect(budget.isOverSoftLimit()).toBe(false);

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('6,2100')));
    expect(budget.isOverSoftLimit()).toBe(true);
  });

  it('rate budget reports over the soft limit from the local counter alone', () => {
    const budget = newBudget();

    for (let i = 0; i < 209; i++) budget.recordResponse(ACTIVITIES_URL, response());
    expect(budget.isOverSoftLimit()).toBe(false);
    budget.recordResponse(ACTIVITIES_URL, response());
    expect(budget.isOverSoftLimit()).toBe(true);
  });

  it('rate budget computes the next quarter hour plus 30 seconds', () => {
    const budget = newBudget();
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('215,500')));

    now = at(10, 7, 12);
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-14T10:15:30.000Z');

    // Exactly on a quarter hour the window has just opened, so the next one is a quarter later.
    now = at(10, 45);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('215,500')));
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-14T11:00:30.000Z');

    now = at(23, 50);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('215,500')));
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-15T00:00:30.000Z');
  });

  it('rate budget computes the next UTC midnight plus 1 minute', () => {
    const budget = newBudget();
    now = at(14, 22);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('3,2100')));

    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-15T00:01:00.000Z');
  });

  it('rate budget waits for the day when both limits are reached', () => {
    const budget = newBudget();
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('250,2500')));

    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-15T00:01:00.000Z');
  });

  it('rate budget warns once when the reported limit differs from the constants', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('1,1', '300,3000')));
    expect(warn).not.toHaveBeenCalled();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('2,2', '600,6000')));
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('3,3', '600,6000')));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('600,6000');

    // A second, different limit is a new change.
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('4,4', '900,9000')));
    expect(warn).toHaveBeenCalledTimes(2);

    // Back to the constants is silent, and leaving them again is a change worth a warning.
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('5,5', '300,3000')));
    expect(warn).toHaveBeenCalledTimes(2);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('6,6', '600,6000')));
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('rate budget treats a 429 like reaching the soft limit', () => {
    const budget = newBudget();
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('100,500')));

    budget.recordResponse(ACTIVITIES_URL, response({}, 429));
    expect(budget.isOverSoftLimit()).toBe(true);
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-14T10:15:30.000Z');

    // Gone when the window turns over.
    now = at(10, 15, 31);
    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('2,501')));
    expect(budget.isOverSoftLimit()).toBe(false);
  });

  it('rate budget waits for midnight after a 429 that reports the daily limit used up', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('40,3000'), 429));

    expect(budget.isOverSoftLimit()).toBe(true);
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-15T00:01:00.000Z');
  });

  it('rate budget treats a 429 without headers as over the limit before any header was seen', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response({}, 429));

    expect(budget.isOverSoftLimit()).toBe(true);
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-14T10:15:30.000Z');
  });

  it('rate budget does not count the token refresh as a read', () => {
    const budget = newBudget();

    budget.recordResponse(TOKEN_URL, response());
    budget.recordResponse(TOKEN_URL, response());

    expect(budget.usage()).toMatchObject({ last15Min: 0, daily: 0 });
  });

  it('rate budget ignores malformed headers without throwing and counts the call locally', () => {
    const budget = newBudget();

    for (const usage of ['', 'abc', '1', '1,2,3', '-4,5', '1.5,2', ',']) {
      expect(() => budget.recordResponse(ACTIVITIES_URL, response(readHeaders(usage, 'x,y')))).not.toThrow();
    }

    expect(budget.usage()).toMatchObject({ last15Min: 7, daily: 7, limit15Min: 300, limitDaily: 3000 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('rate budget reads the 15 minute limit first and the daily limit second', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('1,2', '600,6000')));
    expect(budget.usage()).toMatchObject({ limit15Min: 600, limitDaily: 6000 });

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('1,2', '400,4000')));
    expect(budget.usage()).toMatchObject({ limit15Min: 400, limitDaily: 4000 });
  });

  it('rate budget warns when only one of the two limits differs from the constants', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('1,1', '300,6000')));
    expect(warn).toHaveBeenCalledTimes(1);

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('2,2', '600,3000')));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('rate budget never throws when the response cannot be read, and logs it', () => {
    const budget = newBudget();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const unreadable = { status: 200, headers: { get: () => { throw new Error('headers broke'); } } } as unknown as Response;

    expect(() => budget.recordResponse(ACTIVITIES_URL, unreadable)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('rate budget counts a read for exactly 15 minutes in the sliding window', () => {
    const budget = newBudget();
    budget.recordResponse(ACTIVITIES_URL, response());

    now += 15 * MINUTE - 1000;
    expect(budget.usage().last15Min).toBe(1);
    now += 1000;
    expect(budget.usage().last15Min).toBe(0);
    now += 1000;
    expect(budget.usage().last15Min).toBe(0);
  });

  it('rate budget treats a 429 as over the soft limit even when the reported limit is below it', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('100,500', '100,1000'), 429));

    expect(budget.isOverSoftLimit()).toBe(true);
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-14T10:15:30.000Z');
  });

  it('rate budget treats a 429 on the daily limit as over the soft limit when the reported daily limit is below it', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response(readHeaders('5,1000', '100,1000'), 429));

    expect(budget.isOverSoftLimit()).toBe(true);
    expect(budget.nextResumeAt().toISOString()).toBe('2026-10-15T00:01:00.000Z');
  });

  it('rate budget in fallback mode resumes when the oldest reads have left the 15 minute window', () => {
    const budget = newBudget();
    now = at(10, 1);
    for (let i = 0; i < 100; i++) budget.recordResponse(ACTIVITIES_URL, response());
    now = at(10, 5);
    for (let i = 0; i < 115; i++) budget.recordResponse(ACTIVITIES_URL, response());
    now = at(10, 7);
    expect(budget.isOverSoftLimit()).toBe(true);

    // Six reads must leave to get below 210; they are the oldest ones, from 10:01, and leave at 10:16.
    const resumeAt = budget.nextResumeAt();
    expect(resumeAt.toISOString()).toBe('2026-10-14T10:16:30.000Z');

    now = at(10, 15, 59);
    expect(budget.isOverSoftLimit()).toBe(true);
    now = resumeAt.getTime();
    expect(budget.isOverSoftLimit()).toBe(false);
  });

  it('rate budget in fallback mode resumes when the oldest reads have left the day window', () => {
    const budget = newBudget();
    now = at(3, 0);
    for (let i = 0; i < 2101; i++) budget.recordResponse(ACTIVITIES_URL, response());
    now = at(10, 7);
    expect(budget.isOverSoftLimit()).toBe(true);

    // Two reads must leave to get below 2 100; both are from 03:00 and leave 24 hours later.
    const resumeAt = budget.nextResumeAt();
    expect(resumeAt.toISOString()).toBe('2026-10-15T03:01:00.000Z');

    now = resumeAt.getTime() - 61_000;
    expect(budget.isOverSoftLimit()).toBe(true);
    now = resumeAt.getTime();
    expect(budget.isOverSoftLimit()).toBe(false);
  });

  it('rate budget accepts a usage header whose limit header is missing', () => {
    const budget = newBudget();

    budget.recordResponse(ACTIVITIES_URL, response({ 'X-ReadRateLimit-Usage': '12,34' }));

    expect(budget.usage()).toMatchObject({ last15Min: 12, daily: 34, limit15Min: 300, limitDaily: 3000 });
  });
});

describe('Strava rate budget as a hook on the central fetch path', () => {
  let strava: FakeStrava | undefined;
  let unregister: (() => void) | undefined;
  afterEach(() => {
    unregister?.();
    unregister = undefined;
    strava?.restore();
    strava = undefined;
  });

  it('rate budget reads the headers of every response that passes stravaFetch', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [stravaActivity()], rateLimit: { read: { usage: [77, 888] } } });
    const budget = newBudget();
    unregister = registerStravaRateBudget(budget);

    await stravaFetch(ACTIVITIES_URL);

    expect(budget.usage()).toMatchObject({ last15Min: 77, daily: 888 });
  });

  it('rate budget reads the headers of an error response too', async () => {
    strava = installFakeStravaFetch({ athleteActivities: stravaError(429), rateLimit: { read: { usage: [300, 1200] } } });
    const budget = newBudget();
    unregister = registerStravaRateBudget(budget);

    await stravaFetch(ACTIVITIES_URL);

    expect(budget.usage()).toMatchObject({ last15Min: 300, daily: 1200 });
    expect(budget.isOverSoftLimit()).toBe(true);
  });

  it('rate budget does not count a token refresh that passes stravaFetch', async () => {
    strava = installFakeStravaFetch({ oauthToken: stravaTokenResponse() });
    const budget = newBudget();
    unregister = registerStravaRateBudget(budget);

    await stravaFetch(TOKEN_URL, { method: 'POST' });

    expect(budget.usage()).toMatchObject({ last15Min: 0, daily: 0 });
  });

  it('rate budget of the app follows the real clock, also when timers are faked after it was created', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(at(10, 7));
      stravaRateBudget.recordResponse(ACTIVITIES_URL, response(readHeaders('215,500')));
      expect(isOverSoftLimit()).toBe(true);
      expect(nextResumeAt().toISOString()).toBe('2026-10-14T10:15:30.000Z');

      vi.setSystemTime(at(10, 16));
      expect(isOverSoftLimit()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate budget stops reading responses when the hook is unregistered', async () => {
    strava = installFakeStravaFetch({ athleteActivities: [stravaActivity()] });
    const budget = newBudget();
    registerStravaRateBudget(budget)();

    await stravaFetch(ACTIVITIES_URL);

    expect(budget.usage()).toMatchObject({ last15Min: 0, daily: 0 });
  });
});
