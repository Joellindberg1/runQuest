import React from 'react';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';

// Utloggning och 401 genom hela App-trädet (riktig AuthProvider, RequireAuth, AvatarMenu och Landing; RUN-145):
// medveten utloggning → / utan dialog och utan next; 401 mitt i sessionen → Landing med dialogen och next bevarad.
// Bara backendApi, skalet (en stub som monterar den riktiga AvatarMenu) och sidorna bakom login är ersatta.
const api = vi.hoisted(() => {
  const state = { token: 'token-a' as string | null };
  return {
    state,
    isAuthenticated: vi.fn(() => state.token !== null),
    getCurrentUser: vi.fn(() => (state.token ? { id: 'u1', name: 'Anna', email: 'anna@example.com' } : null)),
    login: vi.fn(),
    logout: vi.fn(() => { state.token = null; }),
    onUnauthorized: undefined as undefined | (() => void),
  };
});

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/shared/hooks/useAppInit', () => ({ useAppInit: () => {} }));
vi.mock('@/features/onboarding/components/OnboardingOrchestrator', () => ({ OnboardingOrchestrator: () => null }));
vi.mock('@/app-shell/AppShell', async () => {
  const { AvatarMenu } = await import('@/app-shell/AvatarMenu');
  return { AppShell: () => <div data-testid="shell"><AvatarMenu user={null} variant="desktop" /><Outlet /></div> };
});
vi.mock('@/pages/BoardPage', () => ({ default: () => <h1>Board page</h1> }));
vi.mock('@/pages/ProfilePage', () => ({ default: () => <h1>Profile page</h1> }));

import App from './App';
import { warmLanding } from '@/test/warmLazy';

const LANDING_HEADLINE = 'Your group chat deserves a leaderboard';
const url = () => window.location.pathname + window.location.search;

const logOut = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Account menu/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
};

beforeEach(() => {
  setViewportWidth(1280);
  api.state.token = 'token-a';
  api.login.mockReset();
  api.logout.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeAll(warmLanding);

describe('Log out → Landing', () => {
  it.each([['/profile', 'Profile page'], ['/board', 'Board page']])(
    'utloggning från %s: adressen blir / — ingen dialog, ingen next, ingen /login-mellanlandning',
    async (from, heading) => {
      window.history.pushState({}, '', from);
      render(<App />);
      await screen.findByRole('heading', { name: heading });
      const replace = vi.spyOn(window.history, 'replaceState');
      const push = vi.spyOn(window.history, 'pushState');

      await logOut();

      expect(await screen.findByRole('heading', { level: 1, name: LANDING_HEADLINE })).toBeInTheDocument();
      expect(url()).toBe('/');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByLabelText('Username')).toBeNull();
      expect(api.logout).toHaveBeenCalledTimes(1);
      // Aldrig via /login: ingen historikskrivning mot en login-adress.
      const written = [...replace.mock.calls, ...push.mock.calls].map(([, , target]) => String(target));
      expect(written.filter((target) => target.includes('login'))).toEqual([]);
    },
  );

  it('efter utloggning öppnar Sign in dialogen utan next (man hamnar på /board efter inloggning)', async () => {
    window.history.pushState({}, '', '/profile');
    render(<App />);
    await screen.findByRole('heading', { name: 'Profile page' });
    await logOut();
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }));

    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(url()).toBe('/login');
  });
});

describe('401 mitt i sessionen', () => {
  it('Landing med dialogen öppen och next = sidan man var på; inget loopar och inga anrop görs från den utloggade vyn', async () => {
    window.history.pushState({}, '', '/profile?tab=runs');
    render(<App />);
    await screen.findByRole('heading', { name: 'Profile page' });

    act(() => { api.onUnauthorized?.(); });

    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(url()).toBe('/login?next=%2Fprofile%3Ftab%3Druns');
    expect(screen.getByRole('heading', { level: 1, name: LANDING_HEADLINE, hidden: true })).toBeInTheDocument();

    // Stabilt: ingen omdirigeringsloop (RUN-143:s qc.clear() startar ingen omhämtning) och ingen inloggning/utloggning på egen hand.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(url()).toBe('/login?next=%2Fprofile%3Ftab%3Druns');
    expect(api.login).not.toHaveBeenCalled();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it('inloggning efter 401 återvänder till sidan man var på', async () => {
    window.history.pushState({}, '', '/profile');
    render(<App />);
    await screen.findByRole('heading', { name: 'Profile page' });
    act(() => { api.state.token = null; api.onUnauthorized?.(); });
    await screen.findByRole('dialog', { name: 'Sign in' });

    api.login.mockImplementation(async () => {
      api.state.token = 'token-b';
      return { success: true, user: { id: 'u1', name: 'Anna', email: 'anna@example.com' } };
    });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'ratt-losen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('heading', { name: 'Profile page' })).toBeInTheDocument();
    await waitFor(() => expect(url()).toBe('/profile'));
  });
});
