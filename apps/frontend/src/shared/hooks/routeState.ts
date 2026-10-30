import type { SendOriginState } from './useOpenRunner';
import { isInternalPath } from '@/shared/utils/internalPath';

// Läsare av route-state för send-flödet och fokusbegäran. Egen fil och inte `useOpenRunner.ts`: den filen ligger i landningens modulgraf (löparnamnen på landningen öppnar Runner card),
// och landningens JS ska inte växa av kod som bara fullappen använder.

/** Router-state som ber skalet fokusera löparens rad när sidan har ritats: ett avbrutet send-flöde skickar det till sidan under popupen (`useRestoreRunnerFocus`). */
export interface FocusRunnerState {
  focusRunnerId: string;
}

const asRecord = (state: unknown): Record<string, unknown> | null => (typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null);

/** `sendOrigin` ur router-state, bara om `returnTo` är en intern adress och löparen är angiven. Annars null: flödet behandlas då som om det saknade ursprung. */
export function readSendOrigin(state: unknown): SendOriginState | null {
  const origin = asRecord(asRecord(state)?.sendOrigin);
  if (!origin || !isInternalPath(origin.returnTo) || typeof origin.runnerId !== 'string' || origin.runnerId === '') return null;
  const returnIdx = typeof origin.returnIdx === 'number' && Number.isInteger(origin.returnIdx) && origin.returnIdx >= 0 ? origin.returnIdx : undefined;
  return returnIdx === undefined ? { returnTo: origin.returnTo, runnerId: origin.runnerId } : { returnTo: origin.returnTo, runnerId: origin.runnerId, returnIdx };
}

/** Router-state utan `sendOrigin`; övrigt (t.ex. `background`) följer med. Ursprunget gäller bara flödet det skickades för och får inte ligga kvar på /duels efter ett skick. */
export function withoutSendOrigin(state: unknown): Record<string, unknown> | undefined {
  const record = asRecord(state);
  if (!record) return undefined;
  const { sendOrigin: _dropped, ...rest } = record;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function readFocusRunnerId(state: unknown): string | null {
  const id = asRecord(state)?.focusRunnerId;
  return typeof id === 'string' && id !== '' ? id : null;
}
