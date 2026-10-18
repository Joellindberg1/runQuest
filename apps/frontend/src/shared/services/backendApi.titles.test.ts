import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleLeaderboardResponse, UserTitlesResponse } from '@runquest/shared';
import { backendApi } from './backendApi';

// Titelendpointsen (ADR 012 beslut 8): svaren följer contracts/titles, och 404 från /titles/user/:id betyder
// "inga titlar att visa" — klienten får aldrig veta att personen finns i en annan grupp.

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

describe('getUserTitles', () => {
  it('packar upp titlarna ur svaret', async () => {
    const body: UserTitlesResponse = {
      success: true,
      data: [{ title_id: 't1', title_name: 'The Batman', title_description: '', position: 1, value: 7, earned_at: '2026-10-01', is_current_holder: true, status: 'holder' }],
      meta: { user_id: 'u1', total_titles: 1, current_holder_count: 1, timestamp: '2026-10-18T00:00:00Z' },
    };
    fetchMock.mockResolvedValue(json(200, body));

    const result = await backendApi.getUserTitles('u1');

    expect(result).toEqual({ success: true, data: body.data });
    expect(String(fetchMock.mock.calls[0][0]).endsWith('/titles/user/u1')).toBe(true);
  });

  it('404 (användaren finns utanför gruppen) blir en tom titellista, inte ett fel', async () => {
    fetchMock.mockResolvedValue(json(404, { success: false, error: 'User not found' }));

    const result = await backendApi.getUserTitles('u-elsewhere');

    expect(result).toEqual({ success: true, data: [] });
  });

  it('en tom lista (anroparen saknar grupp) är en lyckad tom lista', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: [], meta: { user_id: 'u1', total_titles: 0, current_holder_count: 0, timestamp: '' } }));

    expect(await backendApi.getUserTitles('u1')).toEqual({ success: true, data: [] });
  });

  it.each([403, 500])('%d förblir ett fel', async (status) => {
    fetchMock.mockResolvedValue(json(status, { error: 'nope' }));

    expect(await backendApi.getUserTitles('u1')).toEqual({ success: false, error: 'nope' });
  });

  it('nätverksfel förblir ett fel', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    expect(await backendApi.getUserTitles('u1')).toEqual({ success: false, error: 'offline' });
  });
});

describe('getTitleLeaderboard', () => {
  it('packar upp raderna, med ägarlösa titlar och utan profilbild som null', async () => {
    const body: TitleLeaderboardResponse = {
      success: true,
      data: [
        {
          id: 't1', name: 'The Batman', description: 'Night runs', unlock_requirement: 7,
          holder: { user_id: 'u1', user_name: 'Karl', profile_picture: null, value: 9, earned_at: '2026-10-01' },
          runners_up: [{ position: 2, user_id: 'u2', user_name: 'Anna', profile_picture: null, value: 8, earned_at: '2026-10-02' }],
        },
        { id: 't2', name: 'The Commuter', description: '', unlock_requirement: 5, holder: null, runners_up: [] },
      ],
      meta: { total_titles: 2, timestamp: '2026-10-18T00:00:00Z', cache_optimized: true },
    };
    fetchMock.mockResolvedValue(json(200, body));

    expect(await backendApi.getTitleLeaderboard()).toEqual({ success: true, data: body.data });
  });

  it('en tom lista (anroparen saknar grupp) är en lyckad tom lista', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, data: [], meta: { total_titles: 0, timestamp: '', cache_optimized: true } }));

    expect(await backendApi.getTitleLeaderboard()).toEqual({ success: true, data: [] });
  });
});
