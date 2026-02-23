import { useCallback } from 'react';
import { toast } from 'sonner';

export function useRunUpdates(refresh: () => Promise<void>) {
  const onRunUpdated = useCallback(async () => {
    await refresh();
    toast.success('Data refreshed!');
  }, [refresh]);

  return { onRunUpdated };
}
