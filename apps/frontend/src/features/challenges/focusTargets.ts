/** Rubrikens Send på /duels (DuelsLayout): dit går fokus när kortet eller knappen som öppnade send-arket inte går att använda. */
const HEADER_SEND_SELECTOR = '[data-tour="duels-send"]';
/** Sidans huvudrubrik på /duels (tabIndex -1 i DuelsLayout). */
const PAGE_HEADING_SELECTOR = '.rq-duels__title';
/** Bekräftelsen eller felet efter ett skick (DuelsLayout, tabIndex -1): hit går fokus när det som hade det inte finns kvar. */
const CONFIRMATION_SELECTOR = '.rq-duels-notice';

/** Bekräftelsen efter ett skick om den visas. */
export const confirmationElement = (): HTMLElement | null => document.querySelector<HTMLElement>(CONFIRMATION_SELECTOR);

/** Duels egen ingång när inget annat finns att gå tillbaka till: rubrikens Send, annars sidans huvudrubrik. Null när sidan inte är Duels. */
export const duelsPageTarget = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(HEADER_SEND_SELECTOR) ?? document.querySelector<HTMLElement>(PAGE_HEADING_SELECTOR);
