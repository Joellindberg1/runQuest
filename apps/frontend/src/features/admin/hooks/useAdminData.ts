import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_ADMIN_SETTINGS, DEFAULT_STREAK_MULTIPLIERS, MIN_RUN_DATE } from '@runquest/shared';
import type { AdminUser } from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';
import { USERS_WITH_RUNS_QUERY_KEY } from '@/shared/hooks/useUsersWithRuns';
import { log } from '@/shared/utils/logger';
import { validatePassword } from '@/shared/utils/validation';
import { findSettingsProblem } from '../adminModel';

/**
 * Formulärets tillstånd (camelCase, ett fält per inmatningsruta, multiplikatorerna som karta days -> värde). Inte svarsformen: den är `AdminSettingsRow`
 * och `StreakMultipliersResponse` i @runquest/shared; fetchAdminSettings flyttar över värdena och handleSaveSettings bygger requesten ur dem.
 */
export interface AdminSettingsForm {
  xpPerRun: number;
  xpPerKm: number;
  bonus5km: number;
  bonus10km: number;
  bonus15km: number;
  bonus20km: number;
  minKmForRun: number;
  minRunDate: string;
  multipliers: { [key: number]: number };
}

// Fälten visas bara tills läsningen lyckats (Save är låst innan); värdena är shared:s standardvärden, inga egna kopior.
const DEFAULT_SETTINGS: AdminSettingsForm = {
  xpPerRun: DEFAULT_ADMIN_SETTINGS.base_xp,
  xpPerKm: DEFAULT_ADMIN_SETTINGS.xp_per_km,
  bonus5km: DEFAULT_ADMIN_SETTINGS.bonus_5km,
  bonus10km: DEFAULT_ADMIN_SETTINGS.bonus_10km,
  bonus15km: DEFAULT_ADMIN_SETTINGS.bonus_15km,
  bonus20km: DEFAULT_ADMIN_SETTINGS.bonus_20km,
  minKmForRun: DEFAULT_ADMIN_SETTINGS.min_run_distance,
  minRunDate: MIN_RUN_DATE,
  multipliers: Object.fromEntries(DEFAULT_STREAK_MULTIPLIERS.map(({ days, multiplier }) => [days, multiplier])),
};

/** Bekräftelser och fel per skärmdel — visas i permanenta live-regioner (status/alert), inte som toasts. */
export type AdminSection = 'settings' | 'users' | 'security';
export interface AdminNotice {
  status?: string;
  error?: string;
}
export type AdminNotices = Partial<Record<AdminSection, AdminNotice>>;

