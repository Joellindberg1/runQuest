// Laddaren för Umami Cloud (ägarbeslut 2026-10-16) och sändaren för sidvisningar. Cookiefritt: Umami sätter inga cookies och den här koden
// skriver varken till cookies eller till localStorage/sessionStorage.
//
// Skriptet läggs in från koden, inte från index.html, så att en build utan webbplats-id inte laddar något alls (staging, lokalt, CI:s
// Lighthouse-bygge). Samma laddare går att återanvända av en framtida landing.html. Allt som skickas är en adress som normalizePageUrl redan
// gjort om till ett routemönster; ingen rundata, inga namn, inget användar-id.

/** Tar emot normaliserade sidvisningar (se normalizePageUrl). Hooken känner bara till det här gränssnittet, inte Umami. */
export interface PageviewSender {
  send: (url: string) => void;
}

/** Hänvisning utan känt ursprung: Umami tolkar tomt som direktbesök. */
const PAGEVIEW_REFERRER_NONE = '';

export const UMAMI_SCRIPT_SRC = 'https://cloud.umami.is/script.js';
/** Skriptet skickar bara från de här värdarna: ingenting från staging, localhost eller en förhandsvisning, även om id:t av misstag skulle sättas. */
export const UMAMI_DOMAINS = 'www.runquest.dev,runquest.dev';

const WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGING = 'staging';

export interface UmamiEnv {
  VITE_UMAMI_WEBSITE_ID?: string;
  VITE_APP_ENV?: string;
}

/** Webbplats-id:t om bygget ska skicka sidvisningar, annars `undefined`. Saknad, tom eller felformad variabel, och ett stagingbygge, ger ingenting. */
export function umamiWebsiteIdOf(env: UmamiEnv): string | undefined {
  if (env.VITE_APP_ENV === STAGING) return undefined;
  const id = env.VITE_UMAMI_WEBSITE_ID?.trim();
  return id && WEBSITE_ID.test(id) ? id : undefined;
}

// Namngivna fält i stället för hela import.meta.env, som Vite annars bakar in som ett objekt.
const readEnv = (): UmamiEnv => ({
  VITE_UMAMI_WEBSITE_ID: import.meta.env.VITE_UMAMI_WEBSITE_ID,
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV,
});

/** Sändaren för den här sidladdningen, med id:t ur bygget. */
export const createDefaultPageviewSender = (): PageviewSender => createPageviewSender(umamiWebsiteIdOf(readEnv()), window);

type Payload = Record<string, unknown>;
interface UmamiTracker {
  track: (mapPayload: (props: Payload) => Payload) => void;
}

const trackerOf = (win: Window): UmamiTracker | undefined => (win as Window & { umami?: UmamiTracker }).umami;

const pathOnly = (url: string): string => url.split('?')[0] ?? url;

/**
 * Sändare för sidvisningar. Utan webbplats-id är `send` en tom funktion. Med id läggs skriptet in (async, defer) första gången en sida skickas,
 * och först när dokumentet laddats klart så att det aldrig konkurrerar med sidans egna resurser. Sidor som kommer innan skriptet är klart köas.
 * Blockeras skriptet (annonsblockerare, nätfel) tystas allt: appen går före statistiken.
 */
export function createPageviewSender(websiteId: string | undefined, win: Window): PageviewSender {
  if (!websiteId) return { send: () => {} };

  const doc = win.document;
  const queue: Array<{ url: string; referrer: string }> = [];
  let requested = false;
  let broken = false;
  let previousUrl: string | null = null;

  const externalReferrer = (): string => {
    try {
      const referrer = new URL(doc.referrer);
      return referrer.origin === win.location.origin ? PAGEVIEW_REFERRER_NONE : referrer.origin;
    } catch {
      return PAGEVIEW_REFERRER_NONE;
    }
  };

  const flush = () => {
    const tracker = trackerOf(win);
    if (!tracker) return;
    for (const view of queue.splice(0)) {
      // Adressen, titeln och hänvisningen ersätts: det riktiga värdet på sidan (adress med id, titel, hänvisning med query) lämnar aldrig webbläsaren.
      try {
        tracker.track((props) => ({ ...props, url: view.url, title: view.url, referrer: view.referrer }));
      } catch {
        // Statistiken får aldrig fälla appen.
      }
    }
  };

  const loadScript = () => {
    const script = doc.createElement('script');
    script.src = UMAMI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.websiteId = websiteId;
    script.dataset.autoTrack = 'false';
    script.dataset.doNotTrack = 'true';
    script.dataset.domains = UMAMI_DOMAINS;
    script.addEventListener('load', flush);
    script.addEventListener('error', () => { broken = true; queue.length = 0; });
    doc.head.appendChild(script);
  };

  const request = () => {
    if (requested) return;
    requested = true;
    if (doc.readyState === 'complete') loadScript();
    else win.addEventListener('load', loadScript, { once: true });
  };

  return {
    send(url) {
      if (broken) return;
      // Första sidan: bara en utomstående hänvisnings ursprung. Efterföljande: föregående sida i appen (normaliserad, utan query).
      const referrer = previousUrl === null ? externalReferrer() : `${win.location.origin}${pathOnly(previousUrl)}`;
      previousUrl = url;
      queue.push({ url, referrer });
      request();
      flush();
    },
  };
}
