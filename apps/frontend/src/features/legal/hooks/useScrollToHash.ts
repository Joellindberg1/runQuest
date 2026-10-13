import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * En SPA-sida får inte webbläsarens ankarhopp, eftersom ankaret inte finns när adressen läses. Efter rendering scrollar hooken till
 * elementet som `#hash` pekar ut; vid reducerad rörelse utan animation.
 */
export function useScrollToHash(): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Ett trasigt procentkodat ankare matchar inget id; då gör sökningen nedan ingenting.
    }
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [hash]);
}
