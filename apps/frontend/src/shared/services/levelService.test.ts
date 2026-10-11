import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_LEVEL_REQUIREMENTS, type LevelRequirement } from '@runquest/shared';

// RUN-111: nivåtabellen hämtas via GET /api/config/levels (inte supabase-js). Utloggad och vid fel gäller fallback-tabellen.
const api = vi.hoisted(() => ({
  token: null as string | null,
  getToken: vi.fn(() => api.token),
  authenticatedRequest: vi.fn(),
}));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/shared/utils/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn() } }));

import { FrontendLevelService } from './levelService';

// Annorlunda än fallback så att testet bevisar att backendens tabell används.
const SERVER_TABLE: LevelRequirement[] = [
  { level: 1, xp_required: 0 },
  { level: 2, xp_required: 100 },
  { level: 3, xp_required: 250 },
];
const ok = (data: unknown) => ({ success: true, data: { success: true, data } });

const fetchSpy = vi.fn();

beforeEach(() => {
  api.token = null;
  api.getToken.mockClear();
  api.authenticatedRequest.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

describe('FrontendLevelService — hämtning via backenden', () => {
  it('inloggad: anropar GET /config/levels via backendApi.authenticatedRequest och använder tabellen', async () => {
    api.token = 'jwt';
    api.authenticatedRequest.mockResolvedValue(ok(SERVER_TABLE));
    const service = new FrontendLevelService();

    await service.initialize();

    expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(api.authenticatedRequest).toHaveBeenCalledWith('/config/levels');
    expect(service.getXPForLevelSync(2)).toBe(100);
    expect(service.getLevelFromXPSync(260)).toBe(3);
  });

  it('sorterar tabellen stigande på level även om svaret kommer i fel ordning', async () => {
    api.token = 'jwt';
    api.authenticatedRequest.mockResolvedValue(ok([...SERVER_TABLE].reverse()));
    const service = new FrontendLevelService();

    const rows = await service.refresh();

    expect(rows.map((row) => row.level)).toEqual([1, 2, 3]);
    expect(service.getLevelFromXPSync(120)).toBe(2);
  });

  it('hämtar bara en gång: parallella och senare initialize delar ett anrop', async () => {
    api.token = 'jwt';
    api.authenticatedRequest.mockResolvedValue(ok(SERVER_TABLE));
    const service = new FrontendLevelService();

    await Promise.all([service.initialize(), service.initialize()]);
    await service.initialize();

    expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
  });

  it('async-metoderna väntar in tabellen', async () => {
    api.token = 'jwt';
    api.authenticatedRequest.mockResolvedValue(ok(SERVER_TABLE));
    const service = new FrontendLevelService();

    expect(await service.getLevelFromXP(260)).toBe(3);
    expect(await service.getXPForNextLevel(1)).toBe(100);
    expect((await service.getLevelProgress(100)).currentLevel).toBe(2);
  });
});

describe('FrontendLevelService — utloggad', () => {
  it('använder fallback-tabellen utan nätverksanrop', async () => {
    const service = new FrontendLevelService();

    await service.initialize();

    expect(api.authenticatedRequest).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(service.getXPForLevelSync(30)).toBe(16071);
    expect(service.getLevelFromXPSync(16071)).toBe(30);
  });

  it('refresh() kastar utan anrop (hooken är ändå avstängd utan användare)', async () => {
    const service = new FrontendLevelService();

    await expect(service.refresh()).rejects.toThrow();

    expect(api.authenticatedRequest).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hämtar först efter inloggning (utloggad initialize låser inte fallback för resten av sessionen)', async () => {
    const service = new FrontendLevelService();
    await service.initialize();
    expect(service.getXPForLevelSync(2)).toBe(50);

    api.token = 'jwt';
    api.authenticatedRequest.mockResolvedValue(ok(SERVER_TABLE));
    await service.initialize();

    expect(api.authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(service.getXPForLevelSync(2)).toBe(100);
  });
});

describe('FrontendLevelService — fel ger fallback', () => {
  const failures: Array<[string, () => void]> = [
    ['success:false', () => api.authenticatedRequest.mockResolvedValue({ success: false, error: 'Request failed' })],
    ['nätverksfel (reject)', () => api.authenticatedRequest.mockRejectedValue(new Error('offline'))],
    ['tom tabell', () => api.authenticatedRequest.mockResolvedValue(ok([]))],
    ['fel form på raderna', () => api.authenticatedRequest.mockResolvedValue(ok([{ level: '1', xp_required: 0 }]))],
    ['data saknas', () => api.authenticatedRequest.mockResolvedValue({ success: true })],
  ];

  it.each(failures)('%s -> fallback-tabellen, och nästa initialize försöker igen', async (_name, arrange) => {
    api.token = 'jwt';
    arrange();
    const service = new FrontendLevelService();

    await expect(service.initialize()).resolves.toBeUndefined();

    expect(service.getXPForLevelSync(2)).toBe(50);
    expect(service.getXPForLevelSync(30)).toBe(16071);
    expect(service.getLevelFromXPSync(16071)).toBe(30);

    api.authenticatedRequest.mockResolvedValue(ok(SERVER_TABLE));
    await service.initialize();
    expect(service.getXPForLevelSync(2)).toBe(100);
  });

  it('refresh() kastar vid fel och lämnar tabellen i bruk orörd (react-query ska kunna försöka igen)', async () => {
    api.token = 'jwt';
    api.authenticatedRequest.mockResolvedValue(ok(SERVER_TABLE));
    const service = new FrontendLevelService();
    await service.refresh();

    api.authenticatedRequest.mockResolvedValue({ success: false, error: 'boom' });
    await expect(service.refresh()).rejects.toThrow('boom');

    expect(service.getXPForLevelSync(2)).toBe(100);
  });
});

describe('FALLBACK_LEVEL_REQUIREMENTS — låst mot prod (verifierad 2026-10-11)', () => {
  // Hela prod-tabellen, ordagrant: ändras shareds fallback eller DB:n utan att den andra följer med ska det synas här.
  const PROD_XP = [
    0, 50, 102, 158, 217, 280, 349, 423, 504, 594,
    693, 806, 934, 1079, 1244, 1436, 1659, 1920, 2228, 2591,
    3026, 3549, 4181, 4953, 5902, 7089, 8584, 10482, 12912, 16071,
  ];

  it('30 nivåer, 1 … 30, med prod-värdena', () => {
    expect(FALLBACK_LEVEL_REQUIREMENTS).toHaveLength(30);
    expect(FALLBACK_LEVEL_REQUIREMENTS.map((row) => row.level)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(FALLBACK_LEVEL_REQUIREMENTS.map((row) => row.xp_required)).toEqual(PROD_XP);
  });

  it('spänner 0 … 16071 och är strikt stigande', () => {
    const xp = FALLBACK_LEVEL_REQUIREMENTS.map((row) => row.xp_required);
    expect(xp[0]).toBe(0);
    expect(xp[xp.length - 1]).toBe(16071);
    expect(xp.every((value, i) => i === 0 || value > xp[i - 1])).toBe(true);
  });

  it('levelService räknar mot exakt den tabellen utan inloggning (nivågränserna är oförändrade)', () => {
    const service = new FrontendLevelService();
    expect(service.getLevelFromXPSync(0)).toBe(1);
    expect(service.getLevelFromXPSync(49)).toBe(1);
    expect(service.getLevelFromXPSync(50)).toBe(2);
    expect(service.getLevelFromXPSync(16070)).toBe(29);
    expect(service.getLevelFromXPSync(16071)).toBe(30);
    expect(service.getLevelFromXPSync(1_000_000)).toBe(30);
  });
});
