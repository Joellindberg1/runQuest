import { useRef, type KeyboardEvent } from 'react';
import type { TokenCard as TokenCardData } from '../duelsModel';
import { TokenCard } from './TokenCard';

interface TokenChoiceProps {
  cards: readonly TokenCardData[];
  /** Tokenet som är valt; null = inget (då är första kortet tabbstoppet). */
  selectedKey: string | null;
  /** Id på rubriken som ger gruppen dess namn. */
  labelledBy: string;
  onSelect: (tokenKey: string) => void;
}

/** Hur långt en tangent flyttar valet; Home och End hoppar till ändarna. */
function targetIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Send-flödets steg 2: ett tokenkort per token som en radiogrupp. Ett tabbstopp (det valda kortet, annars det första), pilarna flyttar både valet
 * och fokus, Home/End hoppar till första/sista, Space och Enter väljer. Det valda kortet visar en bock och texten "Selected" (synlig, men dold för
 * hjälpmedel: `aria-checked` säger redan samma sak, så kortets namn blir bara mått, längd och insats). Kortet är `TokenCard` med bocken som
 * handling; identiska tokens är separata kort eftersom varje kort är ett token.
 */
export function TokenChoice({ cards, selectedKey, labelledBy, onSelect }: TokenChoiceProps) {
  const radios = useRef<Array<HTMLDivElement | null>>([]);
  const tabStopKey = selectedKey ?? cards[0]?.tokenKey ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onSelect(cards[index].tokenKey);
      return;
    }
    const next = targetIndex(event.key, index, cards.length);
    if (next === null) return;
    event.preventDefault();
    onSelect(cards[next].tokenKey);
    radios.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="rq-duels-choice">
      {cards.map((card, index) => {
        const selected = card.tokenKey === selectedKey;
        return (
          <div
            key={card.tokenKey}
            ref={(element) => { radios.current[index] = element; }}
            role="radio"
            aria-checked={selected}
            tabIndex={card.tokenKey === tabStopKey ? 0 : -1}
            className="rq-duels-choice__card"
            onClick={() => onSelect(card.tokenKey)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <TokenCard card={card}>
              {selected && <span className="rq-duels-choice__selected" aria-hidden="true">✓ Selected</span>}
            </TokenCard>
          </div>
        );
      })}
    </div>
  );
}
