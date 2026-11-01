import { useEffect, useState, type RefObject } from 'react';

/** Subpixelmarginal: `scrollWidth` och `clientWidth` är avrundade heltal. */
const SCROLL_TOLERANCE_PX = 1;

/**
 * Om ytan faktiskt scrollar i sidled (innehållet är bredare än ytan), mätt vid montering och varje gång ytan eller dess innehåll byter storlek (kortet byter bredd, en dold yta visas).
 * `present` är om ytan finns i DOM:en just nu (kortet kan byta mellan en graf och en text). En yta som scrollar ska vara fokusbar så att tangentbordet når den; en som ryms ska inte vara ett tabbstopp.
 */
export function useScrollsSideways(ref: RefObject<HTMLElement | null>, present: boolean): boolean {
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const area = ref.current;
    if (!area || !present) return;
    const measure = () => setScrolls(area.scrollWidth - area.clientWidth > SCROLL_TOLERANCE_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    for (const child of Array.from(area.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, present]);

  return scrolls;
}
