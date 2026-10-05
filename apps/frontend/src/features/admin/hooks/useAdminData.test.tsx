import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAdminSettings: vi.fn(),
  getStreakMultipliers: vi.fn(),
  getAllUsers: vi.fn(),
  updateAdminSettings: vi.fn(),
  updateStreakMultipliers: vi.fn(),
}));
vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { useAdminData } from './useAdminData';

const SETTINGS = { base_xp: 15, xp_per_km: 2, bonus_5km: 5, bonus_10km: 15, bonus_15km: 25, bonus_20km: 50, min_run_distance: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getAllUsers.mockResolvedValue({ success: true, data: [] });
  api.getAdminSettings.mockResolvedValue({ success: true, data: SETTINGS });
  api.updateAdminSettings.mockResolvedValue({ success: true });
  api.updateStreakMultipliers.mockResolvedValue({ success: true });
});

describe('useAdminData — Save får aldrig skriva över prod-trappan med standardvärden', () => {
  it('Save är upplåst först när både inställningarna och trappan lästs in', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: true, data: [{ days: 5, multiplier: 1.1 }] });
    const { result } = renderHook(() => useAdminData());
    expect(result.current.settingsLoaded).toBe(false);
    await waitFor(() => expect(result.current.settingsLoaded).toBe(true));

    await act(() => result.current.handleSaveSettings());
    expect(api.updateStreakMultipliers).toHaveBeenCalledWith([{ days: 5, multiplier: 1.1 }]);
  });

  it('misslyckas trappan att läsas in förblir Save låst och ingenting skickas', async () => {
    api.getStreakMultipliers.mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(api.getStreakMultipliers).toHaveBeenCalled());
    expect(result.current.settingsLoaded).toBe(false);

    await act(() => result.current.handleSaveSettings());
    expect(api.updateAdminSettings).not.toHaveBeenCalled();
    expect(api.updateStreakMultipliers).not.toHaveBeenCalled();
  });

  it('misslyckas inställningarna att läsas in förblir Save låst', async () => {
    api.getAdminSettings.mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => useAdminData());
    await waitFor(() => expect(api.getAdminSettings).toHaveBeenCalled());
    expect(result.current.settingsLoaded).toBe(false);
    await act(() => result.current.handleSaveSettings());
    expect(api.updateStreakMultipliers).not.toHaveBeenCalled();
  });
});
