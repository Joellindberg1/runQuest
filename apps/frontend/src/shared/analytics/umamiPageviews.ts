// Laddaren för Umami Cloud (ägarbeslut 2026-10-16) och sändaren för sidvisningar. Cookiefritt: Umami sätter inga cookies och den här koden
// skriver varken till cookies eller till localStorage/sessionStorage.
//
// Skriptet läggs in från koden, inte från index.html, så att en build utan webbplats-id inte laddar något alls (staging, lokalt, CI:s
// Lighthouse-bygge). Samma laddare går att återanvända av en framtida landing.html. Allt som skickas är en adress som normalizePageUrl redan
// gjort om till ett routemönster; ingen rundata, inga namn, inget användar-id.
//
// Händelserna (RUN-292) delar kön, laddaren och webbplats-id-grinden med sidvisningarna: EN sändare, EN skripttagg. Varje händelse går genom
// sanitizeAnalyticsEvent (packages/shared) innan den köas, så vakten går inte att gå förbi från en anropsplats.
import { sanitizeAnalyticsEvent, type AnalyticsEventName, type AnalyticsTrackArgs } from '@runquest/shared';
import { normalizePageUrl } from './normalizePageUrl';

/** Tar emot normaliserade sidvisningar (se normalizePageUrl). Hooken känner bara till det här gränssnittet, inte Umami. */
export interface PageviewSender {
  send: (url: string) => void;
}

/** Tar emot händelser ur den fasta listan i shared. Typerna är samma som `track`; vakten körs ändå här, vid enda utgången mot Umami. */
export interface EventSender {
  sendEvent: <E extends AnalyticsEventName>(event: E, ...props: AnalyticsTrackArgs<E>) => void;
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

// EN sändare per webbplats-id och sidladdning: sidvisningarna (hooken) och händelserna (track) delar kö och skripttagg. Nyckeln är id:t, så ett
// bygge utan id (eller med ett annat) aldrig återanvänder en sändare som redan har ett skript.
let defaultSender: { websiteId: string | undefined; sender: PageviewSender & EventSender } | undefined;

/** Sändaren för den här sidladdningen, med id:t ur bygget. Samma sändare vid varje anrop så länge id:t är detsamma. */
export const createDefaultPageviewSender = (): PageviewSender & EventSender => {
  const websiteId = umamiWebsiteIdOf(readEnv());
  if (!defaultSender || defaultSender.websiteId !== websiteId) {
    defaultSender = { websiteId, sender: createPageviewSender(websiteId, window) };
  }
  return defaultSender.sender;
};

/** För tester: glöm den delade sändaren, så att nästa anrop bygger en ny (och lägger in ett nytt skript). */
export const resetDefaultPageviewSender = (): void => {
  defaultSender = undefined;
};

type Payload = Record<string, unknown>;
type QueuedItem =
  | { kind: 'pageview'; url: string; referrer: string }
  | { kind: 'event'; url: string; name: string; data?: Record<string, string> };
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
export function createPageviewSender(websiteId: string | undefined, win: Window): PageviewSender & EventSender {
  if (!websiteId) return { send: () => {}, sendEvent: () => {} };

  const doc = win.document;
  const queue: QueuedItem[] = [];
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
    for (const item of queue.splice(0)) {
      // Adressen, titeln och hänvisningen ersätts: det riktiga värdet på sidan (adress med id, titel, hänvisning med query) lämnar aldrig webbläsaren.
      // En händelse bär ingen hänvisning (sessionens kommer från första sidvisningen); namnet och datat är redan prövade av vakten.
      try {
        tracker.track((props) =>
          item.kind === 'pageview'
            ? { ...props, url: item.url, title: item.url, referrer: item.referrer }
            : { ...props, url: item.url, title: item.url, referrer: PAGEVIEW_REFERRER_NONE, name: item.name, ...(item.data ? { data: item.data } : {}) },
        );
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
      queue.push({ kind: 'pageview', url, referrer });
      request();
      flush();
    },
    sendEvent(event, ...props) {
      if (broken) return;
      const clean = sanitizeAnalyticsEvent(event, props[0]);
      if (!clean) return;
      // Sidan händelsen hände på, normaliserad nu och inte när skriptet hunnit ladda: köade händelser följer med den sida de kom från.
      queue.push({ kind: 'event', url: normalizePageUrl(win.location.pathname, win.location.search), name: clean.name, data: clean.data });
      request();
      flush();
    },
  };
}
