import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JoinGroupResponse, LoginResponse, MyGroup } from '@runquest/shared';
import { backendApi } from './backendApi';

// Klientens anrop följer kontrakten i @runquest/shared: samma typer som backend skriver sina svar mot. Typfelen fångas av `tsc -b` (testfilerna ingår),
// beteendet här.

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

describe('login', () => {
  it('svaret och den sparade sessionen bär is_admin', async () => {
    localStorage.clear();
    const user = { id: 'u1', name: 'Anna', email: 'anna@example.com', is_admin: true };
    // Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20): token och user på toppnivå (gammal klient) och i data (ny klient).
    const response: LoginResponse = { success: true, token: 'jwt-1', user, data: { token: 'jwt-1', user } };
    fetchMock.mockResolvedValue(json(200, response));

    const result = await backendApi.login('Anna', 'hemligt');

    expect(result).toEqual({ success: true, token: 'jwt-1', user });
    if (!result.success) throw new Error('inloggningen skulle lyckas');
    const isAdmin: boolean = result.user.is_admin;
    expect(isAdmin).toBe(true);
    expect(backendApi.getCurrentUser()).toEqual(response.user);
  });

  it('ett fel ger { success: false, error } med serverns text', async () => {
    fetchMock.mockResolvedValue(json(401, { error: 'Invalid credentials' }));

    expect(await backendApi.login('Anna', 'fel')).toEqual({ success: false, error: 'Invalid credentials' });
  });
});

describe('createRun', () => {
  it('rundan kan vara bara { id } när servern inte kunde läsa tillbaka den, så siffrorna kräver en kontroll av formen först', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: 'Run created successfully', run: { id: 'r9' } }));

    const res = await backendApi.createRun('2026-10-11', 5);
    const run = res.data;
    if (!run) throw new Error('rundan skulle skapas');

    // @ts-expect-error distance finns inte på { id }: formen måste kontrolleras först
    void run.distance;
    expect('xp_gained' in run).toBe(false);
    if ('xp_gained' in run) expect(run.xp_gained).toBeDefined();
  });
});

describe('updateRun', () => {
  it('PUT-bodyn är exakt date och distance, inga fält som servern ignorerar', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: 'Run updated successfully', run: { id: 'r1' } }));

    const res = await backendApi.updateRun('r1', { date: '2026-10-12', distance: 6.5 });

    expect(res).toEqual({ success: true, data: { id: 'r1' }, message: 'Run updated successfully' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/runs/r1')).toBe(true);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ date: '2026-10-12', distance: 6.5 });
  });

  it('duration, title och description är inte fält i anropet', () => {
    fetchMock.mockResolvedValue(json(200, { success: true, run: null }));

    // Servern ignorerar tre fält som klienten förr kunde skicka. De finns inte i UpdateRunRequest, så varje rad nedan är ett typfel (`tsc -b`).
    // @ts-expect-error duration
    void backendApi.updateRun('r1', { distance: 5, duration: 1800 });
    // @ts-expect-error title
    void backendApi.updateRun('r1', { distance: 5, title: 'Morgonrunda' });
    // @ts-expect-error description
    void backendApi.updateRun('r1', { distance: 5, description: 'Lugnt' });
  });
});

describe('refreshTitleLeaderboards', () => {
  it('lyckas på serverns { success, message, timestamp } utan att vänta sig ett updated-fält', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: 'Title leaderboards refreshed successfully', timestamp: '2026-10-20T08:00:00.000Z' }));

    expect(await backendApi.refreshTitleLeaderboards()).toEqual({ success: true });
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});

describe('groups', () => {
  const group: MyGroup = {
    id: 'g1', name: 'Wolfpack', is_owner: false, my_role: 'member', member_count: 1, created_at: '2026-09-01T08:00:00Z',
    members: [{ id: 'u1', name: 'Anna', total_xp: 120, current_level: 3 }],
  };

  it('getGroupInfo ger gruppen med my_role, member_count och created_at', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: group }));

    const res = await backendApi.getGroupInfo();

    expect(res).toEqual({ success: true, data: group });
    expect(res.data?.my_role).toBe('member');
    expect(res.data?.member_count).toBe(1);
  });

  it('joinGroup skickar { invite_code } till POST /groups/join och ger serverns svar', async () => {
    const group = { id: 'g1', name: 'Wolfpack' };
    const joined: JoinGroupResponse = { success: true, message: 'Successfully joined group "Wolfpack"', group, data: { group } };
    fetchMock.mockResolvedValue(json(200, joined));

    const res = await backendApi.joinGroup('ABC123');

    expect(res).toEqual({ success: true, data: { group }, message: 'Successfully joined group "Wolfpack"' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/groups/join')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ invite_code: 'ABC123' });
  });

  it('joinGroup: 409 (redan medlem) blir ett fel med serverns text', async () => {
    fetchMock.mockResolvedValue(json(409, { error: 'You are already a member of a group' }));

    expect(await backendApi.joinGroup('ABC123')).toEqual({ success: false, data: undefined, error: 'You are already a member of a group' });
  });
});

describe('markNewsSeen', () => {
  it('skickar up_to_id när ett id ges och en tom body annars', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { last_seen_id: 5, unread_count: 0 } }));

    await backendApi.markNewsSeen(5);
    await backendApi.markNewsSeen();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ up_to_id: 5 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({});
  });
});
