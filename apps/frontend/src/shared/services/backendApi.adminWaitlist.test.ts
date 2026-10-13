import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// GET /admin/waitlist: rätt URL + Bearer, `{ success, data }` packas upp, fel blir { success: false }.

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const DATA = { entries: [{ id: 'w1', email: 'anna@example.com', created_at: '2026-10-13T08:00:00Z', source: 'landing' }], total: 1 };

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

describe('getAdminWaitlist', () => {
  it('GET mot rätt endpoint med Bearer-token och packar upp data', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: DATA }));

    const result = await backendApi.getAdminWaitlist();

    expect(result).toEqual({ success: true, data: DATA });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/admin/waitlist')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('serverfel → { success: false, error } med serverns meddelande', async () => {
    fetchMock.mockResolvedValue(json(500, { error: 'Failed to load the waitlist' }));
    expect(await backendApi.getAdminWaitlist()).toEqual({ success: false, error: 'Failed to load the waitlist' });
  });

  it('nätverksfel → { success: false }', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await backendApi.getAdminWaitlist()).toEqual({ success: false, error: 'offline' });
  });

  it('utan token anropas inte nätverket', async () => {
    localStorage.clear();
    expect(await backendApi.getAdminWaitlist()).toEqual({ success: false, error: 'Not authenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
