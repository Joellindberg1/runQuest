import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';

// Inloggningen genom hela App-trädet (riktig AuthProvider + App-gate): ett felaktigt lösenord får inte avmontera LoginPage.
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

import App from './App';

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

describe('inloggning (App → AuthProvider → LoginPage)', () => {
  it('felaktigt lösenord: felet syns (role=alert) och fälten står kvar — LoginPage avmonteras inte', async () => {
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

  it('appstart med sparad session visar en loader först och går sedan förbi login (gate:n på initiering finns kvar)', async () => {
    api.isAuthenticated.mockReturnValue(true);
    api.getCurrentUser.mockReturnValue({ id: 'u1', name: 'Anna', email: 'anna@example.com' });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/board');
  });
});
