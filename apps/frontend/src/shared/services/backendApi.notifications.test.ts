import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// Klientmetoderna för användarinställningar och läst per rad (ADR 011): rätt metod, väg och body, och svaret i ApiResponse-formen.

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body as string) };
};

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

describe('inställningar', () => {
  const state = { success: true, data: { values: { 'notify.title_others': false } }, meta: { customised: ['notify.title_others'] } };

  it('getSettings hämtar GET /settings och för vidare värdena och meta.customised', async () => {
    fetchMock.mockResolvedValue(json(200, state));
    const result = await backendApi.getSettings();
    expect(lastCall()).toMatchObject({ url: expect.stringMatching(/\/settings$/), method: 'GET' });
    expect(result).toEqual({ success: true, data: state.data, meta: state.meta });
  });

  it('putSettings skickar PUT /settings med { values } (null = återställ) och svarar med hela tillståndet', async () => {
    fetchMock.mockResolvedValue(json(200, state));
    const result = await backendApi.putSettings({ 'notify.title_others': false, 'notify.event_open': null });
    expect(lastCall()).toMatchObject({
      url: expect.stringMatching(/\/settings$/),
      method: 'PUT',
      body: { values: { 'notify.title_others': false, 'notify.event_open': null } },
    });
    expect(result).toEqual({ success: true, data: state.data, meta: state.meta });
  });

  it('ett serverfel blir success:false med serverns text; utan token görs inget anrop', async () => {
    fetchMock.mockResolvedValue(json(500, { error: 'Failed to save settings' }));
    expect(await backendApi.putSettings({ 'notify.title_others': true })).toEqual({ success: false, error: 'Failed to save settings' });

    fetchMock.mockClear();
    localStorage.clear();
    expect(await backendApi.getSettings()).toEqual({ success: false, error: 'Not authenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('läst per rad', () => {
  it('markNewsRead skickar POST /news/read med { ids } och svarar med unread_count', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: { unread_count: 4 } }));
    const result = await backendApi.markNewsRead([7, 9]);
    expect(lastCall()).toMatchObject({ url: expect.stringMatching(/\/news\/read$/), method: 'POST', body: { ids: [7, 9] } });
    expect(result).toEqual({ success: true, data: { unread_count: 4 } });
  });

  it('markNewsRead: ett fel ger success:false', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'ids must be 1-50 unique positive integers' }));
    expect(await backendApi.markNewsRead([])).toEqual({ success: false, error: 'ids must be 1-50 unique positive integers' });
  });
});

describe('getNews med involves', () => {
  const page = { success: true, data: { items: [] }, meta: { unread_count: 0, last_seen_id: null, has_more: false, next_before: null } };

  it('involves=me läggs på adressen tillsammans med övriga parametrar; utelämnad ger ingen parameter', async () => {
    fetchMock.mockResolvedValue(json(200, page));
    await backendApi.getNews({ limit: 30, type: 'level_up', involves: 'me' });
    const withInvolves = new URL(lastCall().url);
    expect(withInvolves.pathname.endsWith('/news')).toBe(true);
    expect(Object.fromEntries(withInvolves.searchParams)).toEqual({ limit: '30', type: 'level_up', involves: 'me' });

    await backendApi.getNews({ limit: 30 });
    expect(new URL(lastCall().url).searchParams.has('involves')).toBe(false);
  });
});
