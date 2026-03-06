import { useState } from 'react';
import { backendApi } from '@/shared/services/backendApi';
import { toast } from 'sonner';
import { log } from '@/shared/utils/logger';
import type { Run } from '@runquest/types';

export const useRunMutations = (onSuccess: () => void) => {
  const [isLoading, setIsLoading] = useState(false);

  const updateRun = async (run: Run, distance: number, date: string) => {
    setIsLoading(true);
    try {
      const result = await backendApi.updateRun(run.id, { distance, date });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update run');
      }

      if (result.data?.xp_gained) {
        toast.success(`Run updated! New XP: ${result.data.xp_gained} (Streak: ${result.data.streak_day}, Multiplier: ${result.data.multiplier.toFixed(1)}x)`);
      } else {
        toast.success('Run updated successfully - refreshing data...');
      }

      onSuccess();
      return true;
    } catch (error) {
      log.error('Error updating run', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update run');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const deleteRun = async (run: Run) => {
    setIsLoading(true);
    try {
      const result = await backendApi.deleteRun(run.id);

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete run');
      }

      toast.success('Run deleted successfully');
      onSuccess();
      return true;
    } catch (error) {
      log.error('Error deleting run', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete run');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { updateRun, deleteRun, isLoading };
};
