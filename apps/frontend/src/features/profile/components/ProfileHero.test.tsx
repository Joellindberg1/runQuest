import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { ME, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { ProfileHero } from './ProfileHero';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const hero = { id: ME.id, name: 'Anna Maria Lindqvist', level: 24, ringTurn: 0.5, rank: 2, runs: 3, xpToNext: 659, nextLevel: 25 };

beforeEach(() => resetFakeBackend());

describe('ProfileHero', () => {
  it('shows the first and the last name initial on the avatar, so Anna Maria Lindqvist is AL', () => {
    renderWithApp(<ProfileHero user={{ ...ME, name: 'Anna Maria Lindqvist', profile_picture: undefined }} hero={hero} cells={[]} isDesktop={false} />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });
});
