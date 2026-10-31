import { RUNNER_ID_ATTRIBUTE, findRunnerElement, findRunnerElements } from './findRunnerElement';

/**
 * Det som öppnade löparens kort: elementet, löparen det hör till, dess plats bland löparens synliga element (`ordinal`) och sidan det låg på.
 * Platsen behövs när sidan under kortet ritas om (mobilens kort är en egen sida): elementet är då ersatt av ett nytt på samma plats.
 */
interface Opener {
  runnerId: string;
  element: HTMLElement;
  ordinal: number;
  page: string;
}

/**
 * Minnet är en modulvariabel och inte route-state: ett DOM-element går inte att lägga i historikposten, och ett steg bakåt (`navigate(-1)`) kan inte bära state till posten det landar på.
 * Det skrivs vid varje klick utanför en dialog (`rememberOpener`), så en ny öppning ersätter förra och inget läcker mellan öppningar, och det lever bara medan skalet lever (`watchRunnerOpener`).
 */
let remembered: Opener | null = null;

/** Klick i en dialog (kortet, send-arket, deras skrim) öppnar ingen löpare: de får inte skriva över raden som öppnade kortet. */
const DIALOG_SELECTOR = '[role="dialog"], .rq-scrim';

/** Sidan som en adress hör till; kortet och send-arket ligger på egna adresser, så sidan under dem är den som jämförs. */
const pageOf = (location: Pick<Location, 'pathname' | 'search'>): string => `${location.pathname}${location.search}`;

function rememberOpener(target: EventTarget | null): void {
  if (!(target instanceof Element) || target.closest(DIALOG_SELECTOR)) return;
  const element = target.closest<HTMLElement>(`[${RUNNER_ID_ATTRIBUTE}]`);
  const runnerId = element?.getAttribute(RUNNER_ID_ATTRIBUTE);
  const ordinal = element && runnerId ? findRunnerElements(runnerId).indexOf(element) : -1;
  remembered = element && runnerId && ordinal >= 0 ? { runnerId, element, ordinal, page: pageOf(window.location) } : null;
}

/**
 * Börjar minnas vilket element som öppnade löparens kort: ett klick (också Enter och mellanslag på en knapp, och ett tryck) som träffar ett element med `data-runner-id`, sett i
 * fångstfasen före anropsplatsens egen hanterare. Anropsplatserna är många och skickar bara löparens id vidare, och klickmålet är det enda som skiljer raderna åt när samma löpare står i
 * flera. `document.activeElement` räcker inte: Safari och Firefox på Mac fokuserar inte en knapp vid klick. Returnerar en avbrytare som också glömmer.
 */
export function watchRunnerOpener(): () => void {
  const onClick = (event: MouseEvent) => rememberOpener(event.target);
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    remembered = null;
  };
}

/** Elementet som öppnade löparens kort, om det finns kvar (eller har ersatts på samma plats) på samma sida, annars null. */
function findOpener(runnerId: string, root: ParentNode): HTMLElement | null {
  const opener = remembered;
  if (!opener || opener.runnerId !== runnerId || opener.page !== pageOf(window.location)) return null;
  const elements = findRunnerElements(runnerId);
  const target = elements.includes(opener.element) ? opener.element : elements[opener.ordinal];
  return target && root.contains(target) ? target : null;
}

/**
 * Det som ska få fokus när löparens kort har stängts: elementet som öppnade det, annars löparens första synliga element (`findRunnerElement`: reservkedjan som gällde förut, där
 * `null` låter den som anropar falla tillbaka på rubriken). Samma löpare kan stå i många rader (båda halvorna i Duels History), och bara öppnaren är raden användaren kom från.
 */
export function findRunnerTarget(runnerId: string, root: ParentNode = document): HTMLElement | null {
  return findOpener(runnerId, root) ?? findRunnerElement(runnerId, root);
}
