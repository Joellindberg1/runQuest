import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ReadGestureContext } from '../hooks/useRowReadGestures';
import { useMarkNewsRead } from '../hooks/useNewsQueries';
import { POINTER_SETTLE_MS } from '../newsModel';

/**
 * Omger EN lista med rader och ger dem läs-gesterna (se useRowReadGestures): en `markRead` per lista (nätverksanropen buntas och töms när
 * listan avmonteras) och rörelsevakten, som räknas från att listan monterades. Monteras av dag-listan på /news och av popovern runt dess lista,
 * så att en öppnad popover alltid får ett nytt fönster.
 */
export function ReadGestureScope({ children }: { children: ReactNode }) {
  const { markRead } = useMarkNewsRead();
  const mountedAt = useRef<number | null>(null);

  useEffect(() => {
    mountedAt.current = Date.now();
    return () => {
      mountedAt.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({
      markRead,
      isSettled: () => mountedAt.current !== null && Date.now() - mountedAt.current >= POINTER_SETTLE_MS,
    }),
    [markRead],
  );

  return <ReadGestureContext.Provider value={value}>{children}</ReadGestureContext.Provider>;
}
