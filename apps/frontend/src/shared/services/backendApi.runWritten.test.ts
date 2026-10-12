import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from './backendApi';

// Servern svarar 500 med `written: true` när raden skrevs men XP-omräkningen föll. Klienten ska föra signalen vidare
// (så att hookarna vet att cachen är inaktuell) — och bara då: ett vanligt fel lämnas som förut.

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

describe('run-skrivningar där servern skrev men omräkningen föll', () => {
  it.each([
    ['createRun', () => backendApi.createRun('2026-10-11', 8), 'Run was created but XP recalculation failed'],
    ['updateRun', () => backendApi.updateRun('r1', { distance: 9 }), 'Run was updated but XP recalculation failed'],
    ['deleteRun', () => backendApi.deleteRun('r1'), 'Run was deleted but XP recalculation failed'],
  ])('%s för vidare written: true tillsammans med serverns text', async (_name, call, error) => {
    fetchMock.mockResolvedValue(json(500, { error, written: true }));
    expect(await call()).toEqual({ success: false, error, written: true });
  });

  it.each([
    ['createRun', () => backendApi.createRun('2026-10-11', 8)],
    ['updateRun', () => backendApi.updateRun('r1', { distance: 9 })],
    ['deleteRun', () => backendApi.deleteRun('r1')],
  ])('%s: ett 500 utan written är ett vanligt fel', async (_name, call) => {
    fetchMock.mockResolvedValue(json(500, { error: 'Internal server error' }));
    expect(await call()).toEqual({ success: false, error: 'Internal server error' });
  });
});
