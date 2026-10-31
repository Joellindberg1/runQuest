import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@runquest/types';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES, requirementText } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '@/features/badges/api';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { RunnerPopup } from './RunnerPopup';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
const badgesApi = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));

// The Badges tab of the profile popup: the runner's earned series as read-only explanation cards.

const DESKTOP = 1280;
const noop = () => {};
// Queries retry once, quickly, before the error state shows.
const SLOW = { timeout: 4000 };

const KARL: User = {
  ...ME, id: 'u-karl', name: 'Karl Persson', total_xp: 5539, total_km: 400, current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 2, runs: [], challenge_counts: {},
};
const PACK = [ME, KARL];

const [milestoner, earthTrotter, climber, streakKeeper, earlyBird, nightOwl, speedster, precisionist] = BADGE_SERIES;
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z' });
// Four earned series; the other four are locked. Streak Keeper is at the top tier. Two series are on display.
const EARNED: readonly BadgeUserItem[] = [item(climber.key, 2), item(milestoner.key, 3), item(streakKeeper.key, MAX_TIER), item(nightOwl.key, 1)];
const KARL_BADGES: BadgeUserResponse = { items: [...EARNED], showcase: [milestoner.key, nightOwl.key] };
const LOCKED = [earthTrotter, earlyBird, speedster, precisionist];

function groupOf(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}
// Even the locked series have numbers in the grid: they must never show.
const GROUP = groupOf({ [milestoner.key]: 5, [climber.key]: 4, [streakKeeper.key]: 2, [nightOwl.key]: 6, [earthTrotter.key]: 3 });

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({
    success: true,
    data: { opponent: { id: KARL.id, name: KARL.name, profile_picture: null }, record: { wins: 1, draws: 0, losses: 0, total: 1 }, history: [], active: null },
  });
  badgesApi.getUserBadges.mockReset();
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getUserBadges.mockResolvedValue(KARL_BADGES);
  badgesApi.getGroupBadges.mockResolvedValue(GROUP);
});

const popup = () => <RunnerPopup id={KARL.id} runner={KARL} users={PACK} failure={null} failed={false} onClose={noop} />;

/** Opens the popup for Karl and selects Badges; resolves when the panel is there (it may still be loading). */
async function openBadges() {
  const rendered = renderWithApp(popup(), { entry: `/runner/${KARL.id}`, width: DESKTOP });
  await screen.findByRole('heading', { level: 1, name: KARL.name });
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Badges' }));
  return { ...rendered, section: await screen.findByRole('region', { name: 'Badges' }) };
}
/** Same, and waits for the cards. */
async function openBadgeCards() {
  const opened = await openBadges();
  const list = await within(opened.section).findByRole('list', { name: 'Earned badges' });
  return { ...opened, list };
}

const cardNames = (list: HTMLElement) => within(list).getAllByRole('listitem').map((card) => within(card).getByRole('heading', { level: 3 }).textContent);

