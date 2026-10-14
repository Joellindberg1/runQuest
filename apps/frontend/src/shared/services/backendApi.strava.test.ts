import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAVA_CONSENT_VERSION } from '@runquest/shared';
import { backendApi } from './backendApi';

// POST /strava/callback: koden och den godkända samtyckesversionen går i kroppen; saknas versionen skickas ingen nyckel alls.

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('runquest_token', 'tok-123');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('connectStrava', () => {
  it('connectStrava sends the current consent version', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, message: 'ok' }));

    await backendApi.connectStrava('abc', STRAVA_CONSENT_VERSION);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/strava/callback')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ code: 'abc', consent_version: STRAVA_CONSENT_VERSION });
  });

  it('connectStrava sends no consent_version when none is given', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'Consent required' }));

    await backendApi.connectStrava('abc');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'abc' });
  });

  it('surfaces the servers Consent required answer as the error text', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'Consent required' }));

    const result = await backendApi.connectStrava('abc');

    expect(result).toMatchObject({ success: false, error: 'Consent required' });
  });
});
