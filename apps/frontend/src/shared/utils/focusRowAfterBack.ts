import { findRunnerElement } from './findRunnerElement';
import { focusRunnerRowWhenRendered } from './focusRunnerRow';

/** Sökningen som pågår just nu: högst en, eftersom ett ark bara stängs av Back en gång åt gången. */
let release: (() => void) | null = null;

/** Avbryter sökningen efter löparens rad som `focusRunnerRowAfterBack` startat, om en pågår. Skalet anropar den när platsen byts (`useRestoreRunnerFocus`). */
export function dropRowSearchAfterBack(): void {
  release?.();
}

/**
 * Ger löparens rad fokus efter att webbläsarens Back har stängt send-arket under ett skick, och släpper sökningen så fort den inte längre gäller. `focusRunnerRowWhenRendered` väntar upp till
 * en sekund på att sidan ritar raden; under tiden kan användaren ha gått vidare till en sida som också listar löparen, eller själv flyttat fokus, och då ska raden inte ta det. Arket är
 * avmonterat och har ingen effekt kvar som kan städa, så platsbytet avbryter sökningen genom skalet (`dropRowSearchAfterBack`, samma ställe som skalets egen sökning städas på).
 * En fokusflytt till något annat än raden avbryter också; raden själv och rubriken som sökningen faller tillbaka på räknas inte.
 */
export function focusRunnerRowAfterBack(runnerId: string): void {
  release?.();

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    const ownMove = target instanceof HTMLElement && (target === findRunnerElement(runnerId) || target.tagName === 'H1');
    if (!ownMove) drop();
  };
  const stop = focusRunnerRowWhenRendered(runnerId, () => drop());
  const drop = () => {
    stop();
    document.removeEventListener('focusin', onFocusIn, true);
    if (release === drop) release = null;
  };
  release = drop;
  document.addEventListener('focusin', onFocusIn, true);
}
