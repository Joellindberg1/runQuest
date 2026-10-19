import { describe, expect, it, vi } from 'vitest';
import { collectStorageValues, scrubSentryEvent, type SentryEventLike } from './scrubSentryEvent';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';

function memoryStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return {
    get length() { return keys.length; },
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => entries[key] ?? null,
  };
}

const storage = memoryStorage({
  runquest_token: TOKEN,
  runquest_user: JSON.stringify({ id: 'u1', name: 'Anna Andersson', email: 'anna@example.com', role: 'user' }),
});

function fatEvent(): SentryEventLike {
  return {
    message: `Request failed for Anna Andersson (anna@example.com) token ${TOKEN}`,
    user: { id: 'u1', email: 'anna@example.com', username: 'anna', ip_address: '1.2.3.4' },
    request: {
      url: 'https://runquest.dev/board?email=anna@example.com&next=/profile#frag',
      query_string: 'email=anna@example.com',
      cookies: { session: 'abc' },
      headers: { Authorization: `Bearer ${TOKEN}`, authorization: `Bearer ${TOKEN}`, Cookie: 'a=b', 'User-Agent': 'jsdom' },
      data: { name: 'Anna Andersson' },
    },
    exception: { values: [{ type: 'Error', value: 'GET https://api.runquest.dev/api/users?search=anna&token=secret failed' }] },
    extra: { name: 'Anna Andersson', email: 'anna@example.com', note: 'kept', nested: { display_name: 'Anna', value: 3 } },
    breadcrumbs: [
      { category: 'console', message: 'logged in as Anna Andersson' },
      { category: 'ui.click', message: 'button.user-anna' },
      { category: 'fetch', data: { url: 'https://api.runquest.dev/api/me?token=secret', method: 'GET' } },
      { category: 'navigation', data: { from: '/board?x=1', to: '/profile?y=2' } },
    ],
    contexts: { browser: { name: 'Chrome', version: '130' } },
    sdk: { name: 'sentry.javascript.react' },
    tags: { environment: 'staging' },
  };
}

