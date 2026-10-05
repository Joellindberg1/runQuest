import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Run } from '@runquest/types';
import { backendApi } from '@/shared/services/backendApi';
import { invalidateAfterRunChange } from '@/features/runs/runEffects';
import type { RunUpdate } from '../profileModel';

interface UpdateRunArgs {
  run: Run;
  update: RunUpdate;
}

/**
 * Ändra datum/distans på en av mina rundor (PUT /runs/:id). Servern räknar om streak och XP från den tidigaste av gamla och
 * nya datumet, så efter ändringen invalideras SAMMA kedja som efter POST (`invalidateAfterRunChange`). Mutationen kastar
 * serverns meddelande — rutan visar det (statusregion i stället för toast). Svaret är rundan efter omräkningen; saknas den
 * (servern kunde inte läsa tillbaka) faller bekräftelsen tillbaka på det som skickades.
 */
export function useUpdateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ run, update }: UpdateRunArgs): Promise<Run> => {
      const res = await backendApi.updateRun(run.id, update);
      if (!res.success) throw new Error(res.error || 'Failed to update the run');
      return res.data ? { ...run, ...res.data } : { ...run, ...update };
    },
    onSuccess: () => invalidateAfterRunChange(queryClient),
  });
}

/** Radera en av mina rundor (DELETE /runs/:id). Samma invalideringskedja som POST/PUT. */
export function useDeleteRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (run: Run): Promise<Run> => {
      const res = await backendApi.deleteRun(run.id);
      if (!res.success) throw new Error(res.error || 'Failed to delete the run');
      return run;
    },
    onSuccess: () => invalidateAfterRunChange(queryClient),
  });
}
