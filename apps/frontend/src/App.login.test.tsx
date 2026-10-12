import React from 'react';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';

// Inloggningen genom hela App-trädet (riktig AuthProvider + App-gate + BrowserRouter): dialogen över Landing (RUN-145). Ett felaktigt lösenord får
// inte avmontera dialogen, Sign in-knappen öppnar den, Back/✕ stänger den och en lyckad inloggning går till next eller /board.
// Bara backendApi, skalet och sidorna bakom login är ersatta.
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn((): { id: string; name: string; email: string } | null => null),
  login: vi.fn(),
  logout: vi.fn(),
  onUnauthorized: undefined as undefined | (() => void),
}));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/shared/hooks/useAppInit', () => ({ useAppInit: () => {} }));
vi.mock('@/features/onboarding/components/OnboardingOrchestrator', () => ({ OnboardingOrchestrator: () => null }));
vi.mock('@/app-shell/AppShell', () => ({ AppShell: () => <div data-testid="shell"><Outlet /></div> }));
vi.mock('@/pages/BoardPage', () => ({ default: () => <h1>Board page</h1> }));
vi.mock('@/pages/TitlesPage', () => ({ default: () => <h1>Titles page</h1> }));

import App from './App';
import { warmLanding } from '@/test/warmLazy';

/** React Routers historikindex (`idx` i history.state): 0 = första posten. Skiljer navigate(-1) från replace. */
const historyIndex = () => (window.history.state as { idx?: number } | null)?.idx;

const signIn = (name: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
};

