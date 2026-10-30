import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { resetHistoryIdx } from '@/test/resetHistoryIdx';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// Runner card som sida (mobil, direktladdning): Back till sidan före ger fokus på löparens rad där den finns, annars på sidans huvudrubrik, inte på <body>.

const MOBILE = 390;

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetHistoryIdx();
});

const location = () => screen.getByTestId('location').textContent;
const karlRow = () => document.querySelector<HTMLElement>(`main [data-runner-id="${OTHER.id}"]`);
const backLink = () => screen.findByRole('link', { name: /Standings/ });

describe('Back from the runner page on a phone', () => {
  it('puts the focus on the runner row of the page before, not on the body', async () => {
    renderWithApp(<AppRoutes />, { entry: ['/board?view=week', `/runner/${OTHER.id}`], width: MOBILE, history: true });

    fireEvent.click(await backLink());

    await waitFor(() => expect(location()).toBe('/board?view=week'));
    await waitFor(() => expect(karlRow()).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('falls back on the main heading when the page before has no row for the runner', async () => {
    renderWithApp(<AppRoutes />, { entry: ['/titles', `/runner/${OTHER.id}`], width: MOBILE, history: true });

    fireEvent.click(await backLink());

    await waitFor(() => expect(location()).toBe('/titles'));
    const heading = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(heading).toHaveFocus(), { timeout: 3000 });
  });

  it('does not take the focus when the page is left by a link instead of Back', async () => {
    renderWithApp(<AppRoutes />, { entry: ['/board', `/runner/${OTHER.id}`], width: MOBILE, history: true });
    await backLink();

    fireEvent.click(screen.getByRole('link', { name: /Challenges|Duels/ }));

    await waitFor(() => expect(location()).toMatch(/^\/duels/));
    expect(karlRow()).toBeNull();
    expect(document.activeElement === document.body || !document.activeElement?.hasAttribute('data-runner-id')).toBe(true);
  });
});

describe('the runner page heading on entry', () => {
  it('scrolls into view: the focus call does not ask the browser to keep the scroll position', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    renderWithApp(<AppRoutes />, { entry: ['/board', `/runner/${OTHER.id}`], width: MOBILE, history: true });

    const heading = await screen.findByRole('heading', { level: 1, name: OTHER.name });
    await waitFor(() => expect(heading).toHaveFocus());

    const options = focus.mock.calls.filter((_args, index) => focus.mock.contexts[index] === heading).map(([argument]) => argument);
    expect(options.length).toBeGreaterThan(0);
    expect(options).not.toContainEqual({ preventScroll: true });
  });
});
