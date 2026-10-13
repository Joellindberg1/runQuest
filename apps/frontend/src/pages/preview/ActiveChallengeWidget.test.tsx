import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Challenge } from '@runquest/types';
import { ActiveChallengeWidget } from './ActiveChallengeWidget';

vi.mock('@/shared/hooks/useOpenRunner', () => ({ useOpenRunner: () => vi.fn() }));

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
