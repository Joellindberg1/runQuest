import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { scrubSentryEvent, scrubString, secretsFromEnv, isExpectedClientStatus, CLIENT_STATUSES_NOT_REPORTED, MAX_SCRUBBED_STRING_LENGTH } from '../scrub.js';

// Fixtur: en händelse som bär allt vi lovar att inte skicka. Varje känsligt värde är en unik markör, så ett läckage går att peka ut.
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidTEifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const STRAVA_ACCESS = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const CLIENT_SECRET = 'cafebabecafebabecafebabecafebabecafebabe';
const ENV_SECRET = 'hunter2-service-role-key-value';
const MARKERS = [
  JWT, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', STRAVA_ACCESS, CLIENT_SECRET, ENV_SECRET,
  'cookie-marker', 'session=abc', 'pw-marker', 'hash-marker', 'jane.doe@example.com', 'body-marker',
  'refresh-marker', 'Jane Doe', '203.0.113.7', 'code-marker',
];

function fixture() {
  return {
    event_id: 'e1',
    message: `Login failed for jane.doe@example.com with token ${JWT}`,
    request: {
      method: 'POST',
      url: 'https://api.runquest.dev/api/strava/callback?code=code-marker&access_token=' + STRAVA_ACCESS,
      query_string: 'code=code-marker&scope=read',
      headers: {
        authorization: `Bearer ${JWT}`,
        Cookie: 'session=abc; cookie-marker',
        'x-forwarded-for': '203.0.113.7',
        'content-type': 'application/json',
        'user-agent': 'vitest',
      },
      cookies: { session: 'cookie-marker' },
      data: { password: 'pw-marker', body: 'body-marker' },
    },
    user: { id: 'user-123', email: 'jane.doe@example.com', username: 'Jane Doe', ip_address: '203.0.113.7' },
    exception: {
      values: [{
        type: 'Error',
        value: `Strava refresh failed: refresh_token=refresh-marker client_secret=${CLIENT_SECRET} key ${ENV_SECRET}`,
        stacktrace: { frames: [{ filename: 'app:///dist/server.js', function: 'refreshStravaToken', lineno: 10, vars: { token: STRAVA_ACCESS } }] },
      }],
    },
    extra: {
      password_hash: 'hash-marker',
      strava: { access_token: STRAVA_ACCESS, refresh_token: 'refresh-marker', expires_at: 1234 },
      nested: [{ client_secret: CLIENT_SECRET }, `plain text with ${STRAVA_ACCESS}`],
      jwtInText: `got ${JWT} back`,
    },
    contexts: { response: { status_code: 500 } },
    tags: { route: '/api/runs' },
    breadcrumbs: [
      { category: 'console', message: 'Login successful for user: Jane Doe' },
      { category: 'http', data: { url: 'https://www.strava.com/api/v3/activities/99?access_token=' + STRAVA_ACCESS } },
      { category: 'app.step', message: 'kept breadcrumb' },
    ],
  };
}