describe('the Badges tab of the popup', () => {
  it('badges tab shows only earned series', async () => {
    const { section, list } = await openBadgeCards();

    // On display first (in the runner's order), then the highest tier, then the order of the series.
    expect(cardNames(list)).toEqual([milestoner.name, nightOwl.name, streakKeeper.name, climber.name]);
    expect(within(section).getByRole('heading', { level: 2, name: 'BADGES' })).toBeInTheDocument();
    expect(within(section).getByText(`4 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();

    for (const series of LOCKED) {
      expect(within(section).queryByText(series.name), `${series.name} is locked and not shown`).toBeNull();
      expect(within(section).queryByText(series.metricLabel)).toBeNull();
    }
    expect(within(section).queryByText('Locked')).toBeNull();
    expect(within(section).queryByText(/^Unlock:/)).toBeNull();
    expect(list.querySelectorAll('[data-state="locked"]')).toHaveLength(0);
  });

  it('each card has the name, the tier chip, the tier pips, the requirement and the held-by line, and nothing to press', async () => {
    const { list } = await openBadgeCards();
    const cards = within(list).getAllByRole('listitem');

    const milestonerCard = cards[0] as HTMLElement;
    expect(within(milestonerCard).getByText(TIER_NAMES[2])).toHaveAttribute('data-tier', 'rare');
    expect(within(milestonerCard).getByRole('img', { name: 'Tier 3 of 6' })).toBeInTheDocument();
    expect(within(milestonerCard).getByText(requirementText(milestoner, 3))).toBeInTheDocument();
    expect(within(milestonerCard).getByText('Held by 5 of 6 in your pack')).toBeInTheDocument();
    // Night Owl: held by all six, which says nothing on somebody else's card. Streak Keeper: held by two of six.
    expect(within(cards[1] as HTMLElement).queryByText(/in your pack/)).toBeNull();
    expect(within(cards[2] as HTMLElement).getByText('Held by 2 of 6 in your pack')).toBeInTheDocument();
    expect(within(cards[2] as HTMLElement).getByRole('img', { name: 'Tier 6 of 6' })).toBeInTheDocument();

    // Read-only: no switch, no button, nothing in the tab order.
    expect(within(list).queryByRole('button')).toBeNull();
    expect(list.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    expect(within(list).queryByText(/^Show$|On display/)).toBeNull();
    // The cards are the explanation: no flavor, no Next, no top-tier line.
    expect(list.querySelector('.rq-badge-card__flavor, .rq-badge-card__next, .rq-badge-card__max')).toBeNull();
  });

  it('reads each card once: the emblem is decorative and the name, the tier and the requirement are text', async () => {
    const { list } = await openBadgeCards();
    for (const card of within(list).getAllByRole('listitem')) {
      expect(card.querySelector('.rq-badge--md')).toHaveAttribute('aria-hidden', 'true');
      expect(within(card).queryByRole('img', { name: /^(Common|Uncommon|Rare|Heroic|Epic|Legendary) / })).toBeNull();
    }
    expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(EARNED.length);
  });

  it('the emblems are the 56 px ones of the collection cards', async () => {
    const { list } = await openBadgeCards();
    expect(list.querySelectorAll('.rq-badge--md')).toHaveLength(EARNED.length);
    expect(list.querySelectorAll('.rq-badge--cp, .rq-badge--sm, .rq-badge--lg')).toHaveLength(0);
  });

  it('a runner without badges gets "No badges yet." and no count', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ items: [], showcase: [] });
    const { section } = await openBadges();

    expect(await within(section).findByText('No badges yet.')).toBeInTheDocument();
    expect(within(section).queryByRole('list', { name: 'Earned badges' })).toBeNull();
    expect(within(section).queryByText(/of \d+ series$/)).toBeNull();
  });

  it('shows the loader while the badges load', async () => {
    badgesApi.getUserBadges.mockReturnValue(new Promise(() => {}));
    const { section } = await openBadges();

    expect(await within(section).findByRole('status')).toHaveTextContent('Loading badges');
    expect(within(section).queryByText('No badges yet.')).toBeNull();
    expect(within(section).queryByText(/of \d+ series$/)).toBeNull();
  });

  it('shows an error card with Retry instead of the empty state, and Retry fetches again', async () => {
    badgesApi.getUserBadges.mockRejectedValue(new Error('boom'));
    const { section } = await openBadges();

    expect(await within(section).findByText("Couldn't load badges", undefined, SLOW)).toBeInTheDocument();
    expect(within(section).queryByText('No badges yet.')).toBeNull();

    badgesApi.getUserBadges.mockResolvedValue(KARL_BADGES);
    await userEvent.setup().click(within(section).getByRole('button', { name: 'Retry' }));
    const list = await within(section).findByRole('list', { name: 'Earned badges' }, SLOW);
    expect(within(list).getAllByRole('listitem')).toHaveLength(EARNED.length);
    expect(within(section).queryByText("Couldn't load badges")).toBeNull();
  });

  it('leaves the held-by line out, without a placeholder, when the group data fails', async () => {
    badgesApi.getGroupBadges.mockRejectedValue(new Error('boom'));
    const { list } = await openBadgeCards();
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());

    expect(within(list).getAllByRole('listitem')).toHaveLength(EARNED.length);
    expect(within(list).queryByText(/in your pack/)).toBeNull();
    expect(list.querySelector('.rq-badge-card__held, .rq-badge-card__foot')).toBeNull();
  });

  it('opening the tab asks for nothing: the data is the one the banner already fetched', async () => {
    renderWithApp(popup(), { entry: `/runner/${KARL.id}`, width: DESKTOP });
    await screen.findByRole('heading', { level: 1, name: KARL.name });
    await screen.findByRole('img', { name: /^Badges:/ });
    await waitFor(() => expect(badgesApi.getGroupBadges).toHaveBeenCalled());
    const before = { user: badgesApi.getUserBadges.mock.calls.length, group: badgesApi.getGroupBadges.mock.calls.length };
    expect(before).toEqual({ user: 1, group: 1 });

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Badges' }));
    await within(await screen.findByRole('region', { name: 'Badges' })).findByRole('list', { name: 'Earned badges' });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Overview' }));
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Badges' }));

    expect({ user: badgesApi.getUserBadges.mock.calls.length, group: badgesApi.getGroupBadges.mock.calls.length }).toEqual(before);
    expect(badgesApi.getUserBadges).toHaveBeenCalledWith(KARL.id);
  });

  it('the showcase minis of the banner are the picks (three at most) and do not follow the cards', async () => {
    const many: BadgeUserResponse = {
      items: [item(milestoner.key, 3), item(climber.key, 2), item(streakKeeper.key, MAX_TIER), item(nightOwl.key, 1), item(speedster.key, 4)],
      showcase: [milestoner.key, climber.key, streakKeeper.key],
    };
    badgesApi.getUserBadges.mockResolvedValue(many);
    const { list } = await openBadgeCards();

    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    const minis = screen.getByRole('img', { name: /^Badges:/ });
    expect(minis.querySelectorAll('.rq-badge--sm')).toHaveLength(3);
  });

  it('a runner with earned series and no picks has cards and no minis', async () => {
    badgesApi.getUserBadges.mockResolvedValue({ items: [...EARNED], showcase: [] });
    const { list, container } = await openBadgeCards();

    expect(within(list).getAllByRole('listitem')).toHaveLength(EARNED.length);
    expect(container.querySelector('.rq-badge-minis')).toBeNull();
    expect(screen.queryByRole('img', { name: /^Badges:/ })).toBeNull();
  });

  it('is one tab panel with one tab stop of its own, and the page-sized BADGES panel is not used', async () => {
    const { section } = await openBadgeCards();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('tabindex', '0');
    expect(panel.contains(section)).toBe(true);
    expect(panel.querySelector('.rq-badge-panel')).toBeNull();
    expect(section.querySelector('.rq-badge-detail__trigger')).toBeNull();
  });
});

describe('the scrolling list of the Badges tab', () => {
  // jsdom has no layout: the list borrows its sizes, and a ResizeObserver the test drives says when they change.
  const layout = { client: 0, scroll: 0 };
  const resizeCallbacks = new Set<() => void>();
  class ControlledResizeObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe() {
      resizeCallbacks.add(this.callback);
    }
    unobserve() {}
    disconnect() {
      resizeCallbacks.delete(this.callback);
    }
  }
  const isList = (element: Element) => element.classList.contains('rq-runner-badges__scroll');
  const listFor = (section: HTMLElement) => within(section).getByRole('region', { name: 'Badge list' });

  beforeEach(() => {
    layout.client = 300;
    layout.scroll = 300;
    vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return isList(this) ? layout.client : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return isList(this) ? layout.scroll : 0; } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resizeCallbacks.clear();
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  });

  it('is a tab stop only when it scrolls', async () => {
    layout.scroll = 640;
    const { section } = await openBadgeCards();
    expect(listFor(section)).toHaveAttribute('tabindex', '0');

    layout.scroll = 300;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(listFor(section)).not.toHaveAttribute('tabindex');
  });

  it('has the heading outside of the scrolling part, so that the heading stays', async () => {
    const { section } = await openBadgeCards();

    expect(listFor(section).contains(within(section).getByRole('heading', { name: 'BADGES' }))).toBe(false);
    expect(listFor(section).contains(within(section).getByRole('list', { name: 'Earned badges' }))).toBe(true);
  });
});
