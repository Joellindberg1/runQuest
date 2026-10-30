import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// Popupens chunk hålls tillbaka för gott i den här filen: provet gäller väntläget (se RunnerPage.lazy.test.tsx för hur).
vi.mock('@/features/runner/components/RunnerPopup', () => new Promise(() => {}));

const DESKTOP = 1280;
const BACKGROUND = { pathname: '/board', search: '?view=week', hash: '', state: null, key: 'bg' };
const popupOverBoard = ['/board?view=week', { pathname: `/runner/${OTHER.id}`, state: { background: BACKGROUND } }];

beforeEach(() => {
  // Som i en riktig webbläsare där popupen har en post bakom sig: Esc och skrim är då ett steg bakåt (`useCloseRunner` läser window.history, inte MemoryRouter).
  window.history.replaceState({ idx: 1 }, '');
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
});

const location = () => screen.getByTestId('location').textContent;
const karlRow = () => document.querySelector<HTMLElement>(`main [data-runner-id="${OTHER.id}"]`);

describe('the popup while its chunk loads', () => {
  it('the dialog is named after the runner when the runner is known', async () => {
    renderWithApp(<AppRoutes />, { entry: popupOverBoard as never, width: DESKTOP });

    expect(await screen.findByRole('dialog', { name: `Runner card: ${OTHER.name}` })).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    ['Escape', (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' })],
    ['a click on the scrim', () => fireEvent.click(document.querySelector('.rq-scrim') as HTMLElement)],
  ])('closing with %s puts the focus on the runner row, not on the page body', async (_how, close) => {
    renderWithApp(<AppRoutes />, { entry: popupOverBoard as never, width: DESKTOP });
    const dialog = await screen.findByRole('dialog', { name: /Runner card/ });
    await waitFor(() => expect(dialog).toHaveFocus());
    await waitFor(() => expect(karlRow()).not.toBeNull());

    close(dialog);

    await waitFor(() => expect(location()).toBe('/board?view=week'));
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    await waitFor(() => expect(karlRow()).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });
});
