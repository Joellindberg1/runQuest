import { useLayoutEffect, useState } from 'react';

/**
 * Bredden i px på ett element, mätt när det monteras (före första ritningen) och varje gång det byter storlek. 0 tills det finns ett element med en bredd: en dold yta (bredd 0) är ingen
 * mätning, så den senaste riktiga bredden står kvar medan ytan är dold. Elementet är ett tillstånd (callback-ref), så en yta som monteras senare mäts också.
 */
export function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return width;
}
