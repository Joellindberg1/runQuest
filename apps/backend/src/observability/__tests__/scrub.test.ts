import { describe, it, expect } from 'vitest';
import { scrubSentryEvent, secretsFromEnv, isExpectedClientStatus, CLIENT_STATUSES_NOT_REPORTED } from '../scrub.js';

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
  ])('masks a Strava id written as %s anywhere in a string', (written, id) => {
    const out = scrub({ message: `dead event ${written} attempts=3`, extra: { note: `again ${written}` } })!;
    expect(JSON.stringify(out)).not.toContain(id);
    expect(JSON.stringify(out)).toContain('attempts=3');
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
});
