import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from './sessionStorageKeys';

// Kuvertet och felformatet hos klienten, steg 1 (ADR 007 Addendum 2026-10-20 punkt 7-8): `request` läser `data` först och den gamla nyckeln som reserv, läser `code`, och en
// okänd kod är statusens klass. Alla fyra kombinationer fungerar: ny bundle mot ny backend (data) och mot gammal backend (reserven), och en gammal bundle mot ny backend
// (de gamla nycklarna finns kvar bredvid data: dubbelsvaret är en övermängd av den gamla kroppen).

const TOKEN = 'tok-123';
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

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

const user = { id: 'u1', name: 'Anna', email: 'a@example.com', is_admin: false };
const meta = { total: 7, limit: 6, offset: 0, has_more: true };
const event = { id: 'ev-1' };
const run = { id: 'r1', distance: 5 };
const status = { connected: true, expired: false, sync_paused: false };

interface Variant {
  name: string;
  call: () => Promise<unknown>;
  /** Kroppen en backend från före steg 1 ger (den gamla bundlen läser den). */
  legacy: Record<string, unknown>;
  /** Kroppen steg 1 ger: den gamla kroppen, `success` och `data` bredvid. */
  dual: Record<string, unknown>;
  /** Det klienten lämnar vidare, hela resultatet. */
  result: Record<string, unknown>;
}

const variants: Variant[] = [
  {
    name: 'login',
    call: () => { localStorage.clear(); return backendApi.login('Anna', 'pw'); },
    legacy: { success: true, token: 'jwt-1', user },
    dual: { success: true, token: 'jwt-1', user, data: { token: 'jwt-1', user } },
    result: { success: true, token: 'jwt-1', user },
  },
  {
    name: 'getStravaConfig',
    call: () => backendApi.getStravaConfig(),
    legacy: { client_id: '123' },
    dual: { success: true, client_id: '123', data: { client_id: '123' } },
    result: { success: true, data: { client_id: '123' } },
  },
  {
    name: 'getStravaStatus',
    call: () => backendApi.getStravaStatus(),
    legacy: status,
    dual: { success: true, ...status, data: status },
    result: { success: true, data: status },
  },
  {
    name: 'getEventList',
    call: () => backendApi.getEventList(),
    legacy: { events: [event] },
    dual: { success: true, events: [event], data: { events: [event] } },
    result: { success: true, data: { events: [event] } },
  },
  {
    name: 'getEventHistoryPage',
    call: () => backendApi.getEventHistoryPage(6, 0),
    legacy: { events: [event], meta },
    dual: { success: true, events: [event], data: { events: [event] }, meta },
    result: { success: true, data: { events: [event], meta } },
  },
  {
    name: 'getGroupRunHistoryPage',
    call: () => backendApi.getGroupRunHistoryPage(100, 0),
    legacy: { runs: [run], meta },
    dual: { success: true, runs: [run], data: { runs: [run] }, meta },
    result: { success: true, data: { runs: [run], meta } },
  },
  {
    name: 'createRun',
    call: () => backendApi.createRun('2026-10-11', 5),
    legacy: { success: true, message: 'Run created successfully', run },
    dual: { success: true, message: 'Run created successfully', run, data: { run } },
    result: { success: true, data: run, message: 'Run created successfully' },
  },
  {
    name: 'updateRun',
    call: () => backendApi.updateRun('r1', { distance: 5 }),
    legacy: { success: true, message: 'Run updated successfully', run },
    dual: { success: true, message: 'Run updated successfully', run, data: { run } },
    result: { success: true, data: run, message: 'Run updated successfully' },
  },
  {
    name: 'updateRun (the run could not be read back: null)',
    call: () => backendApi.updateRun('r1', { distance: 5 }),
    legacy: { success: true, message: 'Run updated successfully', run: null },
    dual: { success: true, message: 'Run updated successfully', run: null, data: { run: null } },
    result: { success: true, data: null, message: 'Run updated successfully' },
  },
  {
    name: 'deleteRun',
    call: () => backendApi.deleteRun('r1'),
    legacy: { success: true, message: 'Run deleted successfully' },
    dual: { success: true, message: 'Run deleted successfully', data: null },
    result: { success: true, message: 'Run deleted successfully' },
  },
  {
    name: 'changePassword',
    call: () => backendApi.changePassword('old', 'new'),
    legacy: { success: true, message: 'Password changed successfully' },
    dual: { success: true, message: 'Password changed successfully', data: null },
    result: { success: true, message: 'Password changed successfully' },
  },
  {
    name: 'syncStrava',
    call: () => backendApi.syncStrava(),
    legacy: { success: true, message: 'Synced 2 new runs from Strava', newRuns: 2, totalActivities: 5 },
    dual: { success: true, message: 'Synced 2 new runs from Strava', newRuns: 2, totalActivities: 5, data: { newRuns: 2, totalActivities: 5 } },
    result: { success: true, data: { newRuns: 2, totalActivities: 5 } },
  },
  {
    name: 'joinGroup',
    call: () => backendApi.joinGroup('ABC123'),
    legacy: { success: true, message: 'Successfully joined group "Crew"', group: { id: 'g1', name: 'Crew' } },
    dual: { success: true, message: 'Successfully joined group "Crew"', group: { id: 'g1', name: 'Crew' }, data: { group: { id: 'g1', name: 'Crew' } } },
    result: { success: true, data: { group: { id: 'g1', name: 'Crew' } }, message: 'Successfully joined group "Crew"' },
  },
];

