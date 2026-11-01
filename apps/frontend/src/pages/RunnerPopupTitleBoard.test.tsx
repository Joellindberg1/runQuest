import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TitleLeaderboardEntry, UserTitleEntry } from '@runquest/shared';
import { AppRoutes } from '@/routes';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { warmRunnerPopup } from '@/test/warmLazy';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// The popup opened from Board: the Titles held panel reads the title board (type and unit of each title), and it is read once.

const DESKTOP = 1280;
const BACKGROUND = { pathname: '/board', search: '?view=week', hash: '', state: null, key: 'bg' };
const popupOverBoard = ['/board?view=week', { pathname: `/runner/${OTHER.id}`, state: { background: BACKGROUND } }];

const TITLES: UserTitleEntry[] = [
  { title_id: 't-long', title_name: 'The Longest Run', title_description: '', position: 1, value: 32.8, earned_at: '', is_current_holder: true, status: 'holder' },
];
const BOARD: TitleLeaderboardEntry[] = [
  {
    id: 't-long', name: 'The Longest Run', description: '', unlock_requirement: 0, metric_key: 'longestRun',
    holder: { user_id: OTHER.id, user_name: OTHER.name, value: 32.8, earned_at: '' }, runners_up: [],
  },
];

beforeAll(warmRunnerPopup);

let boardCalls = 0;

beforeEach(() => {
  resetFakeBackend();
  boardCalls = 0;
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: TITLES });
  handlers.getTitleLeaderboard = () => {
    boardCalls += 1;
    return { success: true, data: BOARD };
  };
});

describe('the popup opened from Board', () => {
  it('reads the title board once for the Titles held tab, and not before the tab opens', async () => {
    renderWithApp(<AppRoutes />, { entry: popupOverBoard as never, width: DESKTOP, history: true });
    const dialog = await screen.findByRole('dialog', { name: `Runner card: ${OTHER.name}` });
    await within(dialog).findByRole('heading', { level: 1, name: OTHER.name });
    expect(boardCalls).toBe(0);

    await userEvent.setup().click(within(dialog).getByRole('tab', { name: 'Titles held' }));
    const section = await within(dialog).findByRole('region', { name: 'Titles' });
    expect(await within(section).findByText('1 held')).toBeInTheDocument();

    expect(within(section).getByText('32.8 km')).toBeInTheDocument();
    expect(boardCalls).toBe(1);
  });
});
