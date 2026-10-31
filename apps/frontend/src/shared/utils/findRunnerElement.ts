/** Attributet som varje element som öppnar en löpare bär (ADR 006: fokus tillbaka till löparens rad). */
export const RUNNER_ID_ATTRIBUTE = 'data-runner-id';

export function isRendered(element: HTMLElement): boolean {
  if (getComputedStyle(element).visibility === 'hidden') return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/** Alla synliga element (i dokumentordning) som öppnar löparen `runnerId`. Samma synlighetsregel som `findRunnerElement`. */
export function findRunnerElements(runnerId: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${RUNNER_ID_ATTRIBUTE}]`)).filter((element) => element.getAttribute(RUNNER_ID_ATTRIBUTE) === runnerId && isRendered(element));
}

/**
 * Det första synliga elementet (i dokumentordning) som öppnar löparen `runnerId`, eller null. Reservvalet när det som öppnade kortet inte längre finns (`findRunnerTarget`).
 * `aria-hidden` räknas inte som dold: en dialog döljer sidan bakom sig för skärmläsare, men elementet
 * är fortfarande det som ska få fokus när dialogen stängs.
 */
export function findRunnerElement(runnerId: string, root: ParentNode = document): HTMLElement | null {
  return findRunnerElements(runnerId, root)[0] ?? null;
}
