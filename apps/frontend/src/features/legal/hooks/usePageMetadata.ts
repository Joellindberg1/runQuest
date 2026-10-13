import { useEffect } from 'react';

export interface PageMetadata {
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
}

/**
 * Sätter sidans titel, beskrivning och canonical medan sidan är monterad och återställer dem vid avmontering. `index.html` äger
 * grundvärdena (canonical = startsidan för alla SPA-adresser); finns description- eller canonical-elementet inte rörs det inte.
 */
export function usePageMetadata({ title, description, canonical }: PageMetadata): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', description);

    const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const previousCanonical = link?.getAttribute('href') ?? null;
    link?.setAttribute('href', canonical);

    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== null) meta.setAttribute('content', previousDescription);
      if (link && previousCanonical !== null) link.setAttribute('href', previousCanonical);
    };
  }, [title, description, canonical]);
}
