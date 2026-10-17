import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { setViewportWidth } from '@/test/viewport';
import { warmLanding } from '@/test/warmLazy';

// Stagingbannern genom hela App-trädet: den följer miljövariabeln VITE_APP_ENV och syns på varje adress (landningen, login och inloggade sidor),
// och finns aldrig i prod. Bara backendApi, skalet och sidorna bakom login är ersatta, som i login-testerna.
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

const BANNER = { name: 'Staging environment' };

beforeAll(async () => {
  await warmLanding();
  await import('@/app-shell/StagingBanner');
});

beforeEach(() => {
  setViewportWidth(390);
  api.isAuthenticated.mockReturnValue(false);
  api.getCurrentUser.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the staging banner', () => {
  it('shows on the landing page of a staging build', async () => {
    vi.stubEnv('VITE_APP_ENV', 'staging');
    window.history.pushState({}, '', '/');
    render(<App />);
    await screen.findByRole('heading', { level: 1 });
    expect(await screen.findByRole('complementary', BANNER)).toHaveTextContent('STAGING');
  });

  it('shows over the sign-in dialog on /login in a staging build', async () => {
    vi.stubEnv('VITE_APP_ENV', 'staging');
    window.history.pushState({}, '', '/login');
    render(<App />);
    await screen.findByLabelText('Username', {}, { timeout: 4000 });
    // Den öppna dialogen döljer resten av sidan för skärmläsare (aria-hidden), så remsan hittas på sin text i stället för sin roll; den ritas ändå.
    expect(await screen.findByText('STAGING')).toBeVisible();
  });

  it('shows on signed-in pages of a staging build', async () => {
    vi.stubEnv('VITE_APP_ENV', 'staging');
    api.isAuthenticated.mockReturnValue(true);
    api.getCurrentUser.mockReturnValue({ id: 'u1', name: 'Anna', email: 'anna@example.com' });
    window.history.pushState({}, '', '/board');
    render(<App />);
    await screen.findByRole('heading', { name: 'Board page' });
    expect(await screen.findByRole('complementary', BANNER)).toBeVisible();
  });

  it.each([
    ['no environment set', undefined],
    ['production', 'production'],
    ['an empty value', ''],
  ])('never shows when the build has %s', async (_name, appEnv) => {
    if (appEnv !== undefined) vi.stubEnv('VITE_APP_ENV', appEnv);
    window.history.pushState({}, '', '/');
    render(<App />);
    await screen.findByRole('heading', { level: 1 });
    // Bannern är en lazy-chunk (vore den på ritas den efter en tick): vänta ut en så frånvaron inte bara beror på timing.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('complementary', BANNER)).not.toBeInTheDocument();
    expect(screen.queryByText('STAGING')).not.toBeInTheDocument();
  });
});
