import { useEffect, useState, type RefObject } from 'react';

/** Subpixelmarginal: `scrollHeight` och `clientHeight` är avrundade heltal. */
const SCROLL_TOLERANCE_PX = 1;

/**
 * Om ytan faktiskt scrollar i höjdled (innehållet är högre än ytan), mätt vid montering, varje gång ytan eller dess innehåll byter storlek och när `content` byter värde
 * (ett filter som byter vad ytan rymmer ändrar höjden utan att ytan själv byter storlek). En yta som scrollar ska vara fokusbar så att tangentbordet når den; en som
 * ryms ska inte vara ett tabbstopp.
 */
export function useScrollsVertically(ref: RefObject<HTMLElement | null>, content: unknown): boolean {
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const area = ref.current;
    if (!area) return undefined;
    const measure = () => setScrolls(area.scrollHeight - area.clientHeight > SCROLL_TOLERANCE_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    for (const child of Array.from(area.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, content]);

  return scrolls;
}
