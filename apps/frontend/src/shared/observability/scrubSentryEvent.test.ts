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