/** Resultatet utan nycklar vars värde är undefined: ett svar där `data` är satt till undefined och ett där den saknas är samma resultat för anroparen. */
const settled = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

describe('request reads data first and the old key as a fallback', () => {
  it.each(variants)('$name: a new backend (data) and an old backend (the old keys) give the same result', async ({ call, legacy, dual, result }) => {
    fetchMock.mockResolvedValue(reply(200, dual));
    const fromNew = settled(await call());

    fetchMock.mockResolvedValue(reply(200, legacy));
    const fromOld = settled(await call());

    // Den gamla formen har toppnivåfälten kvar i nyttolasten (success, message ...): det anroparen läser är detsamma, och det som sägs i `result` finns i båda.
    expect(fromNew).toMatchObject(settled(result));
    expect(fromOld).toMatchObject(settled(result));
  });

  it.each(variants)('$name: an old bundle still finds everything it read before in the new answer (the double answer is a superset)', ({ legacy, dual }) => {
    expect(dual).toMatchObject(legacy);
  });

  it('prefers data over the old key when the two differ (the new key is the one that counts)', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, message: 'm', run: { id: 'old' }, data: { run: { id: 'new' } } }));
    expect(await backendApi.createRun('2026-10-11', 5)).toMatchObject({ success: true, data: { id: 'new' } });
  });

  it('a page keeps meta at the top level in both forms', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, events: [], data: { events: [] }, meta }));
    expect(await backendApi.getEventHistoryPage(6, 0)).toEqual({ success: true, data: { events: [], meta } });
  });

  it('data: null is a payload that is null, not a missing one (a message-only answer)', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, message: 'Challenge withdrawn', data: null }));
    expect(await backendApi.withdrawChallenge('c1')).toEqual({ success: true });
  });
});

describe('request reads code, and an unknown code is the class of the status', () => {
  it('carries the code of a known error next to the text', async () => {
    fetchMock.mockResolvedValue(reply(409, { success: false, error: 'Sync is paused', code: 'sync_paused' }));
    expect(await backendApi.syncStrava()).toEqual({ success: false, error: 'Sync is paused', code: 'sync_paused' });
  });

  it('drops a code it does not know (a newer server) and keeps the text: the status class decides', async () => {
    fetchMock.mockResolvedValue(reply(500, { success: false, error: 'Something new', code: 'some_future_code' }));
    const result = await backendApi.syncStrava();
    expect(result).toEqual({ success: false, error: 'Something new' });
    expect(result).not.toHaveProperty('code');
  });

  it('gives no code for an error without one (an old backend, or a local error)', async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'boom' }));
    expect(await backendApi.syncStrava()).toEqual({ success: false, error: 'boom' });
    localStorage.clear();
    expect(await backendApi.syncStrava()).toEqual({ success: false, error: 'No authentication token' });
  });

  it('a 2xx answer with success: false (207 partial_failure) is an error for the client', async () => {
    fetchMock.mockResolvedValue(reply(207, { success: false, error: '1 of 3 users failed; the rest were recalculated', code: 'partial_failure', data: { total: 3, processed: 2, failed: 1 } }));
    const result = await backendApi.authenticatedRequest('/titles/reprocess-all', { method: 'POST' });
    expect(result).toEqual({ success: false, error: '1 of 3 users failed; the rest were recalculated', code: 'partial_failure' });
  });
});

