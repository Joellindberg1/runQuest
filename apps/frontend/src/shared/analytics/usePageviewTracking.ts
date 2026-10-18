import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { normalizePageUrl } from './normalizePageUrl';
import { createDefaultPageviewSender, type PageviewSender } from './umamiPageviews';

/**
 * Hur länge adressen ska ligga still innan sidvisningen skickas. En omdirigering (utloggad besökare på /board skickas till /login) byter
 * adress i samma stund som sidan visas; utan väntan skulle /board räknas som en sidvisning fast ingen såg den sidan. Umamis egen
 * automatik väntar av samma skäl.
 */
export const PAGEVIEW_SETTLE_MS = 150;

interface PageviewTrackingOptions {
  /** Appen har inte bestämt vad den ska visa än (inloggningen kontrolleras): ingen sida är visad, så ingen räknas. */
  paused?: boolean;
  /** Finns för tester; appen använder standardsändaren. */
  sender?: PageviewSender;
}

/**
 * Skickar en sidvisning till webbanalysen varje gång användaren kommer till en ny sida, med adressen normaliserad (routemönster, inga id,
 * ingen query utom utm_ på landningen). Måste ligga i routern. Utan webbplats-id i bygget (staging, lokalt, CI) gör sändaren ingenting.
 */
export function usePageviewTracking({ paused = false, sender }: PageviewTrackingOptions = {}): void {
  const [activeSender] = useState<PageviewSender>(() => sender ?? createDefaultPageviewSender());
  const { pathname, search } = useLocation();
  const url = normalizePageUrl(pathname, search);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setTimeout(() => activeSender.send(url), PAGEVIEW_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeSender, url, paused]);
}
