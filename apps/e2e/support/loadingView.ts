import type { Page } from '@playwright/test';

// Hjälpare för specerna som bevisar förrenderingen och laddningsvyn (tests/landing.spec.ts, ADR 006 addendum 2026-10-19, punkt 11).

/** Fördröjning av fullappens ingångs-JS: så lång att laddningsvyn hinner synas och mätas innan appen ritar. */
export const APP_SCRIPT_DELAY_MS = 2_000;

/** Fullappens ingångsfil (`/assets/index-<hash>.js`), landningens (`/assets/landing-<hash>.js`). Hashen är okänd, så prov går på mönstret. */
const APP_ENTRY = '**/assets/index-*.js';
const LANDING_ENTRY = '**/assets/landing-*.js';

/** Håller tillbaka en ingångsfil tills `release()` anropas (eller `maxMs` gått). `releasedAt` är väggklockan då filen släpptes, annars null. */
export interface HeldScript {
  /** Sant när filen faktiskt begärts av sidan (annars hölls ingenting tillbaka). */
  requested: () => boolean;
  release: () => void;
  releasedAt: () => number | null;
}

async function hold(page: Page, pattern: string, maxMs: number): Promise<HeldScript> {
  let releasedAt: number | null = null;
  let requested = false;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  await page.route(pattern, async (route) => {
    requested = true;
    const timer = setTimeout(open, maxMs);
    await opened;
    clearTimeout(timer);
    releasedAt ??= Date.now();
    await route.continue();
  });
  return { requested: () => requested, release: open, releasedAt: () => releasedAt };
}

/** Fullappens ingångs-JS släpps först efter `delayMs` (eller när `release()` anropas). */
export function delayAppScript(page: Page, delayMs: number = APP_SCRIPT_DELAY_MS): Promise<HeldScript> {
  return hold(page, APP_ENTRY, delayMs);
}

/** Landningens ingångs-JS hålls tills `release()` anropas: landningen står som ren HTML tills dess. */
export function holdLandingScript(page: Page, maxMs: number): Promise<HeldScript> {
  return hold(page, LANDING_ENTRY, maxMs);
}

/** Ett svar som hålls tillbaka tills `release()` anropas (eller `maxMs` gått). Tidpunkterna är väggklockan, jämförbar med `FrameSample.at`. */
export interface HeldResponse {
  requestedAt: () => number | null;
  releasedAt: () => number | null;
  release: () => void;
}

/** Svarsvägen för gruppens topplista (`GET /auth/users-with-runs`), som Board väntar på. Utan stub går förfrågan till det riktiga API:et när den släppts. */
const STANDINGS_URL = '**/auth/users-with-runs';
/** Titlarna per löpare (`GET /titles/user/:id`): podiekorten ritas ur dem, och gaten väntar in dem. */
const TITLES_URL = '**/titles/user/*';

/** Topplistans svar hålls tillbaka: förfrågan når API:et (eller stuben) först när `release()` anropas. Provar att laddningsvyn står kvar medan appen väntar på datan. */
export function holdStandings(page: Page, maxMs: number): Promise<HeldResponse> {
  return holdResponse(page, STANDINGS_URL, maxMs);
}

/** Titlarnas svar hålls tillbaka (alla löpares förfrågningar släpps tillsammans). Provar att laddningsvyn också väntar in korten, inte bara topplistan. */
export function holdTitles(page: Page, maxMs: number): Promise<HeldResponse> {
  return holdResponse(page, TITLES_URL, maxMs);
}

async function holdResponse(page: Page, url: string, maxMs: number): Promise<HeldResponse> {
  let requestedAt: number | null = null;
  let releasedAt: number | null = null;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  await page.route(url, async (route) => {
    requestedAt ??= Date.now();
    const timer = setTimeout(open, maxMs);
    await opened;
    clearTimeout(timer);
    releasedAt ??= Date.now();
    await route.fallback();
  });
  return { requestedAt: () => requestedAt, releasedAt: () => releasedAt, release: open };
}

/** Topplistans svar blir ett serverfel (500) i stället för data: provar felvägen i appen. */
export async function failStandings(page: Page): Promise<void> {
  await page.route(STANDINGS_URL, (route) =>
    // Förhandsfrågan (OPTIONS) går vidare till stuben/API:et; bara själva hämtningen fäller.
    route.request().method() === 'OPTIONS'
      ? route.fallback()
      : route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ error: 'Standings failed on purpose' }) }),
  );
}

/** Laddarens (`role="status"` i `.rq-shell__pending`) rektangel i sidans koordinater, med lutningen inräknad, plus om sidan blivit bredare än fönstret (sidled scroll). */
export interface LoaderRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Sant om dokumentet är bredare än fönstret. */
  overflowsX: boolean;
  /**
   * Stagingbannerns höjd (0 i prod och i index.html: bannern ritas av React). I ett stagingbygge reserverar den sin höjd ur laddningsvyns 100dvh, så ovalen hamnar
   * en halv bannerhöjd lägre i gaten än i index.html. Det är miljöns marginal, inte en hoppande bild i prod.
   */
  stagingBannerHeight: number;
}

/** Mäter laddarens rektangel just nu; null om ingen laddare finns i sidan. Samma mått i index.html före JS och i gaten efter React = ingen hoppande bild. */
export function measureLoader(page: Page): Promise<LoaderRect | null> {
  return page.evaluate(() => {
    const status = document.querySelector('#root .rq-shell__pending [role="status"]');
    if (!status) return null;
    const { x, y, width, height } = status.getBoundingClientRect();
    const banner = document.querySelector('[aria-label="Staging environment"]');
    return {
      x,
      y,
      width,
      height,
      overflowsX: document.documentElement.scrollWidth > window.innerWidth,
      stagingBannerHeight: banner ? banner.getBoundingClientRect().height : 0,
    };
  });
}

