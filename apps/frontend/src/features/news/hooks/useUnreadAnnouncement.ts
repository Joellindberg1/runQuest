import { useEffect, useRef, useState } from 'react';
import { unreadSummary } from '../newsModel';

/** Hur länge räknaren ska stå still innan minskningen annonseras: en svepning över flera rader ger ett tal, inte en tirad. */
export const UNREAD_ANNOUNCE_MS = 500;

/**
 * Texten för klockans polite live-region (ADR 011 addendum 2026-10-14). Annonserar bara en MINSKNING av oläst-räknaren (en rad lästes), debouncad;
 * en pollning som ger samma värde ändrar ingenting, startvärdet annonseras aldrig, och en ökning (nya nyheter) annonseras inte utan tömmer regionen
 * så att nästa minskning till ett tidigare sagt värde ändå är en förändring som läses upp. Returnerar '' när det inte finns något att säga.
 */
export function useUnreadAnnouncement(unread: number): string {
  const [message, setMessage] = useState('');
  const previous = useRef(unread);

  useEffect(() => {
    const before = previous.current;
    previous.current = unread;
    if (unread === before) return undefined;
    if (unread > before) {
      setMessage('');
      return undefined;
    }
    const timer = setTimeout(() => setMessage(`Pack news: ${unreadSummary(unread)}`), UNREAD_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [unread]);

  return message;
}
