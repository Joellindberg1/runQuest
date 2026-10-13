import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// POST /waitlist: publik (ingen Authorization-header), kroppen går som den är, HTTP-statusen exponeras och ett nätverksfel blir null.

const BODY = { email: 'anna@example.com', consent: true as const, website: '', elapsedMs: 4200 };

const reply = (status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) }) as Response;

const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error', 'trace'] as const;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const method of CONSOLE_METHODS) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('joinWaitlist', () => {
  it('POSTs the body as JSON to /waitlist without an Authorization header, even when a login token exists', async () => {
    localStorage.setItem('runquest_token', 'tok-123');
    fetchMock.mockResolvedValue(reply(200));

    await backendApi.joinWaitlist(BODY);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/waitlist')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(BODY);
  });

  it.each([200, 400, 413, 429, 500])('exposes HTTP status %i', async (status) => {
    fetchMock.mockResolvedValue(reply(status));
    expect(await backendApi.joinWaitlist(BODY)).toEqual({ status });
  });

  it('returns null on a network error and never logs the email address', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await backendApi.joinWaitlist(BODY)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
    const logged = JSON.stringify(CONSOLE_METHODS.flatMap((method) => vi.mocked(console[method]).mock.calls));
    expect(logged).not.toContain('anna@example.com');
  });
});