/** En bildruta ur sidans egen requestAnimationFrame-slinga. */
export interface FrameSample {
  /** Väggklocka (ms) när rutan ritades, jämförbar med `HeldScript.releasedAt`. */
  at: number;
  /** Dokumentets starttid: skiljer det gamla dokumentet från det nya efter en navigering. */
  document: number;
  path: string;
  /** Antal barn i #root utom stagingbannern, aviseringsytan och skript (-1 om #root saknas). */
  rootChildren: number;
  /** Antal tecken text i de barnen, utan inledande och avslutande blanksteg. */
  textLength: number;
  /** Laddningsvyn: `.rq-shell__pending` med en `role="status"` i #root. */
  loader: boolean;
  /** Appens inloggade skal (`.rq-shell[data-shell]`) i #root. */
  shell: boolean;
  /** Landningen (`.rq-landing`) i #root. */
  landing: boolean;
  /** Board (`.rq-board`, sidans rot) i #root. */
  board: boolean;
  /** Antal podiekort (`data-testid="podium-<plats>"`) i #root: topplistans ifyllda platser. */
  podium: number;
  /** Podiekort som visar ett tomläge som fylls på: "No titles held yet", en platt rank-pil (—) eller ingen badge-mini. */
  podiumPlaceholders: number;
}

/** En bildruta är blank om #root inte har något, eller bara tomma element utan text. Laddningsvyn har texten "Loading" för skärmläsare, så den räknas som innehåll. */
export function isBlankFrame(frame: FrameSample): boolean {
  return frame.rootChildren === 0 || frame.textLength === 0;
}

/** Board är ritad men podiet saknas: de tomma platserna som aldrig ska synas på första laddningen. */
export function isBoardWithoutStandings(frame: FrameSample): boolean {
  return frame.board && frame.podium === 0;
}

export interface FrameLog {
  /** Alla bildrutor sedan loggningen startade (i alla dokument sidan hunnit ha). */
  frames: () => FrameSample[];
}

/**
 * Loggar varje bildruta och varje DOM-ändring från dokumentets start (inte först från DOMContentLoaded: med fördröjd ingångs-JS väntar DOMContentLoaded på skriptet, och
 * just tiden dessförinnan är det som ska provas). Slingan körs i varje dokument sidan laddar, och rapporterar via en exponerad funktion som överlever navigeringar.
 * Prov innan #root är färdigtolkad räknas inte: webbläsaren visar då fortfarande det förra dokumentet.
 */
export async function logFrames(page: Page): Promise<FrameLog> {
  const frames: FrameSample[] = [];
  await page.exposeFunction('__rqReportFrame', (sample: Omit<FrameSample, 'at'>) => {
    if (sample.rootChildren !== -1) frames.push({ ...sample, at: Date.now() });
  });
  await page.addInitScript(() => {
    const sample = () => {
      const root = document.getElementById('root');
      // Stagingbannern, aviseringsytan och temaskriptet (next-themes) står kvar vid varje övergång och räknas inte som innehåll: bredvid dem kan sidan ändå vara tom.
      const content = root ? Array.from(root.children).filter((child) => !child.matches('script, [aria-label="Staging environment"], section[aria-label^="Notifications"]')) : [];
      (window as unknown as { __rqReportFrame: (sample: unknown) => void }).__rqReportFrame({
        document: performance.timeOrigin,
        path: location.pathname,
        // #root är färdigtolkad först när något följer efter den; dessförinnan är barnen ett halvtolkat dokument och rutan räknas inte.
        rootChildren: root?.nextSibling ? content.length : -1,
        textLength: content.map((child) => child.textContent ?? '').join('').trim().length,
        loader: root?.querySelector('.rq-shell__pending [role="status"]') != null,
        shell: root?.querySelector('.rq-shell[data-shell]') != null,
        landing: root?.querySelector('.rq-landing') != null,
        board: root?.querySelector('.rq-board') != null,
        podium: root?.querySelectorAll('[data-testid^="podium-"]').length ?? 0,
        podiumPlaceholders: Array.from(root?.querySelectorAll('[data-testid^="podium-"]') ?? []).filter(
          (card) => card.querySelector('.rq-board-titleline[data-empty="true"]') || card.querySelector('.rq-board-delta[data-dir="flat"]') || !card.querySelector('[data-minis]'),
        ).length,
      });
    };
    // Varje bildruta, och varje ändring av DOM:en: en commit som tömmer #root kan ritas innan nästa bildruta provas, och just den tomma rutan ska synas i loggen.
    // Ändringarna följs först efter den första bildrutan, annars syns ett halvtolkat dokument (#root öppnat men barnen ännu inte tolkade) som en tom ruta.
    const observer = new MutationObserver(sample);
    let observing = false;
    const tick = () => {
      sample();
      if (!observing) {
        observing = true;
        observer.observe(document, { childList: true, subtree: true, characterData: true });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { frames: () => [...frames] };
}

/** Returnerar en funktion som säger om landningen (`.rq-landing`) någon gång fanns i DOM:en, i något dokument. Observeras från dokumentets start. */
export async function watchForLanding(page: Page): Promise<() => boolean> {
  let seen = false;
  await page.exposeFunction('__rqLandingSeen', () => {
    seen = true;
  });
  await page.addInitScript(() => {
    const check = () => {
      if (document.querySelector('.rq-landing')) (window as unknown as { __rqLandingSeen: () => void }).__rqLandingSeen();
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    check();
  });
  return () => seen;
}
