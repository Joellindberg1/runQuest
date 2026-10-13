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

describe('createRun — Idempotency-Key', () => {
  const KEY = '3f2b8c1e-5d4a-4b7e-9c3a-1a2b3c4d5e6f';

  it('skickar headern Idempotency-Key när en nyckel ges, och rör inte bodyn', async () => {
    fetchMock.mockResolvedValue(json(200, { run: { id: 'r3' } }));

    await backendApi.createRun('2026-10-11', 8.4, false, KEY);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Idempotency-Key']).toBe(KEY);
    expect(init.headers['Authorization']).toBe('Bearer tok-123');
    expect(JSON.parse(init.body)).toEqual({ date: '2026-10-11', distance: 8.4, is_treadmill: false });
  });

  it('utan nyckel finns ingen Idempotency-Key-header (dagens anrop oförändrat)', async () => {
    fetchMock.mockResolvedValue(json(200, { run: { id: 'r4' } }));

    await backendApi.createRun('2026-10-11', 8.4, false);

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
  });

  it('bara createRun skickar headern: updateRun och deleteRun gör det inte', async () => {
    fetchMock.mockResolvedValue(json(200, { run: { id: 'r5' } }));

    await backendApi.updateRun('r5', { distance: 5, date: '2026-10-11' });
    await backendApi.deleteRun('r5');

    expect(fetchMock.mock.calls).toHaveLength(2);
    for (const [, init] of fetchMock.mock.calls) expect(init.headers).not.toHaveProperty('Idempotency-Key');
  });
});
