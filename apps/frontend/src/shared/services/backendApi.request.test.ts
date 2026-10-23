import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleLeaderboardResponse } from '@runquest/shared';
import { backendApi } from './backendApi';
import { TOKEN, callRows } from './backendApi.calls.fixture';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from './sessionStorageKeys';

// Den enda vägen genom klienten: sessionsutgång (401) på ett ställe med en text, tåligt läst JSON, `meta` som når anroparen och en enda bas-URL.
// Anropens form och uppackningen per metod ligger i backendApi.requests.test.ts.

const SESSION_EXPIRED = 'Session expired. Please log in again.';
const HTML_PAGE = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>Bad gateway</body></html>';

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const htmlReply = (status: number) => new Response(HTML_PAGE, { status, headers: { 'Content-Type': 'text/html' } });

const rows = callRows(backendApi);
let fetchMock: ReturnType<typeof vi.fn>;
let onUnauthorized: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  localStorage.setItem(SESSION_TOKEN_KEY, TOKEN);
  localStorage.setItem(SESSION_USER_KEY, JSON.stringify({ id: 'u1', name: 'Anna', email: 'a@example.com' }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  onUnauthorized = vi.fn<() => void>();
  backendApi.onUnauthorized = onUnauthorized;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  backendApi.onUnauthorized = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('en 401-väg', () => {
  // Steg 1 (ADR 007 Addendum 2026-10-20 punkt 7): sessionen avslutas av 401 med koden token_invalid eller unauthorized. Ett fel nuvarande lösenord (changePassword) är ett 401
  // som INTE avslutar sessionen, så kodlösa 401 (en backend från före steg 1) och kodbärande 401 prövas för alla metoder, och changePassword har sitt eget fall nedan.
  it.each(rows)('$name: 401 token_invalid loggar ut sessionen och ger samma text', async ({ call }) => {
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Invalid token', code: 'token_invalid' }));

    expect(await call()).toEqual({ success: false, error: SESSION_EXPIRED, code: 'token_invalid' });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_USER_KEY)).toBeNull();
  });

  it.each(rows)('$name: ett 401 utan kod (en backend från före steg 1) loggar ut sessionen och ger samma text', async ({ call }) => {
    fetchMock.mockResolvedValue(reply(401, { error: 'Invalid token' }));

    expect(await call()).toEqual({ success: false, error: SESSION_EXPIRED });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_USER_KEY)).toBeNull();
  });

  it('changePassword: fel nuvarande lösenord (401 current_password_incorrect) loggar inte ut sessionen och felet står kvar', async () => {
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Current password is incorrect', code: 'current_password_incorrect' }));

    expect(await backendApi.changePassword('fel', 'nytt-lösenord')).toEqual({ success: false, error: 'Current password is incorrect', code: 'current_password_incorrect' });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe(TOKEN);
    expect(localStorage.getItem(SESSION_USER_KEY)).not.toBeNull();
  });

  it('uploadProfilePicture: 401 loggar ut sessionen och ger samma text', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: 'Invalid token' }));

    expect(await backendApi.uploadProfilePicture(new File(['x'], 'me.png', { type: 'image/png' }))).toEqual({ success: false, error: SESSION_EXPIRED });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  it('en 401 vars svar inte är JSON loggar också ut sessionen', async () => {
    fetchMock.mockImplementation(async () => htmlReply(401));

    expect(await backendApi.getUsersWithRuns()).toEqual({ success: false, error: SESSION_EXPIRED });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('fel lösenord vid inloggning (401 utan token) loggar inte ut och ger serverns text', async () => {
    localStorage.clear();
    fetchMock.mockResolvedValue(reply(401, { error: 'Invalid credentials' }));

    expect(await backendApi.login('Anna', 'fel')).toEqual({ success: false, error: 'Invalid credentials' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('anrop utan token (publik statistik, Strava-konfiguration, väntelistan) loggar inte ut vid 401', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: 'nope' }));

    await backendApi.getPublicStats();
    await backendApi.getStravaConfig();
    expect(await backendApi.joinWaitlist({ email: 'a@example.com', consent: true, website: '', elapsedMs: 5000 })).toEqual({ status: 401 });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe(TOKEN);
  });

  it('ett annat fel än 401 rör inte sessionen', async () => {
    fetchMock.mockResolvedValue(reply(403, { error: 'Admin access required' }));

    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Admin access required' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe(TOKEN);
  });
});

