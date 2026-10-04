import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// Board-endpointsen (ADR 007): rätt URL + Bearer, `{ success, data }` packas upp, fel blir { success: false }.

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

describe.each([
  ['getWeekLeaderboard', '/leaderboard/week', () => backendApi.getWeekLeaderboard()],
  ['getRankDelta', '/leaderboard/rank-delta', () => backendApi.getRankDelta()],
  ['getXpConfig', '/config/xp', () => backendApi.getXpConfig()],
] as const)('%s', (_name, path, call) => {
  it('GET mot rätt endpoint med Bearer-token och packar upp data', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { hello: 'world' }, meta: { x: 1 } }));

    const result = await call();

    expect(result).toEqual({ success: true, data: { hello: 'world' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith(path)).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('serverfel → { success: false, error } med serverns meddelande', async () => {
    fetchMock.mockResolvedValue(json(500, { error: 'Internal server error' }));
    expect(await call()).toEqual({ success: false, error: 'Internal server error' });
  });

  it('nätverksfel → { success: false }', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await call()).toEqual({ success: false, error: 'offline' });
  });

  it('utan token anropas inte nätverket', async () => {
    localStorage.clear();
    expect(await call()).toEqual({ success: false, error: 'Not authenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getWeekLeaderboard', () => {
  it('skickar week_start när den anges', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: {} }));
    await backendApi.getWeekLeaderboard('2026-09-21');
    expect(String(fetchMock.mock.calls[0][0]).endsWith('/leaderboard/week?week_start=2026-09-21')).toBe(true);
  });
});
