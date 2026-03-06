import { useState, useEffect } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';
import { validatePassword } from '@/shared/utils/validation';
import type { User } from '@runquest/types';

export interface AdminSettings {
  xpPerRun: number;
  xpPerKm: number;
  bonus5km: number;
  bonus10km: number;
  bonus15km: number;
  bonus20km: number;
  minKmForRun: number;
  minKmForStreak: number;
  minRunDate: string;
  streakBonuses: { [key: number]: number };
  multipliers: { [key: number]: number };
}

const DEFAULT_SETTINGS: AdminSettings = {
  xpPerRun: 15,
  xpPerKm: 2,
  bonus5km: 5,
  bonus10km: 15,
  bonus15km: 25,
  bonus20km: 50,
  minKmForRun: 1.0,
  minKmForStreak: 1.0,
  minRunDate: '2025-06-01',
  streakBonuses: {
    10: 50, 30: 50, 60: 50, 90: 50, 120: 50, 150: 50,
    180: 50, 210: 50, 240: 50, 270: 50, 300: 50, 330: 50,
  },
  multipliers: {
    5: 1.1, 15: 1.2, 30: 1.3, 60: 1.4, 90: 1.5,
    120: 1.6, 180: 1.7, 220: 1.8, 240: 1.9, 270: 2.0,
  },
};

export function useAdminData() {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_SETTINGS);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newPasswordForUser, setNewPasswordForUser] = useState('');
  const [newMultiplierDay, setNewMultiplierDay] = useState('');
  const [newMultiplierValue, setNewMultiplierValue] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  useEffect(() => {
    fetchUsers();
    fetchAdminSettings();
  }, []);

  const fetchAdminSettings = async () => {
    try {
      const result = await backendApi.getAdminSettings();
      if (result.success && result.data) {
        setSettings(prev => ({
          ...prev,
          xpPerRun: result.data.base_xp || 15,
          xpPerKm: result.data.xp_per_km || 2,
          bonus5km: result.data.bonus_5km || 5,
          bonus10km: result.data.bonus_10km || 15,
          bonus15km: result.data.bonus_15km || 25,
          bonus20km: result.data.bonus_20km || 50,
          minKmForRun: result.data.min_run_distance || 1.0,
          minKmForStreak: result.data.min_run_distance || 1.0,
        }));

        const multipliersResult = await backendApi.getStreakMultipliers();
        if (multipliersResult.success && multipliersResult.data) {
          const multipliersObject: { [key: number]: number } = {};
          multipliersResult.data.forEach((mult) => {
            multipliersObject[mult.days] = mult.multiplier;
          });
          setSettings(prev => ({ ...prev, multipliers: multipliersObject }));
        }
      } else {
        log.error('Failed to fetch admin settings', result.error);
        toast.error('Failed to fetch admin settings: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      log.error('Error fetching admin settings', error);
      toast.error('Failed to fetch admin settings');
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const result = await backendApi.getAllUsers();
      if (result.success && result.data) {
        setUsers(result.data as User[]);
      } else {
        log.error('Failed to fetch users', result.error);
        toast.error('Failed to fetch users: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      log.error('Error fetching users', error);
      toast.error('Failed to fetch users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSaveSettings = async () => {
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

      toast.success('Settings saved successfully to database!');
    } catch (error) {
      log.error('Error saving settings', error);
      toast.error('Failed to save settings: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      toast.error('Please fill in all fields');
      return;
    }
    const pwError = validatePassword(newUser.password);
    if (pwError) {
      toast.error(pwError);
      return;
    }
    try {
      const result = await backendApi.createUser(newUser.name, newUser.email, newUser.password);
      if (result.success && result.data) {
        setUsers(prev => [...prev, result.data as User]);
        setNewUser({ name: '', email: '', password: '' });
        toast.success('User created successfully!');
      } else {
        toast.error(result.error || 'Failed to create user');
      }
    } catch (error) {
      log.error('Error creating user', error);
      toast.error('Failed to create user');
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    const pwError = validatePassword(newPasswordForUser || '');
    if (!newPasswordForUser || pwError) {
      toast.error(pwError || 'Password is required');
      return;
    }
    try {
      const result = await backendApi.resetUserPassword(userId, newPasswordForUser);
      if (result.success) {
        setEditingUser(null);
        setNewPasswordForUser('');
        toast.success('Password reset successfully!');
      } else {
        toast.error(result.error || 'Failed to reset password');
      }
    } catch (error) {
      log.error('Error resetting user password', error);
      toast.error('Failed to reset password');
    }
  };

  const handleAddMultiplier = () => {
    const day = parseInt(newMultiplierDay);
    const value = parseFloat(newMultiplierValue);
    if (day && value) {
      setSettings(prev => ({
        ...prev,
        multipliers: { ...prev.multipliers, [day]: value },
      }));
      setNewMultiplierDay('');
      setNewMultiplierValue('');
      toast.success(`Added ${day} days → ${value}x multiplier. Remember to save settings!`);
    }
  };

  const handleChangeAdminPassword = () => {
    if (newAdminPassword.trim()) {
      setNewAdminPassword('');
      toast.info('Admin password change not yet wired to backend');
    }
  };

  return {
    settings,
    setSettings,
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
