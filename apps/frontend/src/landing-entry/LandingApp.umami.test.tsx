import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetDefaultPageviewSender } from '@/shared/analytics/umamiPageviews';
import { setViewportWidth } from '@/test/viewport';

// Den lean landningen laddar webbanalysen på samma sätt som fullappen (samma sändare, samma skripttagg) och bara när bygget har ett webbplats-id.
// Ingen sändare är ersatt här: det prövas att skriptet kommer in med rätt attribut. jsdom hämtar inga skript, så inget når Umami Cloud.
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn((): null => null),
  login: vi.fn(),
  logout: vi.fn(),
  getPublicStats: vi.fn(() => new Promise(() => {})),
  onUnauthorized: undefined as undefined | (() => void),
}));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api, default: api }));

import { LandingApp } from './LandingApp';

const WEBSITE_ID = 'f69b618e-a134-4cd9-af69-d4479c418de8';
const NO_SCRIPT_WAIT_MS = 600;
const umamiScript = () => document.head.querySelector<HTMLScriptElement>('script[data-website-id]');

const Router = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/?utm_source=x']}>{children}</MemoryRouter>;

beforeEach(() => {
  setViewportWidth(390);
  resetDefaultPageviewSender();
});

afterEach(() => {
  vi.unstubAllEnvs();
  umamiScript()?.remove();
  resetDefaultPageviewSender();
});

describe('web analytics on the lean landing', () => {
  it('loads the Umami script cookie-free, with the same attributes as the full app, when the build has a website id', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    render(<LandingApp Router={Router} />);
    await waitFor(() => expect(umamiScript()).not.toBeNull(), { timeout: 3000 });
    const script = umamiScript()!;
    expect(script.src).toBe('https://cloud.umami.is/script.js');
    expect(script.dataset).toMatchObject({
      websiteId: WEBSITE_ID,
      autoTrack: 'false',
      doNotTrack: 'true',
      domains: 'www.runquest.dev,runquest.dev',
    });
    expect(script.async && script.defer).toBe(true);
  });

  it('loads no script for a build without a website id', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');
    render(<LandingApp Router={Router} />);
    await new Promise((resolve) => setTimeout(resolve, NO_SCRIPT_WAIT_MS));
    expect(umamiScript()).toBeNull();
  });

  it('loads no script for a staging build, even if the website id is set by mistake', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    vi.stubEnv('VITE_APP_ENV', 'staging');
    render(<LandingApp Router={Router} />);
    await new Promise((resolve) => setTimeout(resolve, NO_SCRIPT_WAIT_MS));
    expect(umamiScript()).toBeNull();
  });
});
