import { useEffect, useState } from 'react';

// Brytpunkt 1024 px = Tailwind `lg` (ADR 006 beslut 5).
export const DESKTOP_MIN_WIDTH = 1024;
const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function read(): boolean | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * `undefined` tills matchMedia har lästs — anroparen renderar då inget i stället för att gissa
 * (ADR 006 risk 6). I webbläsaren läses värdet synkront vid första renderingen.
 */
export function useIsDesktop(): boolean | undefined {
  const [isDesktop, setIsDesktop] = useState<boolean | undefined>(read);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
