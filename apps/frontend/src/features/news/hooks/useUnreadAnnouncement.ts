import { useEffect, useRef, useState } from 'react';
import { UNREAD_ANNOUNCE_MS, unreadSummary } from '../newsModel';

/**
 * Texten för klockans polite live-region (ADR 011 addendum 2026-10-14). Annonserar bara en MINSKNING av oläst-räknaren (en rad lästes), debouncad;
 * en pollning som ger samma värde ändrar ingenting, startvärdet annonseras aldrig, och en ökning (nya nyheter) annonseras inte utan tömmer regionen
 * så att nästa minskning till ett tidigare sagt värde ändå är en förändring som läses upp. Returnerar '' när det inte finns något att säga.
 *
 * `watermark` är flödets `last_seen_id`. Det rör sig bara av "Mark all read" (`markSeenInFeed`), aldrig av en rad-gest, så en minskning som kommer
 * samtidigt med en ändrad vattenmärkning är kvitteringen, som redan har sin egen bekräftelse ("N marked as read"): då säger klockan inget
 * (inget dubbelt annonserande).
 */
export function useUnreadAnnouncement(unread: number, watermark: number | null = null): string {
  const [message, setMessage] = useState('');
  const previous = useRef({ unread, watermark });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const before = previous.current;
    previous.current = { unread, watermark };
    // Bara vattenmärket ändrades: en väntande annonsering av en gest ska stå kvar.
    if (unread === before.unread) return;
    clearTimeout(timer.current);
    if (unread > before.unread || watermark !== before.watermark) {
      setMessage('');
      return;
    }
    timer.current = setTimeout(() => setMessage(`Pack news: ${unreadSummary(unread)}`), UNREAD_ANNOUNCE_MS);
  }, [unread, watermark]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return message;
}
