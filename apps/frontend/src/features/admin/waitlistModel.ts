import { stockholmDate } from '@/features/events/eventsFormat';
import { formatLongDate } from '@/features/log/logFormat';

// Väntelistans texter. Ren logik — ingen DOM, ingen datahämtning.

/** "42 signups" · "1 signup" */
export const signupCountText = (count: number): string => `${count} ${count === 1 ? 'signup' : 'signups'}`;

/** Raden som säger att listan är kapad ("Showing the latest 1000 of 1234"), annars null: totalen är det exakta antalet, listan har ett tak. */
export function shownLimitText(shown: number, total: number): string | null {
  return total > shown ? `Showing the latest ${shown} of ${total}` : null;
}

/** "13 October 2026" — anmälningsdagen i Stockholm, samma kalender som resten av appen. */
export const signupDateText = (createdAt: string): string => formatLongDate(stockholmDate(createdAt));
