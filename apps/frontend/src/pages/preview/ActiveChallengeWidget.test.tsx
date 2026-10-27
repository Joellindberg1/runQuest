import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Challenge } from '@runquest/types';
import { ActiveChallengeWidget } from './ActiveChallengeWidget';
import { OPEN_KEYS, tabTo } from '@/test/runnerRows';

const openRunner = vi.hoisted(() => vi.fn());
vi.mock('@/shared/hooks/useOpenRunner', () => ({ useOpenRunner: () => openRunner }));

// 23:30 UTC den 31 okt är redan 00:30 den 1 nov i Stockholm.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T23:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const challenge = (overrides: Partial<Challenge>): Challenge =>
  ({
    id: 'c1', tier: 'major', metric: 'km', status: 'active',
    challenger_id: 'u1', challenger_name: 'Anna', opponent_id: 'u2', opponent_name: 'Erik',
    ...overrides,
  }) as Challenge;

const renderWidget = (c: Challenge) =>
  render(<ActiveChallengeWidget challenge={c} progress={[]} currentUserId="u1" />);

describe('ActiveChallengeWidget datum', () => {
  it('slutdatum idag i Stockholm visas som Today, även när UTC-dagen är en annan', () => {
    renderWidget(challenge({ end_date: '2026-11-01' }));
    expect(screen.getAllByText(/Today/).length).toBeGreaterThan(0);
  });

  it('slutdatum dagen efter Stockholm-dagen visas som Tomorrow', () => {
    renderWidget(challenge({ end_date: '2026-11-02' }));
    expect(screen.getAllByText(/Tomorrow/).length).toBeGreaterThan(0);
  });

  it('en utmaning som startar imorgon räknar timmar till Stockholm-midnatt', () => {
    renderWidget(challenge({ start_date: '2026-11-02', end_date: '2026-11-10' }));
    // Midnatt 2 nov Stockholm = 23:00 UTC den 1 nov = 23,5 timmar fram.
    expect(screen.getByText('Starts in 24h')).toBeInTheDocument();
  });

  it('en utmaning vars startdag redan börjat är inte väntande', () => {
    renderWidget(challenge({ start_date: '2026-11-01', end_date: '2026-11-10' }));
    expect(screen.queryByText(/Starts in/)).not.toBeInTheDocument();
  });
});

describe('ActiveChallengeWidget opponent', () => {
  beforeEach(() => openRunner.mockClear());

  it('is a button named after the opponent that carries the runner id', () => {
    renderWidget(challenge({}));

    expect(screen.getByRole('button', { name: 'Erik' })).toHaveAttribute('data-runner-id', 'u2');
  });

  it('is the challenger when I am the opponent', () => {
    render(<ActiveChallengeWidget challenge={challenge({})} progress={[]} currentUserId="u2" />);

    expect(screen.getByRole('button', { name: 'Anna' })).toHaveAttribute('data-runner-id', 'u1');
  });

  describe.each(OPEN_KEYS)('with $label', ({ keys }) => {
    it('Tab reaches the opponent and the key opens the runner without triggering the card', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(<ActiveChallengeWidget challenge={challenge({})} progress={[]} currentUserId="u1" onClick={onClick} />);

      await tabTo(user, screen.getByRole('button', { name: 'Erik' }));
      await user.keyboard(keys);

      expect(openRunner).toHaveBeenCalledExactlyOnceWith('u2');
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  it('never nests the opponent button inside another button when the card is clickable', () => {
    render(<ActiveChallengeWidget challenge={challenge({})} progress={[]} currentUserId="u1" onClick={vi.fn()} />);

    const opponent = screen.getByRole('button', { name: 'Erik' });

    expect(opponent.parentElement?.closest('button')).toBeNull();
  });

  it('keeps the whole card clickable through its own button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ActiveChallengeWidget challenge={challenge({})} progress={[]} currentUserId="u1" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Open challenge against Erik' }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(openRunner).not.toHaveBeenCalled();
  });

  it('describes the card button with the card content, so a screen reader keeps the score and the dates', () => {
    render(
      <ActiveChallengeWidget
        challenge={challenge({ end_date: '2026-11-10' })}
        progress={[{ user_id: 'u1', value: 12 }, { user_id: 'u2', value: 8 }]}
        currentUserId="u1"
        onClick={vi.fn()}
      />,
    );

    const card = screen.getByRole('button', { name: 'Open challenge against Erik' });

    expect(card).toHaveAccessibleDescription(/You vs Erik.*12\.0 km.*8\.0 km/);
  });

  it('has no card button when the card is not clickable', () => {
    renderWidget(challenge({}));

    expect(screen.queryByRole('button', { name: 'Open challenge against Erik' })).toBeNull();
  });
});