describe('beforeSend strips tokens and PII', () => {
  const scrub = (e: object) => scrubSentryEvent(e as never, [ENV_SECRET]) as ReturnType<typeof fixture> | null;

  it('leaves none of the sensitive markers anywhere in the serialised event', () => {
    const out = scrub(fixture());
    expect(out).not.toBeNull();
    const text = JSON.stringify(out);
    for (const marker of MARKERS) expect(text, `leaked: ${marker}`).not.toContain(marker);
  });

  it('removes the request body, cookies and the Authorization header but keeps harmless headers', () => {
    const out = scrub(fixture())!;
    expect(out.request.data).toBeUndefined();
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.query_string).toBeUndefined();
    expect(out.request.headers).toEqual({ 'content-type': 'application/json', 'user-agent': 'vitest' });
    // Ingen route i fixturen: bara värden, aldrig den råa sökvägen (den kan bära ett id som inget mönster känner igen).
    expect(out.request.url).toBe('https://api.runquest.dev');
  });

  it('keeps only user.id on the user', () => {
    expect(scrub(fixture())!.user).toEqual({ id: 'user-123' });
  });

  it('drops console and http breadcrumbs and keeps the others', () => {
    expect(scrub(fixture())!.breadcrumbs).toEqual([{ category: 'app.step', message: 'kept breadcrumb' }]);
  });

  it('keeps what makes the event useful (type, function, line, tags, status)', () => {
    const out = scrub(fixture())!;
    expect(out.exception.values[0].type).toBe('Error');
    expect(out.exception.values[0].stacktrace.frames[0]).toMatchObject({ function: 'refreshStravaToken', lineno: 10 });
    expect(out.exception.values[0].stacktrace.frames[0]).not.toHaveProperty('vars');
    expect(out.tags).toEqual({ route: '/api/runs' });
    expect(out.extra.strava.expires_at).toBe(1234);
  });

  it.each([
    ['object_id=987654321', '987654321'],
    ['owner_id=555111', '555111'],
    ['athlete_id: 424242', '424242'],
    ['Object_ID = 31337', '31337'],
    // a prefix joined with an underscore is part of the same word for \b, so these used to slip through
    ['strava_athlete_id=777001', '777001'],
    ['strava_owner_id: 777002', '777002'],
    ['webhook_object_id=777003', '777003'],
    ['user.strava_athlete_id = 777004', '777004'],
  ])('masks a Strava id written as %s anywhere in a string', (written, id) => {
    const out = scrub({ message: `dead event ${written} attempts=3`, extra: { note: `again ${written}` } })!;
    expect(JSON.stringify(out)).not.toContain(id);
    expect(JSON.stringify(out)).toContain('attempts=3');
  });

  it.each([
    ['strava_access_token=ACCESS-marker-1234', 'ACCESS-marker-1234'],
    ['db_password=hunter2-marker', 'hunter2-marker'],
    ['STRAVA_CLIENT_SECRET=client-marker-5678', 'client-marker-5678'],
  ])('masks a secret written with a prefix joined by an underscore: %s', (written, secret) => {
    const out = scrub({ message: `failed ${written} attempts=3` })!;
    expect(JSON.stringify(out)).not.toContain(secret);
  });

  it('survives circular structures', () => {
    const e: Record<string, unknown> = { extra: {} };
    (e.extra as Record<string, unknown>).self = e.extra;
    expect(() => scrub(e)).not.toThrow();
  });

  it('does not modify the event it was given', () => {
    const original = fixture();
    const before = JSON.stringify(original);
    scrub(original);
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe('expected client statuses', () => {
  it.each([401, 403, 404, 429])('%i is not reported', (status) => {
    expect(isExpectedClientStatus(status)).toBe(true);
    expect(CLIENT_STATUSES_NOT_REPORTED).toContain(status);
  });

  it.each([400, 409, 500, 502, 503])('%i is reported', (status) => {
    expect(isExpectedClientStatus(status)).toBe(false);
  });

  it.each([401, 403, 404, 429])('beforeSend drops an event whose response status is %i', (status) => {
    expect(scrubSentryEvent({ contexts: { response: { status_code: status } } } as never, [])).toBeNull();
    expect(scrubSentryEvent({ tags: { 'http.status_code': String(status) } } as never, [])).toBeNull();
  });

  it('beforeSend keeps an event with status 500', () => {
    expect(scrubSentryEvent({ contexts: { response: { status_code: 500 } } } as never, [])).not.toBeNull();
  });
});

describe('ids in the address of an error event', () => {
  const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  it('become :id in the transaction name and the request address, and the query is gone', () => {
    const scrubbed = scrubSentryEvent({
      transaction: `GET /api/titles/user/${USER}`,
      request: { method: 'GET', url: `https://api.runquest.dev/api/titles/user/${USER}?week=2026-10-12#top` },
    }, [])! as { transaction: string; request: { url: string } };

    expect(scrubbed.transaction).toBe('GET /api/titles/user/:id');
    expect(scrubbed.request.url).toBe('https://api.runquest.dev/api/titles/user/:id');
    expect(JSON.stringify(scrubbed)).not.toContain(USER);
  });

  it('also turn a numeric segment into :id, and take the path of the address from the route name, never from the raw path', () => {
    const scrubbed = scrubSentryEvent({ transaction: 'GET /api/strava/activities/987654321', request: { url: 'https://api.runquest.dev/api/users/anna-andersson' } }, [])! as { transaction: string; request: { url: string } };
    expect(scrubbed.transaction).toBe('GET /api/strava/activities/:id');
    expect(scrubbed.request.url).toBe('https://api.runquest.dev/api/strava/activities/:id');
    expect(JSON.stringify(scrubbed)).not.toContain('anna-andersson');
  });
});

describe('secretsFromEnv', () => {
  it('collects values of secret-looking variables, skipping short values and the DSN', () => {
    const secrets = secretsFromEnv({
      JWT_SECRET: 'long-enough-secret', STRAVA_CLIENT_SECRET: 'another-long-one', SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key-value',
      STRAVA_WEBHOOK_VERIFY_TOKEN: 'short', SENTRY_DSN: 'https://key@o1.ingest.de.sentry.io/1', PORT: '3001', NODE_ENV: 'production',
    });
    expect(secrets.sort()).toEqual(['another-long-one', 'long-enough-secret', 'svc-role-key-value']);
  });

  // The keys are generated here: nothing in these tests is a real key.
  const keyBase64 = () => randomBytes(32).toString('base64');

  it('also collects the base64 part of the active key and of every retired key, and the list entries themselves', () => {
    const active = keyBase64();
    const retiredA = keyBase64();
    const retiredB = keyBase64();
    const secrets = secretsFromEnv({
      TOKEN_ENCRYPTION_KEY: `prod-2:${active}`,
      TOKEN_ENCRYPTION_KEYS_RETIRED: `prod-1:${retiredA}, old-0:${retiredB}`,
    });

    for (const part of [active, retiredA, retiredB]) expect(secrets).toContain(part);
    expect(secrets).toContain(`prod-2:${active}`);
    expect(secrets).toContain(`prod-1:${retiredA}`);
    expect(secrets).toContain(`old-0:${retiredB}`);
  });

  it('skips a blank or malformed key variable without throwing', () => {
    expect(() => secretsFromEnv({ TOKEN_ENCRYPTION_KEY: '', TOKEN_ENCRYPTION_KEYS_RETIRED: ',, ,x' })).not.toThrow();
    expect(secretsFromEnv({ TOKEN_ENCRYPTION_KEY: '', TOKEN_ENCRYPTION_KEYS_RETIRED: '' })).toEqual([]);
  });
});

describe('encrypted values and key material in events', () => {
  const stored = `enc:v1:prod-1:${randomBytes(12).toString('base64url')}:${randomBytes(40).toString('base64url')}:${randomBytes(16).toString('base64url')}`;

  it('scrubSentryEvent masks an enc:v1 value wherever it stands, also cut short and inside other text', () => {
    const event = {
      message: `row ${stored} could not be read`,
      extra: { note: `the column held ${stored.slice(0, 40)}`, list: [`x ${stored}`] },
      exception: { values: [{ type: 'Error', value: `bad value (${stored}), retrying` }] },
    };

    const out = JSON.stringify(scrubSentryEvent(event, []));

    expect(out).not.toContain('enc:v1');
    expect(out).not.toContain(stored.split(':')[3]);
    expect(out).not.toContain(stored.split(':')[4]);
    expect(out).toContain('[Filtered]');
  });

  it('scrubSentryEvent masks the base64 of a configured key even when it appears without its key id', () => {
    const active = randomBytes(32).toString('base64');
    const retired = randomBytes(32).toString('base64');
    const secrets = secretsFromEnv({ TOKEN_ENCRYPTION_KEY: `prod-2:${active}`, TOKEN_ENCRYPTION_KEYS_RETIRED: `prod-1:${retired}` });
    const event = { message: `key ${active} and ${retired}`, extra: { entry: `prod-2:${active}`, list: [`old=${retired}`] } };

    const out = JSON.stringify(scrubSentryEvent(event, secrets));

    expect(out).not.toContain(active);
    expect(out).not.toContain(retired);
  });
});

describe('Strava activity numbers and coordinates in free text', () => {
  const messageOf = (text: string) => (scrubSentryEvent({ message: text } as never, []) as { message: string }).message;

  it.each([
    ['activity 12345678901 not found', '12345678901', 'not found'],
    ['Activity #12345678901 could not be fetched', '12345678901', 'could not be fetched'],
    ['no run for activity_id=12345678901 (attempt 2)', '12345678901', 'attempt 2'],
    ['athlete 424242424 is not connected', '424242424', 'is not connected'],
    ['Strava answered 404 for activity 12345678901: Record Not Found', '12345678901', 'Record Not Found'],
  ])('masks the number in "%s" and keeps the rest of the sentence', (text, number, rest) => {
    const out = messageOf(text);
    expect(out).not.toContain(number);
    expect(out).toContain(rest);
  });

  it('masks every number of a list of activities', () => {
    const out = messageOf('activities 12345678901 and 12345678902 skipped');
    expect(out).not.toMatch(/\d{8,}/);
    expect(out).toContain('skipped');
  });

  it.each([
    ['GET /activities/12345678901', 'GET /activities/:id'],
    ['GET https://www.strava.com/api/v3/activities/12345678901?include_all_efforts=false 404', 'GET https://www.strava.com/api/v3/activities/:id?include_all_efforts=false 404'],
    ['GET /api/v3/activities/12345678901/streams failed', 'GET /api/v3/activities/:id/streams failed'],
    ['GET /api/v3/athletes/424242424/stats failed', 'GET /api/v3/athletes/:id/stats failed'],
  ])('turns the id in the path of "%s" into :id', (text, expected) => {
    expect(messageOf(text)).toBe(expected);
  });

  it.each([
    ['lat 57.70887, lng 11.97456', '57.70887', '11.97456'],
    ['lat=57.70887 lon=11.97456', '57.70887', '11.97456'],
    ['latitude: -33.86882, longitude: 151.20929', '33.86882', '151.20929'],
    ['{"lat":57.70887,"lng":11.97456}', '57.70887', '11.97456'],
    ['start_latlng=[57.70887, 11.97456]', '57.70887', '11.97456'],
    ['weather lookup failed at 57.70887, 11.97456 (status 503)', '57.70887', '11.97456'],
    ['weather lookup failed at [57.70887,11.97456]', '57.70887', '11.97456'],
  ])('masks the coordinates in "%s"', (text, first, second) => {
    const out = messageOf(text);
    expect(out).not.toContain(first);
    expect(out).not.toContain(second);
  });

  it('keeps what debugging needs: status codes, error codes, route patterns and counts', () => {
    const text = 'GET /api/v3/activities/:id 503 (strava_503, PGRST116, ECONNRESET) after 3 attempts, 12.5 s, 4 activities, v1.2.3';
    expect(messageOf(text)).toBe(text);
  });

  it('keeps ordinary decimals and the word "activity" when no number follows', () => {
    const text = 'no activity found; took 1.2345 s, 2.3456 s; lag 120 ms; response 404';
    expect(messageOf(text)).toBe(text);
  });

  it('masks the same things in exception values, extra and nested lists', () => {
    const event = {
      exception: { values: [{ type: 'Error', value: 'activity 12345678901 not found' }] },
      extra: { note: 'GET /activities/12345678901', where: ['lat 57.70887, lng 11.97456'] },
    };
    const out = JSON.stringify(scrubSentryEvent(event, []));
    expect(out).not.toMatch(/12345678901|57\.70887|11\.97456/);
  });

  it.each(['object_id', 'owner_id', 'athlete_id', 'strava_activity_id', 'strava_athlete_id'])('masks a numeric %s field and keeps its neighbours', (key) => {
    const out = scrubSentryEvent({ extra: { [key]: 12345678901, attempts: 3 } } as never, []) as { extra: Record<string, unknown> };
    expect(out.extra[key]).toBe('[Filtered]');
    expect(out.extra.attempts).toBe(3);
  });

  it('keeps our own ids that share a name with Strava ones: a group owner_id (UUID) and a news activity_id (small running number)', () => {
    const event = { extra: { owner_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', activity_id: 4711 }, message: 'news row activity_id=4711 and activity 4711 missing' };
    const out = scrubSentryEvent(event as never, []) as typeof event;
    expect(out.extra).toEqual(event.extra);
    expect(out.message).toBe(event.message);
  });

  it.each(['lat', 'lng', 'latlng', 'start_latlng', 'end_latlng', 'latitude', 'longitude'])('masks a %s field', (key) => {
    const value = key.includes('latlng') ? [57.70887, 11.97456] : 57.70887;
    const out = scrubSentryEvent({ extra: { [key]: value, status: 503 } } as never, []) as { extra: Record<string, unknown> };
    expect(out.extra[key]).toBe('[Filtered]');
    expect(out.extra.status).toBe(503);
  });
});

describe('Strava numbers in JSON text, camelCase, quotes and database errors', () => {
  const messageOf = (text: string) => (scrubSentryEvent({ message: text } as never, []) as { message: string }).message;

  it.each(['object_id', 'owner_id', 'athlete_id', 'activity_id', 'strava_activity_id', 'strava_athlete_id'])('masks "%s" quoted in a JSON string and keeps its neighbours', (key) => {
    const out = messageOf(`webhook body {"${key}":12345678901,"attempts":3,"aspect_type":"create"}`);
    expect(out).not.toContain('12345678901');
    expect(out).toContain('"attempts":3');
    expect(out).toContain('"aspect_type":"create"');
  });

  it('masks several ids in one JSON string', () => {
    expect(messageOf('{"object_id":12345678901,"owner_id":424242424}')).not.toMatch(/\d{6,}/);
  });

  it.each([
    'activityId=12345678901', 'athleteId=424242424', 'stravaActivityId: 12345678901', 'stravaAthleteId=424242424', 'objectId=12345678901', 'ownerId = 424242424',
    '"activityId":12345678901', 'startLatLng=[57.70887, 11.97456]', 'endLatLng: [57.70887,11.97456]',
  ])('masks the camelCase form "%s"', (text) => {
    expect(messageOf(`failed ${text} attempts=3`)).not.toMatch(/12345678901|424242424|57\.70887|11\.97456/);
    expect(messageOf(`failed ${text} attempts=3`)).toContain('attempts=3');
  });

  it.each([
    ['activity "12345678901" not found', 'not found'],
    ['activity (12345678901) not found', 'not found'],
    ["activity '12345678901' not found", 'not found'],
    ['activities [12345678901, 12345678902] skipped', 'skipped'],
    ['activities ("12345678901", "12345678902") skipped', 'skipped'],
    ['activity id 12345678901 not found', 'not found'],
  ])('masks the number in the quoted or bracketed form "%s"', (text, rest) => {
    const out = messageOf(text);
    expect(out).not.toMatch(/\d{7,}/);
    expect(out).toContain(rest);
  });

  it.each([
    ['duplicate key value violates unique constraint "runs_strava_activity_id_key"\nKey (strava_activity_id)=(12345678901) already exists.', 'already exists'],
    ['duplicate key value\nKey (user_id, strava_activity_id)=(7c9e6679-7425-40de-944b-e07fc1f90ae7, 12345678901) already exists.', 'already exists'],
    ['Key (strava_athlete_id)=(424242424) already exists.', 'already exists'],
  ])('masks the values of a Postgres key detail naming a Strava column: %s', (text, rest) => {
    const out = messageOf(text);
    expect(out).not.toMatch(/12345678901|424242424/);
    expect(out).toContain(rest);
    expect(out).toContain('Key (');
  });

  it('keeps the values of a Postgres key detail that does not name a Strava column', () => {
    const text = 'Key (invite_code)=(WOLF42) already exists.';
    expect(messageOf(text)).toBe(text);
  });

  it.each([
    ['strava_activity_id.eq.12345678901', 'strava_activity_id.eq.'],
    ['strava_activity_id=eq.12345678901', 'strava_activity_id=eq.'],
    ['strava_athlete_id.in.(424242424,424242425)', 'strava_athlete_id.in.'],
  ])('masks the PostgREST filter %s and keeps the column and operator', (text, kept) => {
    const out = messageOf(`GET /rest/v1/runs?select=id&${text}&order=id`);
    expect(out).not.toMatch(/\d{7,}/);
    expect(out).toContain(kept);
    expect(out).toContain('select=id');
    expect(out).toContain('order=id');
  });

  it('masks long numbers in activity and athlete fields, but keeps a short activity number', () => {
    const out = scrubSentryEvent({ extra: { activity: '12345678901', athleteId: 424242424, activityId: 4711 } } as never, []) as { extra: Record<string, unknown> };
    expect(out.extra).toEqual({ activity: '[Filtered]', athleteId: '[Filtered]', activityId: 4711 });
  });
});

describe('the scrubber is bounded in time and size', () => {
  const HARD_LIMIT_MS = 2000; // the unbounded patterns took 8 to 12 s on these inputs, the bounded ones a few ms

  // 100 kB each. Machine speed does not matter: the margin to the hard limit is more than 20 times.
  const HOSTILE: Array<[string, string]> = [
    ['spaces after lat', 'lat' + ' '.repeat(100_000) + 'x'],
    ['spaces after activity', 'activity' + ' '.repeat(100_000) + 'x'],
    ['spaces after a quoted key', '"object_id"' + ' '.repeat(100_000) + 'x'],
    ['spaces after token', 'token"' + ' '.repeat(100_000) + 'x'],
    ['repeated latlng=[', 'latlng=['.repeat(12_500)],
    ['repeated activities list', 'activities 1234567,'.repeat(5_000)],
    ['repeated Key (', 'Key ('.repeat(20_000)],
    ['digits', '1'.repeat(100_000)],
    ['repeated "1."', '1.'.repeat(50_000)],
    ['letters', 'a'.repeat(100_000)],
    ['repeated eyJ-', 'eyJ-'.repeat(25_000)],
    ['repeated Bearer', 'Bearer '.repeat(14_000)],
    ['repeated a@', 'a@'.repeat(50_000)],
    ['dotted local part without @', 'a.'.repeat(50_000)],
    ['email with a long dotted domain', 'x@' + 'a.'.repeat(50_000)],
    ['repeated enc:v1', 'enc:v1:'.repeat(14_000)],
    ['repeated object_id=', 'object_id='.repeat(10_000)],
  ];

  it.each(HOSTILE)('finishes 100 kB of "%s" inside the hard limit even with the size cap off', (_name, input) => {
    const started = performance.now();
    scrubString(input, [], Infinity);
    expect(performance.now() - started).toBeLessThan(HARD_LIMIT_MS);
  });

  it.each(HOSTILE)('finishes 100 kB of "%s" inside the hard limit through the whole event', (_name, input) => {
    const started = performance.now();
    scrubSentryEvent({ message: input, extra: { note: input } } as never, []);
    expect(performance.now() - started).toBeLessThan(HARD_LIMIT_MS);
  });

  it('cuts a long string to the maximum length plus a marker before any pattern runs, in every string of the event', () => {
    const long = 'x'.repeat(MAX_SCRUBBED_STRING_LENGTH * 3);
    const out = scrubSentryEvent({ message: long, exception: { values: [{ type: 'Error', value: long }] }, extra: { list: [long] } } as never, []) as any;

    for (const text of [out.message, out.exception.values[0].value, out.extra.list[0]]) {
      expect(text.startsWith('x'.repeat(MAX_SCRUBBED_STRING_LENGTH))).toBe(true);
      expect(text).toBe('x'.repeat(MAX_SCRUBBED_STRING_LENGTH) + '…[truncated]');
    }
  });

  it('leaves a string at exactly the maximum length untouched, and masks secrets in the part that is kept', () => {
    const exact = 'y'.repeat(MAX_SCRUBBED_STRING_LENGTH);
    expect(scrubString(exact, [])).toBe(exact);
    expect(scrubString(`attempt 2 key=hunter2-long-secret ${'z'.repeat(MAX_SCRUBBED_STRING_LENGTH * 2)}`, ['hunter2-long-secret'])).toContain('key=[Filtered]');
  });

  it('does not let a secret that lies beyond the cut survive in a shortened string', () => {
    const out = scrubString(`${'a'.repeat(MAX_SCRUBBED_STRING_LENGTH - 5)}hunter2-long-secret-tail`, ['hunter2-long-secret-tail']);
    expect(out).not.toContain('hunter2');
  });
});
