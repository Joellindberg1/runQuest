import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { User } from '@runquest/types';
import type { PositionHistoryResponse } from '@runquest/shared';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { ProfileScreen } from './ProfileScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/badges/api', () => ({ badgesApi: { getUserBadges: vi.fn().mockResolvedValue({ items: [], showcase: [] }), getGroupBadges: vi.fn().mockResolvedValue({ members: [], holders: {}, member_count: 1 }), saveShowcase: vi.fn() } }));
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Profilens flikrad över `?view=`: Position är den femte fliken, men bara för en grupp på minst två medlemmar. Antalet kommer ur users-with-runs
// (samma svar som profilen redan väntar på), så en grupp på en får fliken dold och adressen faller tillbaka utan en enda positionsbegäran.

const getPositionHistory = vi.fn();
const mine: User = { ...ME, runs: [] };

const history = (): PositionHistoryResponse => ({
  as_of: '2026-10-04',
  weeks: [
    { start: '2026-09-21', end: '2026-09-27', iso_week: 39, iso_year: 2026, is_current_week: false },
    { start: '2026-09-28', end: '2026-10-04', iso_week: 40, iso_year: 2026, is_current_week: true },
  ],
  runners: [
    { user_id: ME.id, name: ME.name, profile_picture: null, member_since: null, positions: [1, 2] },
    { user_id: OTHER.id, name: OTHER.name, profile_picture: null, member_since: null, positions: [2, 1] },
  ],
});

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;
const heroName = () => screen.findByRole('heading', { level: 1, name: 'Joel Lindberg' });

beforeEach(() => {
  resetFakeBackend();
  getPositionHistory.mockReset();
  getPositionHistory.mockResolvedValue({ success: true, data: history() });
  handlers.getPositionHistory = getPositionHistory;
  handlers.getUsersWithRuns = () => ({ success: true, data: [mine, OTHER] });
});

describe('Profile — the Position tab and ?view=', () => {
  it('position tab is hidden and the param falls back with one member', async () => {
    handlers.getUsersWithRuns = () => ({ success: true, data: [mine] });
    renderWithApp(<ProfileScreen />, { entry: '/profile?view=position', width: 1280 });
    await heroName();

    expect(tabNames()).toEqual(['Distance', 'Streak', 'Fun facts', 'Consistency']);
    expect(selectedTab()).toBe('Distance');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Longest run');
    expect(getPositionHistory).not.toHaveBeenCalled();
  });

  it('opens Position from ?view=position with two members and fetches eight weeks once', async () => {
    renderWithApp(<ProfileScreen />, { entry: '/profile?view=position', width: 1280 });
    await heroName();

    expect(tabNames()).toEqual(['Distance', 'Streak', 'Fun facts', 'Consistency', 'Position']);
    expect(selectedTab()).toBe('Position');
    expect(await screen.findByRole('img', { name: /^Position in the group, weeks 39 to 40/ })).toBeInTheDocument();
    expect(getPositionHistory).toHaveBeenCalledExactlyOnceWith(8);
  });

  it('writes ?view=position when the Position tab is clicked and requests nothing before that', async () => {
    renderWithApp(<ProfileScreen />, { entry: '/profile', width: 390 });
    await heroName();
    expect(getPositionHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Position' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/profile?view=position');
    expect(await screen.findByRole('img', { name: /^Position in the group/ })).toBeInTheDocument();
    expect(getPositionHistory).toHaveBeenCalledExactlyOnceWith(8);
  });

  it('sends no position request on the four other tabs, one after the other', async () => {
    renderWithApp(<ProfileScreen />, { entry: '/profile', width: 390 });
    await heroName();

    for (const name of ['Streak', 'Fun facts', 'Consistency', 'Distance']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(selectedTab()).toBe(name);
    }

    expect(getPositionHistory).not.toHaveBeenCalled();
  });

  it('falls back to Distance for an unknown value, as before', async () => {
    renderWithApp(<ProfileScreen />, { entry: '/profile?view=nonsense', width: 1280 });
    await heroName();

    expect(selectedTab()).toBe('Distance');
    expect(getPositionHistory).not.toHaveBeenCalled();
  });

  it('keeps the other tabs working through the address (?view=consistency, ?view=fun)', async () => {
    const { unmount } = renderWithApp(<ProfileScreen />, { entry: '/profile?view=consistency', width: 1280 });
    await heroName();
    expect(selectedTab()).toBe('Consistency');
    unmount();

    renderWithApp(<ProfileScreen />, { entry: '/profile?view=fun', width: 1280 });
    await heroName();
    expect(selectedTab()).toBe('Fun facts');
  });
});
