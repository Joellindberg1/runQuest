import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';

// Den lean landningens träd (ADR 006, addendum 2026-10-19, punkt 1 och 8): `/` och `/login` är samma landning med dialogen lazy ovanpå, `/legal` är lazy,
// och allt annat lämnas över till fullappen med appens laddningsvy. Bara backendApi och själva sidbytet (leaveForApp) är ersatta.
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn((): { id: string; name: string; email: string } | null => null),
  login: vi.fn(),
  logout: vi.fn(),
  getPublicStats: vi.fn(() => new Promise(() => {})),
  onUnauthorized: undefined as undefined | (() => void),
}));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/shared/analytics/track', () => ({ track: vi.fn() }));
vi.mock('./leaveForApp', () => ({ leaveForApp: vi.fn() }));

import { LandingApp } from './LandingApp';
import { leaveForApp } from './leaveForApp';

const USER = { id: 'u-anna', name: 'Anna', email: 'anna@example.com' };

/** Adressen som routern står på, med fråga och fragment: det som webbläsarens adressfält skulle visa. */
function AddressProbe() {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="address">{`${pathname}${search}${hash}`}</div>;
}

const at = (address: string) =>
  function Router({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[address]}>
        {children}
        <AddressProbe />
      </MemoryRouter>
    );
  };

const renderLanding = (address = '/') => render(<LandingApp Router={at(address)} />);

/** Vad som står i containern just nu: landningen (dess h1) och/eller appens laddningsvy. */
const look = (container: HTMLElement) => ({
  landing: container.querySelector('#landing-title') !== null,
  loader: container.querySelector('.rq-shell__pending [role="status"]') !== null,
});

/** En ögonblicksbild per commit: MutationObserver anropas efter att Reacts DOM-ändringar för en commit är gjorda, aldrig mitt i. */
function watchCommits(container: HTMLElement) {
  const snapshots: ReturnType<typeof look>[] = [];
  const observer = new MutationObserver(() => snapshots.push(look(container)));
  observer.observe(container, { childList: true, subtree: true });
  return { snapshots, stop: () => observer.disconnect() };
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Username'), 'anna');
  await user.type(screen.getByLabelText('Password'), 'hemligt');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

beforeEach(() => {
  setViewportWidth(390);
  api.isAuthenticated.mockReturnValue(false);
  api.getCurrentUser.mockReturnValue(null);
  api.login.mockReset();
  vi.mocked(leaveForApp).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the landing and its sign-in dialog', () => {
  it('Sign in opens the dialog without remounting the landing', async () => {
    const user = userEvent.setup();
    renderLanding();
    const headline = screen.getByRole('heading', { level: 1 });

    await user.click(screen.getByRole('link', { name: 'Sign in' }));

    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toBe(headline);
  });

  it('/login is the same landing with the dialog already open', async () => {
    renderLanding('/login');
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, hidden: true })).toHaveTextContent('Your group chat deserves a leaderboard');
  });

  it('a signed-out visitor on the landing stays there', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(leaveForApp).not.toHaveBeenCalled();
  });

  it('/legal shows the privacy and terms page', async () => {
    renderLanding('/legal');
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy & Terms' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).not.toBeInTheDocument();
  });
});

describe('the landing file addresses', () => {
  // Caddys try_files löser /landing.html och /landing till dist/landing.html (och S6:s regel /). Lean routern får inte lämna över dem till fullappen: den
  // omladdningen ger samma fil igen, i en evig loop. De är landningen, och adressen skrivs om till / utan omladdning och utan att landningen ritas om.
  it.each([
    ['/landing', '/'],
    ['/landing.html', '/'],
    ['/Landing.HTML', '/'],
    ['/landing?utm_source=x#top', '/?utm_source=x#top'],
    ['/landing.html?utm_source=x#top', '/?utm_source=x#top'],
  ])('%s shows the landing, rewrites the address to %s and never hands over', async (address, canonical) => {
    const removed: string[] = [];
    const container = document.body.appendChild(document.createElement('div'));
    const observer = new MutationObserver((records) => records.forEach((record) => record.removedNodes.forEach((node) => {
      if (node instanceof Element && node.querySelector('#landing-title')) removed.push('landing');
      if (node instanceof Element && node.id === 'landing-title') removed.push('h1');
    })));
    observer.observe(container, { childList: true, subtree: true });

    render(<LandingApp Router={at(address)} />, { container });
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent(canonical));
    observer.disconnect();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your group chat deserves a leaderboard');
    expect(removed).toEqual([]);
    expect(leaveForApp).not.toHaveBeenCalled();
  });

  it('a signed-in visitor on /landing.html is sent to the app, never back to a landing file', async () => {
    api.isAuthenticated.mockReturnValue(true);
    api.getCurrentUser.mockReturnValue(USER);
    renderLanding('/landing.html?utm_source=x');
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board?utm_source=x'));
  });

  it.each(['%2Flanding', '%2Flanding.html', '%2Flanding.html%3Futm%3Dx', '%2FLanding.HTML%23top'])(
    'signing in from /login?next=%s leaves for /board, never for a landing file',
    async (next) => {
      const user = userEvent.setup();
      api.login.mockResolvedValue({ success: true, user: USER });
      renderLanding(`/login?next=${next}`);
      await signIn(user);
      await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board'));
      expect(leaveForApp).toHaveBeenCalledTimes(1);
    },
  );
});

describe('the hand-over to the full app', () => {
  it('a successful sign-in puts the loading view where the landing was, in the same commit, before it leaves for /board', async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({ success: true, user: USER });
    const { container } = renderLanding();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await screen.findByRole('dialog', { name: 'Sign in' });

    const commits = watchCommits(container);
    let atLeave: ReturnType<typeof look> | undefined;
    vi.mocked(leaveForApp).mockImplementation(() => { atLeave = look(container); });
    await signIn(user);
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board'));
    commits.stop();

    expect(commits.snapshots.some((now) => !now.landing && now.loader)).toBe(true);
    // Aldrig en commit där containern varken har landningen eller laddningsvyn.
    expect(commits.snapshots.filter((now) => !now.landing && !now.loader)).toEqual([]);
    expect(atLeave).toEqual({ landing: false, loader: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(leaveForApp).toHaveBeenCalledTimes(1);
  });

  it('after signing in from /login?next= it leaves for next with its search parameters', async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({ success: true, user: USER });
    renderLanding('/login?next=%2Fduels%3Fsend%3D1%26opponent%3Du-karl');
    await signIn(user);
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/duels?send=1&opponent=u-karl'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('a failed sign-in keeps the landing and the dialog, and does not leave', async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({ success: false, error: 'Invalid credentials' });
    renderLanding();
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await signIn(user);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(leaveForApp).not.toHaveBeenCalled();
  });

  it.each([
    ['/', '/board'],
    ['/?tab=titles&utm_source=x', '/titles?utm_source=x'],
  ])('a visitor who is already signed in on %s sees the loading view and never the landing', async (address, target) => {
    api.isAuthenticated.mockReturnValue(true);
    api.getCurrentUser.mockReturnValue(USER);
    const { container } = renderLanding(address);
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith(target));
    expect(look(container)).toEqual({ landing: false, loader: true });
  });

  it('an address the landing does not own hands over to the full app on that address, with the loading view', async () => {
    const { container } = renderLanding('/board?view=week#top');
    await waitFor(() => expect(leaveForApp).toHaveBeenCalledWith('/board?view=week#top'));
    expect(look(container)).toEqual({ landing: false, loader: true });
  });
});
