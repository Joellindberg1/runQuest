import { createContext, useContext, type MouseEventHandler, type PointerEventHandler } from 'react';

/**
 * Det en lista (dag-listan på /news, klock-popoverns lista) ger sina rader: att markera en rad läst, och om rörelsevakten har släppt.
 * Vakten gäller LISTAN, inte raden: den räknas från att listan monterades (popovern öppnades), så en rad som kommer in senare (Show more,
 * poll) får ingen egen 150 ms-vakt som skulle svälja en verklig rörelse.
 */
export interface ReadGestureScopeValue {
  markRead: (id: number) => void;
  /** Sant när POINTER_SETTLE_MS har gått sedan listan monterades. */
  isSettled: () => boolean;
}

export const ReadGestureContext = createContext<ReadGestureScopeValue | null>(null);

interface RowReadHandlers {
  onPointerEnter: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onClick: MouseEventHandler<HTMLElement>;
}

/**
 * Läs-gesterna för EN rad (ADR 011 beslut 4, addendum 2026-10-14). En rad blir läst direkt av tre saker, och av inget annat:
 * - mus/penna som rör sig in över raden (`pointerenter`) eller över den (`pointermove`, så att en pekare som vilade där när vakten gick ut räknas
 *   vid sin första rörelse), men inte under rörelsevakten;
 * - `click`, alltså knappens aktivering: Enter (keydown), Space (keyup), skärmläsare som aktiverar utan att flytta fokus och en touch-TAP. En scroll
 *   med touch börjar med pointerdown men avslutas av webbläsaren med pointercancel och ger aldrig click, så den markerar ingenting, och raden
 *   behöver varken pointerdown/up-spårning eller en rörelsetröskel;
 * - touch-pekare (`pointerType === 'touch'`) räknas aldrig via pointerenter/pointermove.
 * Fokus markerar inte. Utan lista runt (en rad ritad för sig) är handlers no-ops. Bara olästa rader gör något; `markRead` i useMarkNewsRead
 * tar dessutom ett sista beslut mot cachen (egna, avstängda, backfill och okända id:n ger inget anrop).
 */
export function useRowReadGestures(id: number, unread: boolean): RowReadHandlers {
  const scope = useContext(ReadGestureContext);

  const onPointer: PointerEventHandler<HTMLElement> = (event) => {
    if (!scope || !unread || event.pointerType === 'touch' || !scope.isSettled()) return;
    scope.markRead(id);
  };
  const onClick: MouseEventHandler<HTMLElement> = () => {
    if (scope && unread) scope.markRead(id);
  };

  return { onPointerEnter: onPointer, onPointerMove: onPointer, onClick };
}
