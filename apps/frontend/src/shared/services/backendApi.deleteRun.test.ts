import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// DELETE /runs/:id svarar 409 med klartext när rundan kvalificerade ett event (ADR 008 addendum 5):
// klienten ska lämna serverns text vidare orörd, så att redigeringsrutan kan visa den.

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

describe('deleteRun', () => {
  it('409: serverns klartext kommer tillbaka som error (inte ett generiskt "Failed to delete run")', async () => {
    const message = "This run qualified an event and can't be deleted — edit it instead";
    fetchMock.mockResolvedValue(json(409, { error: message }));

    expect(await backendApi.deleteRun('r1')).toEqual({ success: false, error: message });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/runs/r1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });

  it('lyckad radering: success utan fel', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, message: 'Run deleted successfully' }));
    expect(await backendApi.deleteRun('r1')).toEqual({ success: true, message: 'Run deleted successfully' });
  });
});
