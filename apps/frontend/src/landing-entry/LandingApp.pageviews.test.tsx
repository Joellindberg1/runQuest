import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PAGEVIEW_SETTLE_MS } from '@/shared/analytics/usePageviewTracking';
import { setViewportWidth } from '@/test/viewport';

// Sidvisningarna i den lean landningen (ADR 006, addendum 2026-10-19). Sändaren är en spion i stället för Umami: inget skript hämtas och inget når nätverket.
// Normaliseringen och väntetiden har egna tester (normalizePageUrl, usePageviewTracking); här prövas kopplingen i det lean trädet och överlämningen.
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn((): { id: string; name: string; email: string } | null => null),
  login: vi.fn(),
  logout: vi.fn(),
  getPublicStats: vi.fn(() => new Promise(() => {})),
  onUnauthorized: undefined as undefined | (() => void),
}));
const sender = vi.hoisted(() => ({ send: vi.fn<(url: string) => void>(), sendEvent: vi.fn() }));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));
vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));
vi.mock('@/shared/analytics/umamiPageviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/analytics/umamiPageviews')>()),
  createDefaultPageviewSender: () => sender,
}));
vi.mock('./leaveForApp', () => ({ leaveForApp: vi.fn() }));

import { LandingApp } from './LandingApp';
import { leaveForApp } from './leaveForApp';

const USER = { id: 'u-anna', name: 'Anna', email: 'anna@example.com' };
const AFTER_SETTLING_MS = PAGEVIEW_SETTLE_MS * 3;

const at = (address: string) =>
  function Router({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[address]}>{children}</MemoryRouter>;
  };

const mount = (address: string) => render(<LandingApp Router={at(address)} />);
const sentUrls = () => sender.send.mock.calls.map(([url]) => url);
/** Låter väntetiden gå ut flera gånger om: ett anrop som ska utebli hinner annars aldrig komma. */
const letItSettle = () => new Promise((resolve) => setTimeout(resolve, AFTER_SETTLING_MS));

beforeEach(() => {
  setViewportWidth(390);
  api.isAuthenticated.mockReturnValue(false);
  api.getCurrentUser.mockReturnValue(null);
  api.login.mockReset();
  sender.send.mockReset();
  vi.mocked(leaveForApp).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('page views on the lean landing', () => {
  it.each([
    ['/', '/'],
    ['/?utm_source=instagram&utm_medium=social&ref=anna', '/?utm_source=instagram&utm_medium=social'],
    ['/legal', '/legal'],
    ['/login', '/login'],
  ])('%s sends exactly one page view, reported as %s', async (address, reported) => {
    mount(address);
    await waitFor(() => expect(sender.send).toHaveBeenCalledWith(reported));
    await letItSettle();
    expect(sentUrls()).toEqual([reported]);
  });

  it.each(['/landing', '/landing.html', '/Landing.HTML'])('%s is reported as the landing, with its utm parameters, once', async (file) => {
    mount(`${file}?utm_source=x`);
    await waitFor(() => expect(sender.send).toHaveBeenCalled());
    await letItSettle();
    expect(sentUrls()).toEqual(['/?utm_source=x']);
  });

  it('opening the sign-in dialog from the landing sends one more page view, and leaving the dialog and following a link sends one for each page', async () => {
    const user = userEvent.setup();
    mount('/');
    await waitFor(() => expect(sentUrls()).toEqual(['/']));

    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await screen.findByRole('dialog', { name: 'Sign in' });
    await waitFor(() => expect(sentUrls()).toEqual(['/', '/login']));

    // Escape stänger dialogen (Back till landningen), och först då går Privacy-länken att trycka på.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(sentUrls()).toEqual(['/', '/login', '/']));
    await user.click(await screen.findByRole('link', { name: 'Privacy' }));
    await waitFor(() => expect(sentUrls()).toEqual(['/', '/login', '/', '/legal']));
    await letItSettle();
    expect(sentUrls()).toEqual(['/', '/login', '/', '/legal']);
  });
});

describe('page views and the hand-over to the full app', () => {
  it('signing in counts nothing more: the full app counts the page it opens', async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({ success: true, user: USER });
    mount('/');
    await waitFor(() => expect(sentUrls()).toEqual(['/']));
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Username'), 'anna');
    await user.type(screen.getByLabelText('Password'), 'hemligt');
    await waitFor(() => expect(sentUrls()).toEqual(['/', '/login']));

    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board'));
    await letItSettle();

    expect(sentUrls()).toEqual(['/', '/login']);
  });

  it('a visitor who is already signed in is handed over without a page view for the landing', async () => {
    api.isAuthenticated.mockReturnValue(true);
    api.getCurrentUser.mockReturnValue(USER);
    mount('/?utm_source=x');
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board?utm_source=x'));
    await letItSettle();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('an address the landing does not own is handed over without a page view; the full app counts it', async () => {
    mount('/board?view=week');
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board?view=week'));
    await letItSettle();
    expect(sender.send).not.toHaveBeenCalled();
  });
});
