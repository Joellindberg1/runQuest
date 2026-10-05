import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

export const VIEW_PARAM = 'view';

/**
 * Delvyn som sökparameter `?view=` (ADR 006 beslut 3): delbar och back-vänlig utan en route per flik.
 * Okänt eller saknat värde faller tillbaka på `fallback`. Byte skriver med `replace` så att flikbyten
 * inte fyller historiken; övriga parametrar lämnas orörda. `param` byter parameternamn för filter som inte är
 * en delvy (Titles: `?filter=`). Router-state följer med (annars tappar Runner card sin
 * `background` vid ett flikbyte och desktop-overlayn blir en helsida).
 */
export function useViewParam<T extends string>(allowed: readonly T[], fallback: T, param: string = VIEW_PARAM): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const raw = params.get(param);
  const view = allowed.find((candidate) => candidate === raw) ?? fallback;

  const setView = useCallback(
    (next: T) => {
      setParams(
        (previous) => {
          const copy = new URLSearchParams(previous);
          copy.set(param, next);
          return copy;
        },
        { replace: true, state },
      );
    },
    [setParams, state, param],
  );

  return [view, setView];
}
