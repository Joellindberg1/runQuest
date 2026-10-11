import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { badgesApi } from './api';

// Klienten för /api/badges/*: rätt URL, metod och body per metod; svaret packas upp ur { success, data, meta }; fel kastas med
// serverns text (hookarna i react-query tar dem som felläge).

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

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), method: init.method as string | undefined, body: init.body as string | undefined, auth: init.headers.Authorization as string };
};

describe('getUserBadges', () => {
  it('GET /badges/user/:userId med Bearer och packar upp data', async () => {
    const data = { items: [{ series: 'milestoner', tier: 3, earned_at: '2026-10-01T00:00:00Z', seen_tier: 2 }], showcase: ['milestoner'] };
    fetchMock.mockResolvedValue(json(200, { success: true, data }));

    expect(await badgesApi.getUserBadges('u-1')).toEqual(data);
    const call = lastCall();
    expect(call.url.endsWith('/badges/user/u-1')).toBe(true);
    expect(call.method ?? 'GET').toBe('GET');
    expect(call.auth).toBe('Bearer tok-123');
  });

  it('url-kodar användar-id:t', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { items: [], showcase: [] } }));
    await badgesApi.getUserBadges('a/b c');
    expect(lastCall().url.endsWith('/badges/user/a%2Fb%20c')).toBe(true);
  });
});

describe('getGroupBadges', () => {
  it('GET /badges/group: data och meta.member_count följer med', async () => {
    const data = { members: [{ user_id: 'u-1', showcase: [{ series: 'climber', tier: 2 }] }], holders: { climber: { '1': 2, '2': 1 } } };
    fetchMock.mockResolvedValue(json(200, { success: true, data, meta: { member_count: 6 } }));

    expect(await badgesApi.getGroupBadges()).toEqual({ ...data, member_count: 6 });
    const call = lastCall();
    expect(call.url.endsWith('/badges/group')).toBe(true);
    expect(call.method ?? 'GET').toBe('GET');
  });

  it('saknad meta ger member_count null (held-by utelämnas då, inget gissas)', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { members: [], holders: {} } }));
    expect((await badgesApi.getGroupBadges()).member_count).toBeNull();
  });
});

describe('saveShowcase', () => {
  it('PUT /badges/showcase med { series } och ger det sparade valet', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { showcase: ['climber', 'milestoner'] } }));

    expect(await badgesApi.saveShowcase(['climber', 'milestoner'])).toEqual({ showcase: ['climber', 'milestoner'] });
    const call = lastCall();
    expect(call.url.endsWith('/badges/showcase')).toBe(true);
    expect(call.method).toBe('PUT');
    expect(JSON.parse(call.body ?? 'null')).toEqual({ series: ['climber', 'milestoner'] });
  });

  it('ett tomt val skickas som [] (rensar)', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { showcase: [] } }));
    await badgesApi.saveShowcase([]);
    expect(JSON.parse(lastCall().body ?? 'null')).toEqual({ series: [] });
  });
});

describe('markSeen', () => {
  it('POST /badges/seen med { series }', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { updated: ['climber'] } }));

    expect(await badgesApi.markSeen(['climber'])).toEqual({ updated: ['climber'] });
    const call = lastCall();
    expect(call.url.endsWith('/badges/seen')).toBe(true);
    expect(call.method).toBe('POST');
    expect(JSON.parse(call.body ?? 'null')).toEqual({ series: ['climber'] });
  });

  it('utan serier skickas {} (alla — serverns betydelse), inte series: undefined/[]', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { updated: [] } }));
    await badgesApi.markSeen();
    expect(JSON.parse(lastCall().body ?? 'null')).toEqual({});
  });
});

describe.each([
  ['getUserBadges', () => badgesApi.getUserBadges('u-1')],
  ['getGroupBadges', () => badgesApi.getGroupBadges()],
  ['saveShowcase', () => badgesApi.saveShowcase(['climber'])],
  ['markSeen', () => badgesApi.markSeen(['climber'])],
] as const)('%s — fel propageras', (_name, call) => {
  it('serverns felmeddelande kastas orört (t.ex. 400 vid fler än tre)', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'You can display at most 3 badges' }));
    await expect(call()).rejects.toThrow('You can display at most 3 badges');
  });

  it('404 (annan grupp) kastas med serverns text', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'User not found' }));
    await expect(call()).rejects.toThrow('User not found');
  });

  it('nätverksfel kastas', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(call()).rejects.toThrow('offline');
  });

  it('utan token anropas inte nätverket och felet kastas', async () => {
    localStorage.clear();
    await expect(call()).rejects.toThrow(/authentication/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ett svar utan data kastas i stället för att ge undefined', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true }));
    await expect(call()).rejects.toThrow();
  });
});
