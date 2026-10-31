import { isRendered } from './findRunnerElement';
import { findRunnerTarget } from './runnerOpener';

/** Hur länge sidan får rita (data som hämtas, lazy chunk) innan raden anses saknas och sidans huvudrubrik får fokus i stället. */
export const ROW_WAIT_MS = 1000;

const MAIN_SELECTOR = 'main';
/** En öppen modal dialog gör resten av sidan ofokuserbar (`aria-hidden`, `pointer-events: none`): fokus fastnar inte förrän den är borta. */
const OPEN_MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';
const MAIN_HEADING_SELECTOR = 'h1';
/** Det som kan ändra om en rad går att fokusera utan att något nytt element ritas: Radix städar `aria-hidden` och `pointer-events` på body när en dialog stängs. */
const READINESS_ATTRIBUTES = ['aria-hidden', 'hidden', 'inert', 'style'];

const contentRoot = (): ParentNode => document.querySelector(MAIN_SELECTOR) ?? document;
const modalIsOpen = (): boolean => document.querySelector(OPEN_MODAL_SELECTOR) !== null;

/** Sidans första synliga huvudrubrik, gjord fokuserbar för skript. */
function mainHeading(): HTMLElement | null {
  const heading = Array.from(contentRoot().querySelectorAll<HTMLElement>(MAIN_HEADING_SELECTOR)).find(isRendered);
  if (!heading) return null;
  // Rubrikerna som saknar tabIndex är inte fokuserbara; -1 gör dem det för skript men inte för Tab.
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  return heading;
}

function focusMainHeading(): boolean {
  const heading = mainHeading();
  heading?.focus();
  return heading !== null && document.activeElement === heading;
}

/**
 * Flyttar fokus till löparens rad så snart sidan har ritat den och ingen modal dialog är öppen, annars (efter `ROW_WAIT_MS`) till sidans huvudrubrik. Raden väljs i huvudinnehållet
 * (`main`) som `findRunnerTarget` gör: elementet som öppnade löparens kort, annars den första synliga i dokumentordning, så valet är detsamma varje gång när samma löpare finns på flera ställen.
 * `focus()` scrollar fram raden, och öppnaren ligger redan i vyn.
 * Utan löpare (`null`: sidan som kommer tillbaka har ingen löpare att återvända till) är målet sidans huvudrubrik, så snart den ritats.
 * `onSettled` anropas en gång när fokus har flyttats eller när det inte längre går (ingen rubrik, eller en dialog som fortfarande är öppen). Returnerar en avbrytare.
 */
export function focusRunnerRowWhenRendered(runnerId: string | null, onSettled: () => void): () => void {
  let settled = false;
  let pending: number | undefined;
  const observer = new MutationObserver(() => schedule());
  const giveUpTimer = window.setTimeout(giveUp, ROW_WAIT_MS);

  function settle() {
    if (settled) return;
    settled = true;
    observer.disconnect();
    window.clearTimeout(giveUpTimer);
    window.clearTimeout(pending);
    onSettled();
  }

  // Fokus flyttas först i nästa uppgift. Ett klick på skrimmen stänger dialogen i pekarens nedtryckning, och webbläsarens egen fokusflytt (till `<body>`, ytan tar inte fokus)
  // kommer efter den händelsen: fokus som sattes i samma uppgift skulle tas tillbaka.
  function schedule() {
    if (settled || pending !== undefined) return;
    pending = window.setTimeout(attempt, 0);
  }

  function attempt() {
    pending = undefined;
    if (settled || modalIsOpen()) return;
    const target = runnerId === null ? mainHeading() : findRunnerTarget(runnerId, contentRoot());
    if (!target) return;
    target.focus();
    if (document.activeElement === target) settle();
  }

  function giveUp() {
    if (settled) return;
    if (!modalIsOpen()) focusMainHeading();
    settle();
  }

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: READINESS_ATTRIBUTES });
  schedule();

  return () => {
    settled = true;
    observer.disconnect();
    window.clearTimeout(giveUpTimer);
    window.clearTimeout(pending);
  };
}
