import { useEffect, useState, type RefObject } from 'react';
import { revealDelta } from '@/shared/components/tabReveal';
import { fadeClearance, scrollEdges, SUBPIXEL_TOLERANCE_PX, type ScrollEdges } from '@/shared/components/tabRowFade';

const NO_EDGES: ScrollEdges = { start: false, end: false };

/**
 * Kantfaden på en flikrad (`[role="tablist"]` inuti `wrapRef`) som scrollar i sidled: vilka kanter som har mer innehåll bortom sig, mätt vid montering, vid scroll och när raden byter
 * storlek eller en flik gör det, och när typsnitten laddat. Efter ett flikbyte (`ViewTabs` har då fört den valda fliken i bild) flyttas raden precis så mycket att fliken också ligger utanför fadens zon, annars tonas dess text ut.
 * `tabCount` mäter om raden när en flik tillkommer eller försvinner (storleken på raden ändras då inte, bara det den scrollar över). Zonens bredd läses ur radens `scroll-padding-inline` i CSS (samma token som toningen), så måttet bor på ett ställe.
 */
export function useTabRowFade(wrapRef: RefObject<HTMLElement | null>, selected: string, tabCount: number): ScrollEdges {
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
    // Raden själv ändrar inte storlek när innehållet gör det (ett typsnitt som laddar krymper flikarna, men radens box är densamma), så flikarna bevakas också.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const tab of Array.from(list.children)) observer.observe(tab);
    // Typsnittet kan komma efter första mätningen (reservtypsnittet är bredare): mät om när det laddat, och när ytterligare en face blir klar.
    let active = true;
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    void fonts?.ready.then(() => {
      if (active) measure();
    });
    fonts?.addEventListener('loadingdone', measure);
    return () => {
      active = false;
      list.removeEventListener('scroll', measure);
      fonts?.removeEventListener('loadingdone', measure);
      observer.disconnect();
    };
  }, [wrapRef, tabCount]);

  useEffect(() => {
    const list = wrapRef.current?.querySelector<HTMLElement>('[role="tablist"]');
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const clearance = parseFloat(getComputedStyle(list).scrollPaddingLeft);
    const row = list.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    // Rymmer inte ens fliken i raden är det revealDelta som bestämmer (vänsterkant mot vänsterkant); då finns ingen zon att hålla. En rest under en pixel räknas inte: `scrollLeft` är ett heltal,
    // så fliken som `ViewTabs` just förde i bild kan ligga en bråkdel utanför kanten, och den resten får inte stjäla fadens fria zon.
    if (Math.abs(revealDelta(row, box)) >= SUBPIXEL_TOLERANCE_PX) return;
    const delta = fadeClearance(row, box, clearance, scrollEdges(list));
    if (delta !== 0) list.scrollLeft += delta;
  }, [wrapRef, selected]);

  return edges;
}
