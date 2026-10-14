import type { Placement } from '../newsModel';

/**
 * Placeringen på en rank_passed-rad ("You're #3", "Karl #2"), ritad som en liten bricka i mono efter meningen (ägarbeslut 3, frame N3).
 * Den korta formen är bara för ögat (`aria-hidden`); skärmläsaren får en hel mening ("You are now number 3") i radens namn, en gång.
 * Brickan har ingen egen färg och ändras inte av läst/oläst: en oläst passering ska inte väga tyngre än andra olästa rader.
 */
export function PlacementBadge({ placement }: { placement: Placement }) {
  return (
    <>
      <span className="rq-news-place" aria-hidden="true">{placement.label}</span>
      <span className="sr-only">{placement.spoken}</span>
    </>
  );
}
