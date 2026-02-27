import { useState } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';

export const useCreateRun = (onSuccess?: () => void) => {
  const [loading, setLoading] = useState(false);

  const createRun = async (date: string, km: number) => {
    setLoading(true);
    try {
      const result = await backendApi.createRun(date, km, 'manual');

      if (!result.success) {
        throw new Error(result.error || 'Failed to create run');
      }

      const xpGained = result.data?.xp_gained || 0;
      const message = `Run logged! You gained ${xpGained} XP for this ${km}km run!`;
      toast.success(message);
      onSuccess?.();
      return { success: true, message };
    } catch (error) {
      log.error('Error saving run', error);
      toast.error(error instanceof Error ? error.message : 'Failed to log run. Please try again.');
      return { success: false, message: null };
    } finally {
      setLoading(false);
    }
  };

  return { createRun, loading };
};