describe('the session is cleared only for a 401 that ends the session', () => {
  const expectCleared = () => {
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
  };
  const expectKept = () => {
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_TOKEN_KEY)).toBe(TOKEN);
  };

  it.each(['unauthorized', 'token_invalid'])('clears the session for 401 %s', async (code) => {
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Invalid token', code }));
    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Session expired. Please log in again.', code });
    expectCleared();
  });

  it('clears the session for a 401 without a code (an old backend) and for a 401 with a code it does not know', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: 'Invalid token' }));
    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Session expired. Please log in again.' });
    expectCleared();

    localStorage.setItem(SESSION_TOKEN_KEY, TOKEN);
    onUnauthorized.mockClear();
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'New thing', code: 'some_future_code' }));
    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Session expired. Please log in again.' });
    expectCleared();
  });

  it('pins the ADR rule as an allow-list: a code the client does not know (filtered by isApiErrorCode) is no code, so a 401 with it clears the session', async () => {
    for (const code of ['some_future_code', 'Unauthorized', '', 'token_invalid ', 42, null]) {
      localStorage.setItem(SESSION_TOKEN_KEY, TOKEN);
      onUnauthorized.mockClear();
      fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Nope', code }));
      expect(await backendApi.getAllUsers(), String(code)).toEqual({ success: false, error: 'Session expired. Please log in again.' });
      expectCleared();
    }
  });

  it('a 401 with a known code that does not end a session (forbidden) keeps the session and carries the code: the allow-list is unauthorized, token_invalid or no code', async () => {
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Forbidden', code: 'forbidden' }));
    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Forbidden', code: 'forbidden' });
    expectKept();
  });

  it('keeps the session and shows the error for a wrong current password (current_password_incorrect)', async () => {
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Current password is incorrect', code: 'current_password_incorrect' }));
    expect(await backendApi.changePassword('wrong', 'new-password')).toEqual({ success: false, error: 'Current password is incorrect', code: 'current_password_incorrect' });
    expectKept();
  });

  it('keeps the session for invalid_credentials too, with a token', async () => {
    fetchMock.mockResolvedValue(reply(401, { success: false, error: 'Invalid credentials', code: 'invalid_credentials' }));
    expect(await backendApi.getAllUsers()).toEqual({ success: false, error: 'Invalid credentials', code: 'invalid_credentials' });
    expectKept();
  });
});

describe('a write that happened but whose recalculation failed counts as written', () => {
  const text = 'Run was created but XP recalculation failed';

  it.each([
    ['with the code and written: true (the double answer)', { success: false, error: text, code: 'recalc_failed_after_write', written: true }],
    ['with the code and without written (after step 2)', { success: false, error: text, code: 'recalc_failed_after_write' }],
    ['with written and without the code (an old backend)', { error: text, written: true }],
  ])('createRun %s: written: true reaches the caller', async (_name, body) => {
    fetchMock.mockResolvedValue(reply(500, body));
    const result = await backendApi.createRun('2026-10-11', 5);
    expect(result).toMatchObject({ success: false, error: text, written: true });
  });

  it.each([
    ['updateRun', () => backendApi.updateRun('r1', { distance: 9 })],
    ['deleteRun', () => backendApi.deleteRun('r1')],
  ])('%s: the code alone is enough', async (_name, call) => {
    fetchMock.mockResolvedValue(reply(500, { success: false, error: 'x', code: 'recalc_failed_after_write' }));
    expect(await call()).toMatchObject({ success: false, written: true, code: 'recalc_failed_after_write' });
  });

  it('a plain 500 without the code and without written is an ordinary error', async () => {
    fetchMock.mockResolvedValue(reply(500, { success: false, error: 'Internal server error', code: 'internal_error' }));
    const result = await backendApi.createRun('2026-10-11', 5);
    expect(result).toEqual({ success: false, error: 'Internal server error', code: 'internal_error' });
    expect(result).not.toHaveProperty('written');
  });
});

describe('authenticatedRequest names its endpoint in the failure text', () => {
  it('uses "Request failed: <endpoint>" when the server gives no text, so the log shows the way', async () => {
    fetchMock.mockResolvedValue(reply(500, {}));
    expect(await backendApi.authenticatedRequest('/anything')).toEqual({ success: false, error: 'Request failed: /anything' });
  });
});
