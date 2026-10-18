import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { setViewportWidth } from '@/test/viewport';
import { warmLanding } from '@/test/warmLazy';

// Sidvisningarna genom hela App-trädet: bygget med VITE_UMAMI_WEBSITE_ID laddar Umami-skriptet på landningen, och ett bygge utan den (staging,
// lokalt, CI:s Lighthouse-bygge) laddar ingenting. Bara backendApi är ersatt. jsdom hämtar inga skript, så inget når Umami Cloud.
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn((): null => null),
  login: vi.fn(),
  logout: vi.fn(),
  onUnauthorized: undefined as undefined | (() => void),
}));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));
vi.mock('@/shared/hooks/useAppInit', () => ({ useAppInit: () => {} }));

const WEBSITE_ID = 'f69b618e-a134-4cd9-af69-d4479c418de8';
const umamiScript = () => document.head.querySelector<HTMLScriptElement>('script[data-website-id]');

beforeAll(warmLanding);

beforeEach(() => {
  setViewportWidth(390);
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  umamiScript()?.remove();
});

describe('page views in the app', () => {
  it('loads the Umami script for a build that has a website id', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    render(<App />);
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(umamiScript()).not.toBeNull(), { timeout: 3000 });
    expect(umamiScript()!.dataset.websiteId).toBe(WEBSITE_ID);
  });

  it('loads no script for a build without a website id', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');
    render(<App />);
    await screen.findByRole('heading', { level: 1 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(umamiScript()).toBeNull();
  });
});
