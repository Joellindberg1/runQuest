import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';

// The sign-in dialog is lazy in the lean entry and is prefetched at the first sign of intent towards the Sign in link (ADR 006, addendum 2026-10-19,
// point 8): pointer over, keyboard focus or touch. The prefetch is replaced by a spy; that it fetches the right chunk is one line in loginDialog.ts.
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn(() => null),
  login: vi.fn(),
  logout: vi.fn(),
  getPublicStats: vi.fn(() => new Promise(() => {})),
  onUnauthorized: undefined as undefined | (() => void),
}));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));
vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));
vi.mock('./loginDialog', async (importOriginal) => ({ ...(await importOriginal<typeof import('./loginDialog')>()), prefetchLoginDialog: vi.fn() }));

import { LandingApp } from './LandingApp';
import { prefetchLoginDialog } from './loginDialog';

function Router({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/']} useTransitions={false}>{children}</MemoryRouter>;
}

beforeEach(() => {
  setViewportWidth(390);
  vi.mocked(prefetchLoginDialog).mockClear();
});

describe('prefetching the sign-in dialog', () => {
  it('fetches nothing until the visitor shows intent towards Sign in', () => {
    render(<LandingApp Router={Router} />);
    expect(prefetchLoginDialog).not.toHaveBeenCalled();
  });

  it('prefetches when the pointer moves over Sign in', async () => {
    const user = userEvent.setup();
    render(<LandingApp Router={Router} />);
    await user.hover(screen.getByRole('link', { name: 'Sign in' }));
    expect(prefetchLoginDialog).toHaveBeenCalledTimes(1);
  });

  it('prefetches when Sign in gets keyboard focus', () => {
    render(<LandingApp Router={Router} />);
    act(() => screen.getByRole('link', { name: 'Sign in' }).focus());
    expect(prefetchLoginDialog).toHaveBeenCalledTimes(1);
  });

  it('ignores other links, and prefetches only once', async () => {
    const user = userEvent.setup();
    render(<LandingApp Router={Router} />);
    await user.hover(screen.getByRole('link', { name: 'Join the waitlist' }));
    expect(prefetchLoginDialog).not.toHaveBeenCalled();

    const signIn = screen.getByRole('link', { name: 'Sign in' });
    await user.hover(signIn);
    await user.unhover(signIn);
    await user.hover(signIn);
    expect(prefetchLoginDialog).toHaveBeenCalledTimes(1);
  });
});