describe('läser JSON tåligt', () => {
  it('ett HTML-svar med status 500 ger { success: false, error } och inget kastat SyntaxError', async () => {
    fetchMock.mockImplementation(async () => htmlReply(500));

    for (const { name, call } of rows) {
      const result = (await call()) as { success: boolean; error?: string };
      expect({ name, success: result.success, error: typeof result.error }).toEqual({ name, success: false, error: 'string' });
      expect({ name, error: result.error }).toEqual({ name, error: expect.not.stringMatching(/SyntaxError|Unexpected token|JSON|<html|<!DOCTYPE/i) });
    }
  });

  it('ett HTML-svar på ett lyckat anrop (200) är ett fel, inte en lyckad tom uppackning', async () => {
    fetchMock.mockImplementation(async () => htmlReply(200));

    for (const { name, call } of rows) {
      expect({ name, success: ((await call()) as { success: boolean }).success }).toEqual({ name, success: false });
    }
  });

  it('login, publik statistik och Strava-konfiguration tål också ett HTML-svar', async () => {
    localStorage.clear();
    fetchMock.mockImplementation(async () => htmlReply(502));

    expect(await backendApi.login('Anna', 'pw')).toEqual({ success: false, error: expect.any(String) });
    expect(await backendApi.getPublicStats()).toEqual({ success: false, error: 'HTTP 502' });
    expect(await backendApi.getStravaConfig()).toEqual({ success: false, error: expect.any(String) });
    expect(await backendApi.joinWaitlist({ email: 'a@example.com', consent: true, website: '', elapsedMs: 5000 })).toEqual({ status: 502 });
  });

  it('serverns text, koden och written följer med trots att resten av svaret är oläsligt eller saknas', async () => {
    fetchMock.mockResolvedValue(reply(500, { success: false, error: 'Run was created but XP recalculation failed', code: 'recalc_failed_after_write', written: true }));

    expect(await backendApi.createRun('2026-10-11', 5)).toEqual({ success: false, error: 'Run was created but XP recalculation failed', code: 'recalc_failed_after_write', written: true });
  });
});

describe('meta', () => {
  it('meta når anroparen för titles/leaderboard', async () => {
    const body: TitleLeaderboardResponse = {
      success: true,
      data: [{ id: 't1', name: 'The Batman', description: 'Night runs', unlock_requirement: 7, holder: null, runners_up: [] }],
      meta: { total_titles: 1, timestamp: '2026-10-18T00:00:00Z', cache_optimized: true },
    };
    fetchMock.mockResolvedValue(reply(200, body));

    expect(await backendApi.getTitleLeaderboard()).toEqual({ success: true, data: body.data, meta: body.meta });
  });

  it('meta och data når anroparen också för nyheter och inställningar', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: { items: [] }, meta: { unread_count: 3, last_seen_id: null, has_more: false, next_before: null } }));

    expect(await backendApi.getNews()).toEqual({
      success: true, data: { items: [] }, meta: { unread_count: 3, last_seen_id: null, has_more: false, next_before: null },
    });
  });
});

describe('en bas-URL', () => {
  const BASE = 'https://api.example.test/v9';
  const Client = backendApi.constructor as new (baseUrl: string) => typeof backendApi;

  it.each(rows)('$name går mot klientens egen bas-URL', async ({ name, path }) => {
    fetchMock.mockResolvedValue(reply(200, {}));
    const client = new Client(BASE);
    const row = callRows(client).find((candidate) => candidate.name === name)!;

    await row.call();

    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}${path}`);
  });

  it('getPublicStats, getStravaConfig och joinWaitlist använder samma bas-URL', async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    const client = new Client(BASE);

    await client.getPublicStats();
    await client.getStravaConfig();
    await client.joinWaitlist({ email: 'a@example.com', consent: true, website: '', elapsedMs: 5000 });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([`${BASE}/public/stats`, `${BASE}/strava/config`, `${BASE}/waitlist`]);
  });

  it('uploadProfilePicture använder samma bas-URL', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: {} }));

    await new Client(BASE).uploadProfilePicture(new File(['x'], 'me.png', { type: 'image/png' }));

    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/users/profile-picture`);
  });
});
