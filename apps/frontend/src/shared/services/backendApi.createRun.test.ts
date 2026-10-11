import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// RUN-105 T6: servern äger rundans ursprung och ignorerar klientens fält (RUN-136) — klienten skickar det inte längre.

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

describe('createRun', () => {
  it('POST-bodyn har date, distance och is_treadmill — inget ursprungsfält', async () => {
    fetchMock.mockResolvedValue(json(201, { run: { id: 'r1' }, message: 'ok' }));

    const res = await backendApi.createRun('2026-10-11', 8.4, true);

    expect(res).toEqual({ success: true, data: { id: 'r1' }, message: 'ok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/runs')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ date: '2026-10-11', distance: 8.4, is_treadmill: true });
  });

  it('utan isTreadmill utelämnas is_treadmill (kolumnen förblir NULL)', async () => {
    fetchMock.mockResolvedValue(json(201, { run: { id: 'r2' } }));

    await backendApi.createRun('2026-10-11', 5);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ date: '2026-10-11', distance: 5 });
  });
});
