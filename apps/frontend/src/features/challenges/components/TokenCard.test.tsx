import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { token } from '../duels.fixture';
import { buildTokenGroups, type TokenCard as TokenCardData } from '../duelsModel';
import { TokenCard } from './TokenCard';

function cardOf(over: Parameters<typeof token>[0]): TokenCardData {
  const [card] = buildTokenGroups([token(over)]).flatMap((group) => group.cards);
  return card;
}

describe('TokenCard', () => {
  it('reads as two lines: the metric and length first, the stake second', () => {
    const { container } = render(<TokenCard card={cardOf({ id: 'a', tier: 'minor', metric: 'km', duration_days: 7 })} />);
    const lines = Array.from(container.querySelectorAll('.rq-duels-token__text > *')).map((line) => line.textContent);
    expect(lines).toEqual(['Most km · 7 days', '+0.15× for 5 days · −0.07× for 5 days']);
  });

  it('the second line comes from the token\'s own stake, so a token with another stake reads differently', () => {
    const { container } = render(
      <TokenCard card={cardOf({ id: 'b', tier: 'minor', metric: 'runs', duration_days: 5, winner_delta: 0.2, winner_duration: 3, winner_type: 'multiplier_runs', loser_delta: -0.1, loser_duration: 1, loser_type: 'multiplier_runs' })} />,
    );
    expect(container.querySelector('.rq-duels-token__stake')).toHaveTextContent('+0.2× for 3 runs · −0.1× for 1 run');
  });

  it('a card without a penalty says so on the second line', () => {
    const { container } = render(<TokenCard card={cardOf({ id: 'c', tier: 'legendary', metric: 'total_xp', duration_days: 30, loser_delta: 0, loser_duration: 0 })} />);
    expect(container.querySelector('.rq-duels-token__stake')).toHaveTextContent('+0.5× for 14 days · No penalty');
  });

  it('the bookmark carries no number', () => {
    const { container } = render(<TokenCard card={cardOf({ id: 'd', tier: 'major', metric: 'km', duration_days: 10 })} />);
    const bookmark = container.querySelector('svg');
    expect(bookmark).not.toBeNull();
    expect(bookmark?.querySelector('text')).toBeNull();
    expect(bookmark).toHaveAttribute('aria-hidden', 'true');
  });

  it('carries its tier, so the tinted background and edge come from the tier tokens', () => {
    const { container } = render(<TokenCard card={cardOf({ id: 'e', tier: 'legendary', metric: 'km', duration_days: 14 })} />);
    expect(container.firstElementChild).toHaveAttribute('data-tier', 'legendary');
  });

  it('shows whatever action the caller hands it next to the text', () => {
    render(
      <TokenCard card={cardOf({ id: 'f', tier: 'minor', metric: 'km', duration_days: 7 })}>
        <button type="button">Do it</button>
      </TokenCard>,
    );
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument();
  });
});
