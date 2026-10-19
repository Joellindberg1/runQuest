import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  getStreakMultipliers: vi.fn(),
  getAllUsers: vi.fn(),
  updateAdminSettings: vi.fn(),
  updateStreakMultipliers: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { useAdminData } from './useAdminData';

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const SETTINGS = { base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getAllUsers.mockResolvedValue({ success: true, data: [] });
  api.getAdminSettings.mockResolvedValue({ success: true, data: SETTINGS });
  api.updateAdminSettings.mockResolvedValue({ success: true });
  api.updateStreakMultipliers.mockResolvedValue({ success: true });
});

describe('useAdminData — Save får aldrig skriva över prod-trappan med standardvärden', () => {
  it('Save är upplåst först när både inställningarna och trappan lästs in', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [{ days: 5, multiplier: 1.1 }] });
    const { result } = renderHook(() => useAdminData(), { wrapper });
    expect(result.current.settingsLoaded).toBe(false);
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));

    await act(() => result.current.handleSaveSettings());
    expect(api.updateStreakMultipliers).toHaveBeenCalledWith([{ days: 5, multiplier: 1.1 }]);
  });

  it('misslyckas trappan att läsas in förblir Save låst och ingenting skickas', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(api.getStreakMultipliers).toHaveBeenCalled());
    expect(result.current.settingsLoaded).toBe(false);

    await act(() => result.current.handleSaveSettings());
    expect(api.updateAdminSettings).not.toHaveBeenCalled();
    expect(api.updateStreakMultipliers).not.toHaveBeenCalled();
  });

  it('misslyckas inställningarna att läsas in förblir Save låst', async () => {
    api.getAdminSettings.mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(api.getAdminSettings).toHaveBeenCalled());
    expect(result.current.settingsLoaded).toBe(false);
    await act(() => result.current.handleSaveSettings());
    expect(api.updateStreakMultipliers).not.toHaveBeenCalled();
  });
});
describe('useAdminData — inläsning och spärr före Save', () => {
  it('ett sparat 0 läses in som 0, inte som standardvärdet (?? i stället för ||)', async () => {
    api.getAdminSettings.mockResolvedValue({ success: true, data: { ...SETTINGS, bonus_5km: 0, bonus_10km: 0, xp_per_km: 0 } });
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [{ days: 5, multiplier: 1.1 }] });
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
    expect(result.current.settings).toMatchObject({ bonus5km: 0, bonus10km: 0, xpPerKm: 0 });
    // …och bonus_15km som INTE är 0 behålls
    expect(result.current.settings.bonus15km).toBe(25);
  });

  it('saknade fält (null/undefined) faller tillbaka på standardvärdet', async () => {
    api.getAdminSettings.mockResolvedValue({ success: true, data: { ...SETTINGS, bonus_20km: null, base_xp: undefined } });
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [{ days: 5, multiplier: 1.1 }] });
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));
    expect(result.current.settings).toMatchObject({ bonus20km: 50, xpPerRun: 15 });
  });

  it('en ogiltig trappa (utanför 1–9.99) skickar ingenting — varken inställningarna eller trappan', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [{ days: 5, multiplier: 12.5 }] });
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));

    await act(() => result.current.handleSaveSettings());
    expect(api.updateAdminSettings).not.toHaveBeenCalled();
    expect(api.updateStreakMultipliers).not.toHaveBeenCalled();
    expect(result.current.notices.settings?.error).toMatch(/must be between 1 and 9.99/);
  });
});

describe('useAdminData — ett nytt konto syns på Board direkt', () => {
  const fill = async (result: { current: ReturnType<typeof useAdminData> }) => {
    act(() => result.current.setNewUser({ name: 'Nina Ny', email: 'nina@wolfpack.se', password: 'Lösenord1!' }));
    await act(() => result.current.handleAddUser());
  };

  it('invaliderar gruppens users-with-runs när kontot skapats, så Board inte visar listan från före', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [] });
    api.createUser.mockResolvedValue({ success: true, data: { id: 'u-new', name: 'Nina Ny' } });
    queryClient.setQueryData(USERS_WITH_RUNS_QUERY_KEY, [{ id: 'u-old' }]);
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(result.current.loadingUsers).toBe(false));
    expect(queryClient.getQueryState(USERS_WITH_RUNS_QUERY_KEY)?.isInvalidated).toBe(false);

    await fill(result);

    expect(api.createUser).toHaveBeenCalledWith('Nina Ny', 'nina@wolfpack.se', 'Lösenord1!');
    expect(queryClient.getQueryState(USERS_WITH_RUNS_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it('lämnar users-with-runs orörd när kontot inte kunde skapas', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [] });
    api.createUser.mockResolvedValue({ success: false, error: 'Email already in use' });
    queryClient.setQueryData(USERS_WITH_RUNS_QUERY_KEY, [{ id: 'u-old' }]);
    const { result } = renderHook(() => useAdminData(), { wrapper });
    await waitFor(() => expect(result.current.loadingUsers).toBe(false));

    await fill(result);

    expect(result.current.notices.users?.error).toBe('Email already in use');
    expect(queryClient.getQueryState(USERS_WITH_RUNS_QUERY_KEY)?.isInvalidated).toBe(false);
  });
});
