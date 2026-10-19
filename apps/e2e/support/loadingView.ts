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
}

/** En bildruta är blank om #root inte har något, eller bara tomma element utan text. Laddningsvyn har texten "Loading" för skärmläsare, så den räknas som innehåll. */
export function isBlankFrame(frame: FrameSample): boolean {
  return frame.rootChildren === 0 || frame.textLength === 0;
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
