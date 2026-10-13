import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { warmLanding } from '@/test/warmLazy';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

const MOBILE = 390;
const DESKTOP = 1280;
const BACKDROP = '[data-decor="track-backdrop"]';

beforeEach(() => {
  resetFakeBackend();
});

describe('bakgrundsbanan — var den finns', () => {
  it.each([
    '/board', '/titles', '/duels', '/events', '/news', '/log', '/profile', '/badges',
    '/runner/u-karl', '/playbook', '/settings', '/features',
  ])('%s i mobilskalet: en bakgrund, först i skalet så att sidan ritas ovanpå', async (path) => {
    const { container } = renderWithApp(<AppRoutes />, { entry: path, width: MOBILE });

    const shell = await waitFor(() => {
      const found = container.querySelector('[data-shell="mobile"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await waitFor(() => expect(container.querySelector('main')?.textContent?.length).toBeGreaterThan(0));
    expect(container.querySelectorAll(BACKDROP)).toHaveLength(1);
    expect(shell.firstElementChild).toBe(container.querySelector(BACKDROP));
  });

  it('/admin (admin) i desktopskalet: en bakgrund, först i skalet', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/admin', admin: true, width: DESKTOP });

    const shell = await waitFor(() => {
      const found = container.querySelector('[data-shell="desktop"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(container.querySelectorAll(BACKDROP)).toHaveLength(1);
    expect(shell.firstElementChild).toBe(container.querySelector(BACKDROP));
  });

  it('/legal (publik): en bakgrund, först i sidans ram', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/legal', user: null, width: MOBILE });

    await screen.findByRole('heading', { level: 1, name: 'Privacy & Terms' });
    expect(container.querySelectorAll(BACKDROP)).toHaveLength(1);
    expect(container.querySelector('.rq-legal')?.firstElementChild).toBe(container.querySelector(BACKDROP));
  });

  it('landningen (/) har ingen: den har sitt eget rutnät och sin egen bana', async () => {
    await warmLanding();
    const { container } = renderWithApp(<AppRoutes />, { entry: '/', user: null, width: MOBILE });

    await waitFor(() => expect(container.querySelector('[data-decor="arena"]')).not.toBeNull());
    expect(container.querySelector(BACKDROP)).toBeNull();
  });

  it('samma bakgrundselement står kvar när man byter sida, så banan hoppar inte', async () => {
    const { container } = renderWithApp(<AppRoutes />, { entry: '/board', width: MOBILE });
    await waitFor(() => expect(container.querySelector(BACKDROP)).not.toBeNull());
    const before = container.querySelector(BACKDROP);

    // user-event är inget beroende i repot (nya beroenden kräver Lead), så fireEvent som i routes.test.tsx.
    fireEvent.click(screen.getByRole('link', { name: /titles/i }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/titles'));

    expect(container.querySelector(BACKDROP)).toBe(before);
  });
});
