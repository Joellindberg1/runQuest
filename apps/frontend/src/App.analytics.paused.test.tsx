import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';
import { setViewportWidth } from '@/test/viewport';

// Medan inloggningen kontrolleras visar appen bara en laddningsbild: ingen sida är visad, så ingen sidvisning räknas. Kontrollen är i praktiken
// omedelbar, så här hålls den öppen genom att useAuth ersätts med ett läge som aldrig blir klart.
vi.mock('@/providers/authContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/providers/authContext')>();
  return { ...original, useAuth: () => ({ user: null, loading: true, isAdmin: false, login: vi.fn(), logout: vi.fn() }) };
});
vi.mock('@/shared/hooks/useAppInit', () => ({ useAppInit: () => {} }));

const WEBSITE_ID = 'f69b618e-a134-4cd9-af69-d4479c418de8';
const SETTLE_AND_MORE_MS = 600;

beforeEach(() => {
  setViewportWidth(390);
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.head.querySelector('script[data-website-id]')?.remove();
});

describe('page views while the app is still checking the login', () => {
  it('loads no script and counts nothing until the app knows what to show', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_AND_MORE_MS));
    expect(document.head.querySelector('script[data-website-id]')).toBeNull();
  });
});
