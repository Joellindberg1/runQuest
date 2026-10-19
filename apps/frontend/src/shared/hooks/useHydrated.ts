import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * Falskt på servern och i klientens första (hydrerande) rendering, sant därefter. Under hydrering läser React serverns ögonblicksbild och renderar sedan om med
 * klientens, så den första klientrenderingen matchar serverns markup utan att ett effekt-flaggat tillstånd behöver målas först. En ren klientrendering (ingen
 * server-HTML) får sant direkt. Används för det som ska vara avstängt tills komponenten monterats.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
