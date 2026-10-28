import { useEffect, useState, type RefObject } from 'react';
import { revealDelta } from '@/shared/components/tabReveal';
import { fadeClearance, scrollEdges, type ScrollEdges } from '../tabRowFade';

const NO_EDGES: ScrollEdges = { start: false, end: false };

/**
 * Kantfaden på en flikrad (`[role="tablist"]` inuti `wrapRef`) som scrollar i sidled: vilka kanter som har mer innehåll bortom sig, mätt vid montering, vid scroll och när raden byter
 * storlek. Efter ett flikbyte (`ViewTabs` har då fört den valda fliken i bild) flyttas raden precis så mycket att fliken också ligger utanför fadens zon, annars tonas dess text ut.
 * Zonens bredd läses ur radens `scroll-padding-inline` i CSS (samma token som toningen), så måttet bor på ett ställe.
 */
export function useTabRowFade(wrapRef: RefObject<HTMLElement | null>, selected: string): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

  useEffect(() => {
    const list = wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) return;
    const measure = () => {
      const next = scrollEdges(list);
      setEdges((previous) => (previous.start === next.start && previous.end === next.end ? previous : next));
    };
    measure();
    list.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      list.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [wrapRef]);

  useEffect(() => {
    const list = wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const clearance = parseFloat(getComputedStyle(list).scrollPaddingLeft);
    const row = list.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    // Rymmer inte ens fliken i raden är det revealDelta som bestämmer (vänsterkant mot vänsterkant); då finns ingen zon att hålla.
    if (revealDelta(row, box) !== 0) return;
    const delta = fadeClearance(row, box, clearance, scrollEdges(list));
    if (delta !== 0) list.scrollLeft += delta;
  }, [wrapRef, selected]);

  return edges;
}
