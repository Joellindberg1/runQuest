import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// GET /challenges/head-to-head/:userId (ADR 007 B6): rätt URL + Bearer, `{ success, data }` packas upp.

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('runquest_token', 'tok-123');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('getHeadToHead', () => {
  it('GET mot /challenges/head-to-head/:id med Bearer och packar upp data', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { record: { wins: 2 } } }));

    const result = await backendApi.getHeadToHead('u-karl');

    expect(result).toEqual({ success: true, data: { record: { wins: 2 } } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/challenges/head-to-head/u-karl')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('skickar limit när den anges, och uuid:t URL-kodas', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: {} }));
    await backendApi.getHeadToHead('a/b?c', 5);
    expect(String(fetchMock.mock.calls[0][0]).endsWith('/challenges/head-to-head/a%2Fb%3Fc?limit=5')).toBe(true);
  });

  it('404 (annan grupp) och 400 → { success: false, error } med serverns meddelande', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'User not found' }));
    expect(await backendApi.getHeadToHead('u-x')).toEqual({ success: false, error: 'User not found' });
  });

  it('nätverksfel → { success: false }; utan token anropas inte nätverket', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await backendApi.getHeadToHead('u-karl')).toEqual({ success: false, error: 'offline' });

    fetchMock.mockClear();
    localStorage.clear();
    expect(await backendApi.getHeadToHead('u-karl')).toEqual({ success: false, error: 'Not authenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