beforeEach(() => {
  setViewportWidth(390);
  window.history.pushState({}, '', '/login');
  api.isAuthenticated.mockReturnValue(false);
  api.getCurrentUser.mockReturnValue(null);
  api.login.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeAll(warmLanding);

describe('inloggning (App → AuthProvider → LoginDialog över Landing)', () => {
  it('felaktigt lösenord: felet syns (role=alert) och fälten står kvar — dialogen avmonteras inte', async () => {
    api.login.mockResolvedValue({ success: false, error: 'Invalid credentials' });
    render(<App />);
    const username = await screen.findByLabelText('Username');
    signIn('anna', 'fel-losen');

    // Alert-regionen finns permanent (tom) — vänta på texten, inte på elementet.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    expect(screen.getByLabelText('Username')).toBe(username);
    expect(username).toHaveValue('anna');
    expect(screen.getByLabelText('Password')).toHaveValue('fel-losen');
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(username).toHaveAccessibleDescription('Invalid credentials');
    expect(window.location.pathname).toBe('/login');
  });

  it('två fel i rad: båda visas, och knappen är återställd efter varje försök', async () => {
    api.login.mockResolvedValue({ success: false, error: 'Invalid credentials' });
    render(<App />);
    await screen.findByLabelText('Username');

    signIn('anna', 'fel-1');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled());

    api.login.mockResolvedValue({ success: false, error: 'Account locked' });
    signIn('anna', 'fel-2');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Account locked'));
    expect(api.login).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Username')).toHaveValue('anna');
  });

  it('under pågående inloggning står formuläret kvar: fälten readOnly (inte disabled), knappen aria-disabled, fokus tappas inte', async () => {
    let finish: (value: { success: boolean; error?: string }) => void = () => {};
    api.login.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    const username = await screen.findByLabelText('Username');
    const password = screen.getByLabelText('Password');
    fireEvent.change(username, { target: { value: 'anna' } });
    fireEvent.change(password, { target: { value: 'hemligt' } });
    password.focus();
    expect(password).toHaveFocus();
    fireEvent.submit(password.closest('form') as HTMLFormElement);

    // Inte disabled: ett disabled fält/en disabled knapp tappar fokus. Knappen är aria-disabled och fälten readOnly.
    const busy = await screen.findByRole('button', { name: 'Signing in…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(screen.getByLabelText('Username')).toBe(username);
    expect(username).toHaveAttribute('readonly');
    expect(username).not.toBeDisabled();
    expect(password).toHaveAttribute('readonly');
    expect(password).not.toBeDisabled();
    expect(password).toHaveFocus();
    expect(screen.getByRole('form', { name: 'Sign in' })).toHaveAttribute('aria-busy', 'true');

    // Ett nytt submit medan anropet pågår ignoreras.
    fireEvent.click(busy);
    expect(api.login).toHaveBeenCalledTimes(1);

    finish({ success: false, error: 'Invalid credentials' });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'));
    expect(username).not.toHaveAttribute('readonly');
    expect(password).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Sign In' })).not.toHaveAttribute('aria-disabled');
    expect(password).toHaveFocus();
  });

  it('lyckad inloggning leder till /board', async () => {
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    render(<App />);
    await screen.findByLabelText('Username');
    signIn('anna', 'ratt-losen');

    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/board');
  });

  it('Sign in på Landing öppnar dialogen (adressen /login) och en lyckad inloggning går till /board', async () => {
    window.history.pushState({}, '', '/');
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(await screen.findByRole('link', { name: 'Sign in to your pack' }));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    signIn('anna', 'ratt-losen');

    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/board');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('/login?next=/titles: lyckad inloggning leder till /titles (djuplänk till dialogen)', async () => {
    window.history.pushState({}, '', '/login?next=%2Ftitles');
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    render(<App />);
    await screen.findByRole('dialog', { name: 'Sign in' });
    signIn('anna', 'ratt-losen');

    expect(await screen.findByRole('heading', { name: 'Titles page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/titles');
  });

  it('skyddad sida direktladdad utloggad: Landing med dialogen och next bevarad → inloggning leder tillbaka dit', async () => {
    window.history.pushState({}, '', '/titles');
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    render(<App />);
    await screen.findByRole('dialog', { name: 'Sign in' });
    expect(window.location.pathname + window.location.search).toBe('/login?next=%2Ftitles');
    signIn('anna', 'ratt-losen');

    expect(await screen.findByRole('heading', { name: 'Titles page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/titles');
  });

  it.each([
    ['tab', '%2F%09%2Fevil.com'],
    ['flera tabbar', '%2F%09%09%09%2Fevil.com'],
    ['radbrytning', '%2F%0A%2Fevil.com'],
    ['CR', '%2F%0D%2Fevil.com'],
  ])('next med kontrolltecken (%s) kraschar inte (webbläsaren strippar dem till //evil.com → SecurityError i replaceState): /board', async (_name, next) => {
    window.history.pushState({}, '', `/login?next=${next}`);
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    render(<App />);
    await screen.findByRole('dialog', { name: 'Sign in' });
    signIn('anna', 'ratt-losen');

    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/board');
    expect(window.location.hostname).not.toBe('evil.com');
  });

  it('en next som pekar utanför appen följs aldrig efter inloggning (ingen öppen redirect): /board', async () => {
    window.history.pushState({}, '', '/login?next=https%3A%2F%2Fevil.example%2Fsteal');
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    render(<App />);
    await screen.findByRole('dialog', { name: 'Sign in' });
    signIn('anna', 'ratt-losen');

    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/board');
  });

  it('Back stänger dialogen: / → Sign in (/login) → Back ger Landing utan dialog', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in to your pack' }));
    await screen.findByRole('dialog', { name: 'Sign in' });

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
  });

  it('✕ stänger dialogen från Landing med ett steg bakåt (navigate(-1), inte en ny push eller replace), och Sign in öppnar den igen', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    const lengthBefore = window.history.length;
    expect(historyIndex()).toBe(0);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in to your pack' }));
    await screen.findByRole('dialog', { name: 'Sign in' });
    expect(historyIndex()).toBe(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/');
    // Diskriminerande: ett steg bakåt ger index 0; en replace('/') hade lämnat index 1 (och en push 2). Historiken växte bara med Sign in-klicket.
    expect(historyIndex()).toBe(0);
    expect(window.history.length).toBe(lengthBefore + 1);

    fireEvent.click(screen.getByRole('link', { name: 'Sign in to your pack' }));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });

  // Dialogen går att lämna under pågående inloggning. Ett svar som kommer efter det får aldrig skicka användaren till /board mot sin vilja.
  it.each([
    ['Back', async () => { window.history.back(); }],
    ['✕', async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); }],
    ['Esc', async () => { fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); }],
  ])('lämnar man dialogen med %s medan inloggningen pågår och den sedan lyckas: Landing står kvar, ingen session startas, ingen navigering till /board', async (_name, leave) => {
    window.history.pushState({}, '', '/');
    let finish: (value: { success: boolean; token?: string; user?: { id: string; name: string; email: string } }) => void = () => {};
    api.login.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in to your pack' }));
    await screen.findByRole('dialog', { name: 'Sign in' });
    signIn('anna', 'ratt-losen');
    await screen.findByRole('button', { name: 'Signing in…' });

    await leave();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/');

    api.logout.mockClear();
    await act(async () => { finish({ success: true, token: 't', user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } }); });
    // Landing står kvar; svaret kastades (token rensas, ingen användare sätts).
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Board page' })).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(api.logout).toHaveBeenCalledTimes(1);

    // Och en ny inloggning efteråt fungerar som vanligt.
    api.login.mockResolvedValue({ success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } });
    fireEvent.click(screen.getByRole('link', { name: 'Sign in to your pack' }));
    await screen.findByRole('dialog', { name: 'Sign in' });
    signIn('anna', 'ratt-losen');
    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
  });

  it('ett fel som kommer efter att dialogen lämnats kastas: ingen krasch, och nästa dialog är orörd (inget gammalt fel)', async () => {
    window.history.pushState({}, '', '/');
    let finish: (value: { success: boolean; error?: string }) => void = () => {};
    api.login.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in to your pack' }));
    await screen.findByRole('dialog', { name: 'Sign in' });
    signIn('anna', 'fel');
    await screen.findByRole('button', { name: 'Signing in…' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(async () => { finish({ success: false, error: 'Invalid credentials' }); });
    fireEvent.click(screen.getByRole('link', { name: 'Sign in to your pack' }));
    await screen.findByRole('dialog', { name: 'Sign in' });
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Username')).toHaveValue('');
  });

  it('✕ på en direktladdad /login ersätter adressen med / (Landing utan dialog)', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Your group chat deserves a leaderboard' })).toBeInTheDocument();
  });

  it('appstart med sparad session visar en loader först och går sedan förbi login (gate:n på initiering finns kvar)', async () => {
    api.isAuthenticated.mockReturnValue(true);
    api.getCurrentUser.mockReturnValue({ id: 'u1', name: 'Anna', email: 'anna@example.com' });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/board');
  });
});
