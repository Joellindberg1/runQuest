import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';
import { AUTH, AUTH_JSON, TOKEN, callRows } from './backendApi.calls.fixture';

// Vad klienten skickar till servern och hur svaret packas upp, för varje publik metod: samma sökväg, metod, headers och body som före
// sammanslagningen till en enda `request`, samma uppackning och samma reservtext när servern inte ger någon. Raderna (fixturen) är skrivna mot
// den gamla klienten och gröna före och efter ombyggnaden; sessionsutgång (401) och oläsbara svar har egna tester i backendApi.request.test.ts.

const JSON_ONLY = { 'Content-Type': 'application/json' };
const DATA = { k: 1 };
const envelope = { success: true, data: DATA, message: 'msg' };

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const rows = callRows(backendApi);

let fetchMock: ReturnType<typeof vi.fn>;

/** Det som gick över tråden: sökväg efter API-basen, metod, headers och body, med webbläsarens standardvärden (GET, inga headers) ifyllda. */
function sentRequest() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return {
    path: String(url).replace(/^.*?\/api(?=\/)/, ''),
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

beforeEach(() => {
  localStorage.setItem('runquest_token', TOKEN);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('anrop mot servern är oförändrade', () => {
  it.each(rows)('$name skickar samma sökväg, metod, headers och body', async ({ call, path, method, headers, body, okBody }) => {
    fetchMock.mockResolvedValue(reply(200, okBody));

    await call();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentRequest()).toEqual({ path, method, headers, body });
  });

  it.each(rows)('$name packar upp ett lyckat svar', async ({ call, okBody, okResult }) => {
    fetchMock.mockResolvedValue(reply(200, okBody));

    expect(await call()).toEqual(okResult);
  });

  it.each(rows)('$name ger serverns text vid ett fel och annars sin egen reservtext', async ({ call, fallback }) => {
    fetchMock.mockResolvedValue(reply(400, { error: 'boom' }));
    expect(await call()).toEqual({ success: false, error: 'boom' });

    fetchMock.mockResolvedValue(reply(500, {}));
    expect(await call()).toEqual({ success: false, error: fallback });
  });

  it.each(rows)('$name ger success:false med felets text vid ett nätverksfel', async ({ call }) => {
    fetchMock.mockRejectedValue(new Error('offline'));

    expect(await call()).toEqual({ success: false, error: 'offline' });
  });
});

describe('anrop utan inloggning', () => {
  it('login skickar bara Content-Type, sparar sessionen och ger token och användare', async () => {
    localStorage.clear();
    const user = { id: 'u1', name: 'Anna', email: 'a@example.com', is_admin: false };
    fetchMock.mockResolvedValue(reply(200, { success: true, token: 'jwt-1', user }));

    const result = await backendApi.login('Anna', 'pw');

    expect(sentRequest()).toEqual({ path: '/auth/login', method: 'POST', headers: JSON_ONLY, body: { name: 'Anna', password: 'pw' } });
    expect(result).toEqual({ success: true, token: 'jwt-1', user });
    expect(backendApi.getToken()).toBe('jwt-1');
  });

  it('login: ett fel utan text ger "Login failed"', async () => {
    fetchMock.mockResolvedValue(reply(500, {}));

    expect(await backendApi.login('Anna', 'pw')).toEqual({ success: false, error: 'Login failed' });
  });

  it('getPublicStats och getStravaConfig skickar ingen Authorization-header, även med en token', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: { runners: 4, challenges: 2, km: 90 } }));
    expect(await backendApi.getPublicStats()).toEqual({ success: true, data: { runners: 4, challenges: 2, km: 90 } });
    expect(sentRequest()).toEqual({ path: '/public/stats', method: 'GET', headers: {}, body: undefined });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(reply(200, { client_id: '123' }));
    expect(await backendApi.getStravaConfig()).toEqual({ success: true, data: { client_id: '123' } });
    expect(sentRequest()).toEqual({ path: '/strava/config', method: 'GET', headers: {}, body: undefined });
  });

  it('getPublicStats: HTTP-statusen följer med i felet och ett orimligt svar är ett fel', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: 'not here' }));
    expect(await backendApi.getPublicStats()).toEqual({ success: false, error: 'HTTP 404' });

    fetchMock.mockResolvedValue(reply(200, { success: true, data: { runners: -1, challenges: 2, km: 3 } }));
    expect(await backendApi.getPublicStats()).toEqual({ success: false, error: 'Invalid public stats response' });

    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await backendApi.getPublicStats()).toEqual({ success: false, error: 'Network error' });
  });

  it('getStravaConfig: ett fel ger serverns text eller reservtexten', async () => {
    fetchMock.mockResolvedValue(reply(500, {}));
    expect(await backendApi.getStravaConfig()).toEqual({ success: false, error: 'Failed to get Strava config' });
  });
});

describe('uploadProfilePicture', () => {
  it('skickar filen som den är med filens innehållstyp och packar upp data', async () => {
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fetchMock.mockResolvedValue(reply(200, envelope));

    expect(await backendApi.uploadProfilePicture(file)).toEqual({ success: true, data: DATA });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url).endsWith('/users/profile-picture')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ ...AUTH, 'Content-Type': 'image/png' });
    expect(init.body).toBe(file);
  });

  it('ett fel utan text ger reservtexten', async () => {
    fetchMock.mockResolvedValue(reply(500, {}));

    expect(await backendApi.uploadProfilePicture(new File(['x'], 'me.png', { type: 'image/png' }))).toEqual({ success: false, error: 'Failed to upload profile picture' });
  });
});

describe('written och 404-som-tomt', () => {
  it('createRun, updateRun och deleteRun för vidare written:true tillsammans med serverns text', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: 'recalc failed', written: true }));

    for (const call of [() => backendApi.createRun('2026-10-11', 5), () => backendApi.updateRun('r1', { distance: 5 }), () => backendApi.deleteRun('r1')]) {
      expect(await call()).toEqual({ success: false, error: 'recalc failed', written: true });
    }
  });

  it('getUserTitles läser 404 som en tom lista men inget annat fel', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: 'User not found' }));
    expect(await backendApi.getUserTitles('u1')).toEqual({ success: true, data: [] });

    fetchMock.mockResolvedValue(reply(404, { error: 'User not found' }));
    expect(await backendApi.getTitleLeaderboard()).toEqual({ success: false, error: 'User not found' });
  });
});

describe('tomma anrop', () => {
  it('markNewsSeen utan id skickar en tom body och getNews utan frågor ingen frågesträng', async () => {
    fetchMock.mockResolvedValue(reply(200, envelope));
    await backendApi.markNewsSeen();
    expect(sentRequest().body).toEqual({});

    fetchMock.mockClear();
    await backendApi.getNews();
    expect(sentRequest().path).toBe('/news');
  });

  it('createRun utan nyckel och utan löpband skickar varken Idempotency-Key eller is_treadmill', async () => {
    fetchMock.mockResolvedValue(reply(200, { run: { id: 'r1' } }));

    await backendApi.createRun('2026-10-11', 5);

    expect(sentRequest()).toEqual({ path: '/runs', method: 'POST', headers: AUTH_JSON, body: { date: '2026-10-11', distance: 5 } });
  });
});
