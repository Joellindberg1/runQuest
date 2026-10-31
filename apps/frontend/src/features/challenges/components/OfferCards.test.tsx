import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { stakeOf } from '../duelsFormat';
import type { IncomingCard, SentCard } from '../duelsModel';
import { IncomingOffer, SentOffer } from './OfferCards';

const NO_BREAK_SPACE = '\u00a0';
const stake = stakeOf({ winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days', loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days' });

const incoming: IncomingCard = {
  id: 'c1', fromId: 'u-maria', from: 'Maria Johansson', fromShort: 'Maria', tier: 'major', tierLabel: 'Major', what: 'Most km · 7 d', stake, canDecline: true, note: null,
};
const sent: SentCard = {
  id: 'c2', toId: 'u-olof', to: 'Olof Bergstrom', toShort: 'Olof', tier: 'minor', tierLabel: 'Minor', what: 'Most XP · 11 d', stake, canWithdraw: true, note: 'Waiting for Olof to respond',
};

describe('the title of an offer card', () => {
  it('keeps the duration of an incoming offer together, and reads the same as before', () => {
    render(
      <ul>
        <IncomingOffer card={incoming} primary busy={false} acceptBlocked={false} onAccept={vi.fn()} onDecline={vi.fn()} onOpenRunner={vi.fn()} />
      </ul>,
    );

    const title = screen.getByRole('heading', { level: 3 });
    expect(title.textContent).toBe(`Maria · Most km · 7${NO_BREAK_SPACE}d`);
    expect(title).toHaveTextContent('Maria · Most km · 7 d');
  });

  it('keeps the duration of a sent offer together, and reads the same as before', () => {
    render(
      <ul>
        <SentOffer card={sent} busy={false} onWithdraw={vi.fn()} onOpenRunner={vi.fn()} />
      </ul>,
    );

    const title = screen.getByRole('heading', { level: 3 });
    expect(title.textContent).toBe(`Olof · Most XP · 11${NO_BREAK_SPACE}d`);
    expect(title).toHaveTextContent('Olof · Most XP · 11 d');
  });
});
