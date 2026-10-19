import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { resetDefaultPageviewSender } from '@/shared/analytics/umamiPageviews';
import { setViewportWidth } from '@/test/viewport';

// Hydreringen av den förrenderade landningen (ADR 006, addendum 2026-10-19, punkt 9). Serversidan är landing-ssr.tsx (samma funktion som bygget kör),
// klientsidan är hydrateLanding (samma funktion som landing-main.tsx kör). Hydreringen ska varken ge `console.error` (Reacts mismatch-varningar)
// eller återställbara fel (React kastar då bort delträdet och klientrenderar det: synligt byte och omstartade animationer), och noderna som servern
// ritade ska vara samma objekt efteråt. Att den riktiga Node-renderingen (dist/landing.html) hydrerar rent prövas på staging (S6).
const api = vi.hoisted(() => ({
  isAuthenticated: vi.fn(() => false),
  getCurrentUser: vi.fn(() => null),
  login: vi.fn(),
  logout: vi.fn(),
  getPublicStats: vi.fn(() => new Promise(() => {})),
  onUnauthorized: undefined as undefined | (() => void),
}));

vi.mock('@/shared/services/backendApi', () => ({ backendApi: api }));

import { hydrateLanding } from './hydrateLanding';
import { renderLanding } from '../landing-ssr';

const SETTLE_MS = 150;

let container: HTMLElement;
let root: Root | undefined;

beforeEach(() => {
  setViewportWidth(390);
  window.history.pushState({}, '', '/');
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.head.querySelector('script[data-website-id]')?.remove();
  resetDefaultPageviewSender();
});

/** Hydrerar `markup` och ger tillbaka vad som hände: felrapporter och om noderna byttes ut. */
async function hydrate(markup: string) {
  container.innerHTML = markup;
  const before = Array.from(container.querySelectorAll('*'));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const recoverable = vi.fn();
  await act(async () => {
    root = hydrateLanding(container, { onRecoverableError: recoverable });
  });
  // De lazy delarna (stagingbannern) hydreras när deras chunk kommit; vänta ut det så att ett sent fel också räknas.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  });
  const after = Array.from(container.querySelectorAll('*'));
  return { before, after, consoleError, recoverable };
}

describe('hydrating the prerendered landing', () => {
  it('reports no errors and keeps every DOM node the server rendered', async () => {
    const { before, after, consoleError, recoverable } = await hydrate(renderLanding());

    expect(before.length).toBeGreaterThan(100);
    expect(consoleError).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    expect(after).toHaveLength(before.length);
    expect(after.every((node, index) => node === before[index])).toBe(true);
  });

  it('reports no errors when the build has a web analytics website id: the server render needs no window, the page view tracking renders nothing', async () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'f69b618e-a134-4cd9-af69-d4479c418de8');
    const markup = renderLanding();
    expect(markup).not.toContain('umami');

    const { before, consoleError, recoverable } = await hydrate(markup);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 2));
    });
    const after = Array.from(container.querySelectorAll('*'));

    expect(document.head.querySelector('script[data-website-id]')).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    expect(after).toHaveLength(before.length);
    expect(after.every((node, index) => node === before[index])).toBe(true);
  });

  it('reports no errors in a staging build either, where the banner is a lazy chunk on the client and a plain component on the server', async () => {
    vi.stubEnv('VITE_APP_ENV', 'staging');
    const markup = renderLanding();
    expect(markup).toContain('Staging environment');

    const { before, after, consoleError, recoverable } = await hydrate(markup);

    expect(consoleError).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    expect(after.every((node, index) => node === before[index])).toBe(true);
    expect(after).toHaveLength(before.length);
  });
});
