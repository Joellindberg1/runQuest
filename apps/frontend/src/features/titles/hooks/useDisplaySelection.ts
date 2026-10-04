import { useState } from 'react';
import { cleanSelection, sameSelection, toggleDisplayed } from '../titlesModel';
import { useSaveDisplayedTitles } from './useTitlesQueries';

export type SaveStatus = 'idle' | 'saved' | 'error';

/**
 * Valet av titlar som visas på leaderboarden (max 3). `savedIds` är det som ligger på servern; ett utkast ligger
 * lokalt tills det sparas. Förlorade titlar städas bort ur valet så en titel jag tappat aldrig räknas som vald.
 */
export function useDisplaySelection(savedIds: readonly string[], heldIds: readonly string[]) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const mutation = useSaveDisplayedTitles();

  const saved = cleanSelection(savedIds, heldIds);
  const selected = cleanSelection(draft ?? savedIds, heldIds);
  const dirty = !sameSelection(selected, saved);

  const toggle = (titleId: string) => {
    setDraft(toggleDisplayed(selected, heldIds, titleId));
    setStatus('idle');
  };

  const save = async () => {
    try {
      // mutateAsync väntar in onSuccess (omhämtningen av användarna), så utkastet släpps först när det sparade valet syns.
      await mutation.mutateAsync(selected);
      setDraft(null);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return { selected, dirty, toggle, save, saving: mutation.isPending, status };
}