describe('frontend sentry beforeSend', () => {
  it('frontend sentry beforeSend strips PII', () => {
    const scrubbed = scrubSentryEvent(fatEvent(), collectStorageValues(storage));
    if (!scrubbed) throw new Error('event was dropped');
    const json = JSON.stringify(scrubbed);

    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain('Anna');
    expect(json).not.toContain('anna@example.com');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('1.2.3.4');
    expect(json).not.toContain('?');
    expect(json).not.toContain('#frag');

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request?.url).toBe('https://runquest.dev/board');
    expect(scrubbed.request?.query_string).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.data).toBeUndefined();
    const headerNames = Object.keys(scrubbed.request?.headers ?? {}).map((key) => key.toLowerCase());
    expect(headerNames).not.toContain('authorization');
    expect(headerNames).not.toContain('cookie');
  });

  it('keeps what makes the report useful', () => {
    const scrubbed = scrubSentryEvent(fatEvent(), collectStorageValues(storage));
    if (!scrubbed) throw new Error('event was dropped');

    expect(scrubbed.exception?.values?.[0]).toMatchObject({ type: 'Error' });
    expect(scrubbed.exception?.values?.[0]?.value).toContain('https://api.runquest.dev/api/users');
    expect(scrubbed.extra?.note).toBe('kept');
    expect(scrubbed.extra?.nested).toMatchObject({ value: 3 });
    expect(scrubbed.tags).toEqual({ environment: 'staging' });
    expect(scrubbed.contexts).toEqual({ browser: { name: 'Chrome', version: '130' } });
    expect(scrubbed.sdk).toEqual({ name: 'sentry.javascript.react' });
    expect(scrubbed.request?.headers?.['User-Agent']).toBe('jsdom');
  });

  it('drops breadcrumbs that can carry typed text and strips queries from the rest', () => {
    const scrubbed = scrubSentryEvent(fatEvent(), collectStorageValues(storage));
    if (!scrubbed) throw new Error('event was dropped');

    expect((scrubbed.breadcrumbs ?? []).map((crumb) => crumb.category)).toEqual(['fetch', 'navigation']);
    expect(scrubbed.breadcrumbs?.[0]?.data?.url).toBe('https://api.runquest.dev/api/me');
    expect(scrubbed.breadcrumbs?.[1]?.data).toEqual({ from: '/board', to: '/profile' });
  });

  it('drops reload-after-deploy errors altogether', () => {
    const stale: SentryEventLike = {
      exception: { values: [{ type: 'TypeError', value: 'Failed to fetch dynamically imported module: https://runquest.dev/assets/A.js' }] },
    };
    expect(scrubSentryEvent(stale, [])).toBeNull();
  });

  it('scrubs objects without a prototype too', () => {
    const bare = Object.assign(Object.create(null), { email: 'anna@example.com', note: 'kept', text: 'by anna@example.com' });
    const event: SentryEventLike = { extra: { bare } };

    const scrubbed = scrubSentryEvent(event, []);

    expect(scrubbed?.extra?.bare).toEqual({ note: 'kept', text: 'by [Filtered]' });
  });

  it('drops requests that got no response, so a backend outage is not a flood of events', () => {
    const outage: SentryEventLike = { exception: { values: [{ type: 'TypeError', value: 'Failed to fetch (api.runquest.dev)' }] } };

    expect(scrubSentryEvent(outage, [])).toBeNull();
  });

  it('strips the hash from relative paths too', () => {
    const event: SentryEventLike = {
      message: 'moved from /board#top to /profile#runs and ended at https://runquest.dev/log#x',
      breadcrumbs: [{ category: 'navigation', data: { from: '/board#top', to: '/profile' } }],
    };

    const scrubbed = scrubSentryEvent(event, []);

    expect(scrubbed?.message).toBe('moved from /board to /profile and ended at https://runquest.dev/log');
    expect(scrubbed?.breadcrumbs?.[0]?.data).toEqual({ from: '/board', to: '/profile' });
  });

  it('drops events once a stale chunk reload has been ordered', async () => {
    vi.resetModules();
    const { installStaleChunkReload } = await import('@/shared/utils/staleChunkReload');
    const { scrubSentryEvent: freshScrub } = await import('./scrubSentryEvent');
    let listener: ((event: Event) => void) | undefined;
    const stored = new Map<string, string>();
    installStaleChunkReload(
      { addEventListener: (_type, fn) => { listener = fn; }, location: { reload: () => {} } },
      () => ({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } }),
    );
    const followUp: SentryEventLike = { exception: { values: [{ type: 'TypeError', value: "Cannot read properties of undefined (reading 'default')" }] } };
    expect(freshScrub(followUp, [])).not.toBeNull();

    const event = new Event('vite:preloadError', { cancelable: true });
    Object.assign(event, { payload: new Error('Failed to fetch dynamically imported module: https://runquest.dev/assets/SettingsPage-abc.js') });
    listener?.(event);

    expect(freshScrub(followUp, [])).toBeNull();
  });

  it('turns UUIDs and numeric ids in URLs and messages into :id and keeps the rest of the path', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const event: SentryEventLike = {
      message: `GET /api/users/7/runs failed on 2026/10/17 for ${uuid}`,
      breadcrumbs: [
        { category: 'fetch', data: { url: `https://api.runquest.dev/api/badges/user/${uuid}`, method: 'GET' } },
        { category: 'xhr', data: { url: '/api/runs/42/likes?cursor=9' } },
        { category: 'fetch', data: { url: 'https://api.runquest.dev/api/config/xp' } },
      ],
    };

    const scrubbed = scrubSentryEvent(event, []);

    expect(scrubbed?.message).toBe('GET /api/users/:id/runs failed on 2026/10/17 for :id');
    expect(scrubbed?.breadcrumbs?.map((crumb) => crumb.data?.url)).toEqual([
      'https://api.runquest.dev/api/badges/user/:id',
      '/api/runs/:id/likes',
      'https://api.runquest.dev/api/config/xp',
    ]);
  });

  it('does not mutate the incoming event', () => {
    const event = fatEvent();
    const before = JSON.stringify(event);
    scrubSentryEvent(event, collectStorageValues(storage));
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe('frontend sentry beforeSend and source map metadata', () => {
  const DEBUG_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const SCRIPT = 'https://www.runquest.dev/assets/optional-abc.js';

  function sdkShapedEvent() {
    return {
      event_id: '0123456789abcdef0123456789abcdef',
      release: 'runquest@0.8.0+abcdef1',
      dist: '1',
      environment: 'staging',
      platform: 'javascript',
      level: 'error',
      timestamp: 1_790_000_000.5,
      debug_meta: { images: [{ type: 'sourcemap', debug_id: DEBUG_ID, code_file: SCRIPT }] },
      exception: {
        values: [
          {
            type: 'Error',
            value: `lookup failed for anna@example.com and ${DEBUG_ID}`,
            stacktrace: { frames: [{ filename: `${SCRIPT}?v=anna@example.com`, function: 'load', lineno: 1, colno: 2048 }] },
          },
        ],
      },
    };
  }

  it('keeps release and debug ids intact while the message and the frames are still scrubbed', () => {
    const scrubbed = scrubSentryEvent(sdkShapedEvent(), []);

    expect(scrubbed).toMatchObject({
      event_id: '0123456789abcdef0123456789abcdef',
      release: 'runquest@0.8.0+abcdef1',
      dist: '1',
      environment: 'staging',
      platform: 'javascript',
      level: 'error',
      timestamp: 1_790_000_000.5,
      debug_meta: { images: [{ type: 'sourcemap', debug_id: DEBUG_ID, code_file: SCRIPT }] },
    });
    const [entry] = scrubbed?.exception?.values ?? [];
    expect(entry?.value).toBe('lookup failed for [Filtered] and :id');
    expect(JSON.stringify(entry?.stacktrace)).not.toContain('anna');
    expect(entry?.stacktrace).toMatchObject({ frames: [{ filename: SCRIPT, function: 'load', lineno: 1, colno: 2048 }] });
  });

  it('lets debug_meta carry nothing but well-formed images', () => {
    const event = {
      ...sdkShapedEvent(),
      debug_meta: {
        note: 'anna@example.com',
        images: [
          { type: 'sourcemap', debug_id: DEBUG_ID, code_file: `${SCRIPT}?user=anna@example.com`, extra: 'anna@example.com' },
          { type: 'sourcemap', debug_id: 'anna@example.com', code_file: SCRIPT },
          'anna@example.com',
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event, []);

    expect(scrubbed).toMatchObject({ debug_meta: { images: [{ type: 'sourcemap', debug_id: DEBUG_ID, code_file: SCRIPT }] } });
    expect(JSON.stringify(scrubbed?.debug_meta)).not.toContain('anna');
  });

  it('drops SDK metadata that is not a plain value, so an object cannot carry text past the scrub', () => {
    const scrubbed = scrubSentryEvent(
      { ...sdkShapedEvent(), release: { a: 'x@y.se' } as never, environment: ['a@b.se'] as never, platform: null as never },
      [],
    );

    expect(scrubbed).not.toHaveProperty('release');
    expect(scrubbed).not.toHaveProperty('environment');
    expect(scrubbed).not.toHaveProperty('platform');
    expect(JSON.stringify(scrubbed)).not.toContain('@y.se');
    expect(JSON.stringify(scrubbed)).not.toContain('@b.se');
  });

  it.each([
    ['release', 'user@mail.com'],
    ['release', 'runquest@0.8.0+abcdef1 anna'],
    ['release', 'runquest@0.8.0+abcdef1\n'],
    ['dist', 'user@mail.com'],
    ['dist', 'two words'],
    ['environment', 'a@b.se'],
    ['environment', 'Anna Andersson'],
    ['environment', 'Staging2'],
    ['environment', '2staging'],
    ['environment', 'pr 123'],
    ['environment', 'a'.repeat(33)],
    ['platform', 'a@b.se'],
    ['level', 'a@b.se'],
    ['level', 'critical'],
    ['event_id', 'a@b.se'],
    ['event_id', '0123456789abcdef0123456789abcde'],
    ['timestamp', '2026-10-17'],
  ])('drops %s when the value is %j', (key, value) => {
    const scrubbed = scrubSentryEvent({ ...sdkShapedEvent(), [key]: value }, []);

    expect(scrubbed).not.toHaveProperty(key);
  });

  it.each([
    ['release', 'runquest@0.8.0'],
    ['release', 'runquest@0.8.0.1+abcdef1'],
    ['dist', '1'],
    ['environment', 'production'],
    ['environment', 'staging-eu'],
    ['environment', 'staging2'],
    ['environment', 'pr-123'],
    ['platform', 'node'],
    ['level', 'fatal'],
    ['level', 'warning'],
    ['level', 'log'],
    ['level', 'info'],
    ['level', 'debug'],
    ['timestamp', 0],
  ])('keeps %s when the value is %j', (key, value) => {
    const scrubbed = scrubSentryEvent({ ...sdkShapedEvent(), [key]: value }, []);

    expect(scrubbed).toHaveProperty(key, value);
  });

  it('drops a timestamp that is not a finite number', () => {
    expect(scrubSentryEvent({ ...sdkShapedEvent(), timestamp: Number.NaN }, [])).not.toHaveProperty('timestamp');
  });

  it('keeps at most 200 debug images', () => {
    const images = Array.from({ length: 250 }, (_, index) => ({
      type: 'sourcemap',
      debug_id: `3f2504e0-4f89-11d3-9a0c-${String(index).padStart(12, '0')}`,
      code_file: SCRIPT,
    }));

    const scrubbed = scrubSentryEvent({ ...sdkShapedEvent(), debug_meta: { images } }, []);

    const kept = (scrubbed?.debug_meta as { images: Array<{ debug_id: string }> }).images;
    expect(kept).toHaveLength(200);
    expect(kept[0]?.debug_id).toBe(images[0]?.debug_id);
  });

  it('drops a debug_meta that is not the shape the SDK creates', () => {
    expect(scrubSentryEvent({ ...sdkShapedEvent(), debug_meta: 'anna@example.com' }, [])).not.toHaveProperty('debug_meta');
    expect(scrubSentryEvent({ ...sdkShapedEvent(), debug_meta: { images: 'anna@example.com' } }, [])).not.toHaveProperty('debug_meta');
  });
});

describe('the trace context that goes into the envelope header', () => {
  const dsc = (overrides: Record<string, unknown> = {}) => ({
    release: 'runquest@0.8.0+abcdef1',
    environment: 'staging',
    public_key: 'abc123publickey',
    trace_id: '0123456789abcdef0123456789abcdef',
    sample_rate: '0.1',
    sampled: 'true',
    transaction: '/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14',
    user_segment: 'vip-anna',
    replay_id: 'abcdef0123456789abcdef0123456789',
    ...overrides,
  });
  const scrubbedDsc = (overrides?: Record<string, unknown>) =>
    (scrubSentryEvent({ message: 'x', sdkProcessingMetadata: { dynamicSamplingContext: dsc(overrides), normalizedRequest: { url: 'https://runquest.dev/board?token=abc' } } } as never, [])! as { sdkProcessingMetadata?: { dynamicSamplingContext?: Record<string, unknown> } })
      .sdkProcessingMetadata?.dynamicSamplingContext;

  it('keeps the release in its known form, the key, the ids and the sampling, with the page as a route', () => {
    expect(scrubbedDsc()).toEqual({
      release: 'runquest@0.8.0+abcdef1',
      environment: 'staging',
      public_key: 'abc123publickey',
      trace_id: '0123456789abcdef0123456789abcdef',
      sample_rate: '0.1',
      sampled: 'true',
      transaction: '/runner/:id',
    });
  });

  it('drops a release, an environment or a key that is not in a known form, instead of masking it', () => {
    const scrubbed = scrubbedDsc({ release: 'someone@example.com', environment: 'Anna Andersson', public_key: 'a b@c.se', trace_id: 'nope' });
    expect(scrubbed).not.toHaveProperty('release');
    expect(scrubbed).not.toHaveProperty('environment');
    expect(scrubbed).not.toHaveProperty('public_key');
    expect(scrubbed).not.toHaveProperty('trace_id');
  });

  it.each(['0.07102618656499637', '0.08335781411790813', '5e-7', '1e-10', '0', '1', '0.5'])('keeps the sampling number %s that Math.random can give', (sampleRand) => {
    expect(scrubbedDsc({ sample_rand: sampleRand })).toHaveProperty('sample_rand', sampleRand);
  });

  it.each(['1.5', '-0.1', 'abc', '0.1x', '', '2e-0', '0.5 anna@example.com', '1e5'])('drops the sampling number %j', (sampleRand) => {
    expect(scrubbedDsc({ sample_rand: sampleRand })).not.toHaveProperty('sample_rand');
  });

  it('sends nothing else from the processing metadata', () => {
    const scrubbed = scrubSentryEvent({ message: 'x', sdkProcessingMetadata: { dynamicSamplingContext: dsc(), normalizedRequest: { url: 'https://runquest.dev/board?token=abc' }, ipAddress: '1.2.3.4' } } as never, []);
    expect(Object.keys((scrubbed! as { sdkProcessingMetadata: object }).sdkProcessingMetadata)).toEqual(['dynamicSamplingContext']);
  });
});

describe('collectStorageValues', () => {
  it('returns raw values and PII-keyed leaves of stored JSON, longest first, ignoring short ones', () => {
    const values = collectStorageValues(storage);

    expect(values).toContain(TOKEN);
    expect(values).toContain('Anna Andersson');
    expect(values).toContain('anna@example.com');
    expect(values).not.toContain('user');
    expect(values).not.toContain('u1');
    expect([...values].sort((a, b) => b.length - a.length)).toEqual(values);
  });

  it('survives a storage that throws', () => {
    const broken = { length: 1, key: () => { throw new Error('denied'); }, getItem: () => null };
    expect(collectStorageValues(broken)).toEqual([]);
  });
});
