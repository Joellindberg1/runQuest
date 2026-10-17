import { describe, expect, it } from 'vitest';
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