export function useAdminData() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AdminSettingsForm>(DEFAULT_SETTINGS);
  // Save skickar hela trappan och servern tar bort steg som saknas — sparas DEFAULT_SETTINGS
  // (inläsningen misslyckades) skulle prod-trappan skrivas över. Därför låst tills båda läsningarna lyckats.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Läsfel visas som felkort med Retry: fält som visar standardvärden i stället för de riktiga vore en lögn.
  const [settingsError, setSettingsError] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [notices, setNotices] = useState<AdminNotices>({});
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [newPasswordForUser, setNewPasswordForUser] = useState('');
  const [newMultiplierDay, setNewMultiplierDay] = useState('');
  const [newMultiplierValue, setNewMultiplierValue] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const notify = useCallback((section: AdminSection, notice: AdminNotice | null) => {
    setNotices((previous) => ({ ...previous, [section]: notice ?? undefined }));
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchAdminSettings();
  }, []);

  const fetchAdminSettings = async () => {
    setSettingsError(false);
    try {
      const result = await backendApi.getAdminSettings();
      if (result.success && result.data) {
        const data = result.data;
        setSettings(prev => ({
          ...prev,
          xpPerRun: data.base_xp ?? DEFAULT_ADMIN_SETTINGS.base_xp,
          xpPerKm: data.xp_per_km ?? DEFAULT_ADMIN_SETTINGS.xp_per_km,
          bonus5km: data.bonus_5km ?? DEFAULT_ADMIN_SETTINGS.bonus_5km,
          bonus10km: data.bonus_10km ?? DEFAULT_ADMIN_SETTINGS.bonus_10km,
          bonus15km: data.bonus_15km ?? DEFAULT_ADMIN_SETTINGS.bonus_15km,
          bonus20km: data.bonus_20km ?? DEFAULT_ADMIN_SETTINGS.bonus_20km,
          minKmForRun: data.min_run_distance ?? DEFAULT_ADMIN_SETTINGS.min_run_distance,
        }));

        const multipliersResult = await backendApi.getStreakMultipliers();
        if (multipliersResult.success && multipliersResult.data) {
          const multipliersObject: { [key: number]: number } = {};
          multipliersResult.data.forEach((mult) => {
            multipliersObject[mult.days] = mult.multiplier;
          });
          setSettings(prev => ({ ...prev, multipliers: multipliersObject }));
          setSettingsLoaded(true);
        } else {
          log.error('Failed to fetch streak multipliers', multipliersResult.error);
          setSettingsError(true);
        }
      } else {
        log.error('Failed to fetch admin settings', result.error);
        setSettingsError(true);
      }
    } catch (error) {
      log.error('Error fetching admin settings', error);
      setSettingsError(true);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    setUsersError(false);
    try {
      const result = await backendApi.getAllUsers();
      if (result.success && result.data) {
        setUsers(result.data);
      } else {
        log.error('Failed to fetch users', result.error);
        setUsersError(true);
      }
    } catch (error) {
      log.error('Error fetching users', error);
      setUsersError(true);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSaveSettings = async () => {
    notify('settings', null);
    if (!settingsLoaded) {
      notify('settings', { error: 'Settings have not loaded from the server — reload the page before saving' });
      return;
    }
    const problem = findSettingsProblem(settings);
    if (problem) {
      notify('settings', { error: problem });
      return;
    }
    try {
      const basicSettingsResult = await backendApi.updateAdminSettings({
        base_xp: settings.xpPerRun,
        xp_per_km: settings.xpPerKm,
        bonus_5km: settings.bonus5km,
        bonus_10km: settings.bonus10km,
        bonus_15km: settings.bonus15km,
        bonus_20km: settings.bonus20km,
        min_run_distance: settings.minKmForRun,
      });
      if (!basicSettingsResult.success) {
        throw new Error(basicSettingsResult.error || 'Failed to save basic settings');
      }

      const multipliersArray = Object.entries(settings.multipliers).map(([days, multiplier]) => ({
        days: parseInt(days),
        multiplier: parseFloat(multiplier.toString()),
      }));
      const multipliersResult = await backendApi.updateStreakMultipliers(multipliersArray);
      if (!multipliersResult.success) {
        throw new Error(multipliersResult.error || 'Failed to save streak multipliers');
      }

      notify('settings', { status: 'Settings saved. They apply to every run from now on.' });
    } catch (error) {
      log.error('Error saving settings', error);
      notify('settings', { error: 'Failed to save settings: ' + (error instanceof Error ? error.message : 'Unknown error') });
    }
  };

  const handleAddUser = async () => {
    notify('users', null);
    if (!newUser.name || !newUser.email || !newUser.password) {
      notify('users', { error: 'Please fill in all fields' });
      return;
    }
    const pwError = validatePassword(newUser.password);
    if (pwError) {
      notify('users', { error: pwError });
      return;
    }
    try {
      const result = await backendApi.createUser(newUser.name, newUser.email, newUser.password);
      if (result.success && result.data) {
        // Servern svarar med sju kolumner (CreatedUser); ett nytt konto har ännu inga rundor, ingen sträcka och ingen streak att visa.
        const created: AdminUser = { ...result.data, total_km: 0, longest_streak: 0, total_runs: 0 };
        setUsers(prev => [...prev, created]);
        // Board läser gruppen ur users-with-runs (staleTime 10 s): utan invalidering visar den listan från före kontot.
        void queryClient.invalidateQueries({ queryKey: USERS_WITH_RUNS_QUERY_KEY });
        setNewUser({ name: '', email: '', password: '' });
        notify('users', { status: 'Member added.' });
      } else {
        notify('users', { error: result.error || 'Failed to create user' });
      }
    } catch (error) {
      log.error('Error creating user', error);
      notify('users', { error: 'Failed to create user' });
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    notify('users', null);
    const pwError = validatePassword(newPasswordForUser || '');
    if (!newPasswordForUser || pwError) {
      notify('users', { error: pwError || 'Password is required' });
      return;
    }
    try {
      const result = await backendApi.resetUserPassword(userId, newPasswordForUser);
      if (result.success) {
        setEditingUser(null);
        setNewPasswordForUser('');
        notify('users', { status: 'Password reset.' });
      } else {
        notify('users', { error: result.error || 'Failed to reset password' });
      }
    } catch (error) {
      log.error('Error resetting user password', error);
      notify('users', { error: 'Failed to reset password' });
    }
  };

  const handleAddMultiplier = () => {
    notify('settings', null);
    const day = parseInt(newMultiplierDay);
    const value = parseFloat(newMultiplierValue);
    if (!day || !value) {
      notify('settings', { error: 'Enter both the number of days and a multiplier' });
      return;
    }
    setSettings(prev => ({
      ...prev,
      multipliers: { ...prev.multipliers, [day]: value },
    }));
    setNewMultiplierDay('');
    setNewMultiplierValue('');
    notify('settings', { status: `Added ${day} days at ${value}×. Nothing is stored until you save all settings.` });
  };

  const handleChangeAdminPassword = () => {
    notify('security', null);
    if (newAdminPassword.trim()) {
      setNewAdminPassword('');
      notify('security', { status: 'Changing the admin password is not connected to the backend yet — nothing was changed.' });
    }
  };

  return {
    settings,
    setSettings,
    settingsLoaded,
    settingsError,
    reloadSettings: fetchAdminSettings,
    usersError,
    notices,
    users,
    loadingUsers,
    fetchUsers,
    newUser,
    setNewUser,
    editingUser,
    setEditingUser,
    newPasswordForUser,
    setNewPasswordForUser,
    newMultiplierDay,
    setNewMultiplierDay,
    newMultiplierValue,
    setNewMultiplierValue,
    newAdminPassword,
    setNewAdminPassword,
    handleSaveSettings,
    handleAddUser,
    handleResetUserPassword,
    handleAddMultiplier,
    handleChangeAdminPassword,
  };
}
