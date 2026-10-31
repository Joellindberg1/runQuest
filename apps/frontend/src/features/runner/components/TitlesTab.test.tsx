import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@runquest/types';
import type { TitleLeaderboardEntry, UserTitleEntry } from '@runquest/shared';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { PopupTitlesPanel } from './PopupTitlesPanel';
import { RunnerPopup } from './RunnerPopup';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 2 }),
  },
}));

// The Titles held tab of the profile popup: the runner's titles with a type filter built from the categories the titles are in.

const DESKTOP = 1280;
const noop = () => {};

const runnerOf = (id: string, name: string): User => ({
  ...ME, id, name, total_xp: 5539, total_km: 400, current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 2, runs: [], challenge_counts: {},
});
const KARL = runnerOf('u-karl', 'Karl Persson');
const ADAM = runnerOf('u-adam', 'Adam Einstein');
const BEN = runnerOf('u-ben', 'Ben Holm');

const ut = (over: Partial<UserTitleEntry> & Pick<UserTitleEntry, 'title_id' | 'title_name'>): UserTitleEntry => ({
  title_description: '', position: 1, value: 0, earned_at: '', is_current_holder: true, status: 'holder', ...over,
});
const entry = (id: string, metric: string, holder: { name: string; value: number }): TitleLeaderboardEntry => ({
  id, name: id, description: '', unlock_requirement: 0, metric_key: metric,
  holder: { user_id: 'h', user_name: holder.name, value: holder.value, earned_at: '' }, runners_up: [],
});

// The data order (consistency, distance, time, distance) is not the order of TITLE_CATEGORIES (time, distance, pace, ..., consistency).
const KARL_TITLES: UserTitleEntry[] = [
  ut({ title_id: 't-goggins', title_name: 'The Daaaaaviiiiid Goggins', value: 44 }),
  ut({ title_id: 't-long', title_name: 'The Longest Run', value: 32.8 }),
  ut({ title_id: 't-rooster', title_name: 'The Rooster', value: 56 }),
  ut({ title_id: 't-monster', title_name: 'The Monthly Monster', value: 181.4 }),
  ut({ title_id: 't-batman', title_name: 'The Batman', value: 11, position: 2, is_current_holder: false, status: 'runner_up' }),
  ut({ title_id: 't-kipchoge', title_name: 'The Kipchoge', value: 0, position: 3, is_current_holder: false, status: 'runner_up' }),
];
const ADAM_TITLES: UserTitleEntry[] = [ut({ title_id: 't-park', title_name: 'The Park Runner', value: 61 })];
const BEN_TITLES: UserTitleEntry[] = [ut({ title_id: 't-park', title_name: 'The Park Runner', value: 61 }), ut({ title_id: 't-long', title_name: 'The Longest Run', value: 40 })];
const TITLE_BOARD: TitleLeaderboardEntry[] = [
  entry('t-goggins', 'longestStreak', { name: 'Karl Persson', value: 44 }),
  entry('t-long', 'longestRun', { name: 'Karl Persson', value: 32.8 }),
  entry('t-rooster', 'earlyRunCount', { name: 'Karl Persson', value: 56 }),
  entry('t-monster', 'maxKmRolling30', { name: 'Karl Persson', value: 181.4 }),
  entry('t-batman', 'nightRunCount', { name: 'Nicklas von Elling', value: 18 }),
  entry('t-kipchoge', 'fastest5km', { name: 'Adam Einstein', value: 1 }),
  entry('t-park', 'earlyRunCount', { name: 'Adam Einstein', value: 61 }),
];

let karlTitles = KARL_TITLES;

beforeEach(() => {
  resetFakeBackend();
  karlTitles = KARL_TITLES;
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, KARL, ADAM, BEN] });
  handlers.getUserTitles = (id: unknown) => ({ success: true, data: id === KARL.id ? karlTitles : id === BEN.id ? BEN_TITLES : ADAM_TITLES });
  handlers.getTitleLeaderboard = () => ({ success: true, data: TITLE_BOARD });
  handlers.getHeadToHead = () => ({
    success: true,
    data: { opponent: { id: KARL.id, name: KARL.name, profile_picture: null }, record: { wins: 1, draws: 0, losses: 0, total: 1 }, history: [], active: null },
  });
});

const popup = (runner: User) => <RunnerPopup id={runner.id} runner={runner} users={[ME, KARL, ADAM, BEN]} failure={null} failed={false} onClose={noop} />;

/** Opens the popup for a runner and selects Titles held. */
async function openTitles(runner = KARL) {
  const rendered = renderWithApp(popup(runner), { entry: `/runner/${runner.id}`, width: DESKTOP });
  await screen.findByRole('heading', { level: 1, name: runner.name });
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Titles held' }));
  return { ...rendered, section: await screen.findByRole('region', { name: 'Titles' }) };
}

const filterGroup = (section: HTMLElement) => within(section).getByRole('group', { name: 'Titles filter' });
const filterLabels = (section: HTMLElement) => within(filterGroup(section)).getAllByRole('button').map((button) => button.textContent);
const pressed = (section: HTMLElement) =>
  within(filterGroup(section)).getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent);
const choose = (section: HTMLElement, name: string) => userEvent.click(within(filterGroup(section)).getByRole('button', { name }));
const heldNames = (section: HTMLElement) =>
  within(section).queryByRole('list', { name: 'Titles held' })
    ? within(within(section).getByRole('list', { name: 'Titles held' })).getAllByRole('listitem').map((item) => item.querySelector('.rq-runner-title__name')?.textContent)
    : [];
const runnerUpNames = (section: HTMLElement) =>
  within(section).queryByRole('list', { name: 'Runner-up titles' })
    ? within(within(section).getByRole('list', { name: 'Runner-up titles' })).getAllByRole('listitem').map((item) => item.querySelector('.rq-runner-title__name')?.textContent)
    : [];

describe('the Titles held tab of the popup', () => {
  it('titles filter lists only categories the runner holds', async () => {
    const { section } = await openTitles();

    // "All" first, then the categories of the held and the runner-up titles in the fixed order of TITLE_CATEGORIES (not the order of the data); Pace comes from a runner-up title.
    expect(filterLabels(section)).toEqual(['All', 'Time of day', 'Distance', 'Pace', 'Consistency']);
    expect(pressed(section)).toEqual(['All']);
    for (const absent of ['Elevation', 'Volume', 'Comeback', 'Weather', 'Other']) {
      expect(within(filterGroup(section)).queryByRole('button', { name: absent })).toBeNull();
    }
    expect(within(section).queryByRole('tablist')).toBeNull();
  });

  it('filtering by a category shows only its titles and updates the count', async () => {
    const { section } = await openTitles();

    expect(within(section).getByRole('heading', { name: 'TITLES HELD' })).toBeInTheDocument();
    expect(within(section).getByText('4 held')).toBeInTheDocument();
    expect(heldNames(section)).toEqual(['The Daaaaaviiiiid Goggins', 'The Longest Run', 'The Rooster', 'The Monthly Monster']);
    expect(runnerUpNames(section)).toEqual(['The Batman', 'The Kipchoge']);

    await choose(section, 'Distance');
    expect(pressed(section)).toEqual(['Distance']);
    expect(heldNames(section)).toEqual(['The Longest Run', 'The Monthly Monster']);
    expect(within(section).getByText('2 held')).toBeInTheDocument();
    expect(within(section).queryByText('4 held')).toBeNull();
    expect(within(section).queryByRole('heading', { name: /^Runner-up/ })).toBeNull();

    await choose(section, 'Time of day');
    expect(heldNames(section)).toEqual(['The Rooster']);
    expect(within(section).getByText('1 held')).toBeInTheDocument();
    // The Runner-up section follows the same category.
    expect(within(section).getByRole('heading', { name: 'Runner-up · 1' })).toBeInTheDocument();
    expect(runnerUpNames(section)).toEqual(['The Batman']);

    await choose(section, 'All');
    expect(pressed(section)).toEqual(['All']);
    expect(within(section).getByText('4 held')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'Runner-up · 2' })).toBeInTheDocument();
  });

  it('keeps the note above the Runner-up list when a category has only runner-up titles', async () => {
    const { section } = await openTitles();

    await choose(section, 'Pace');

    expect(within(section).getByText('0 held')).toBeInTheDocument();
    expect(within(section).getByText('No titles held yet.')).toBeInTheDocument();
    expect(runnerUpNames(section)).toEqual(['The Kipchoge']);
    expect(within(section).queryByText('No titles of this type.')).toBeNull();
  });

  it('draws each held title with its name, its type and its value', async () => {
    const { section } = await openTitles();

    const rows = within(within(section).getByRole('list', { name: 'Titles held' })).getAllByRole('listitem');
    const read = (row: HTMLElement) => [
      row.querySelector('.rq-runner-title__name')?.textContent,
      row.querySelector('.rq-runner-title__type')?.textContent,
      row.querySelector('.rq-runner-title__value')?.textContent,
    ];
    expect(rows.map(read)).toEqual([
      ['The Daaaaaviiiiid Goggins', 'Consistency', '44 days'],
      ['The Longest Run', 'Distance', '32.8 km'],
      ['The Rooster', 'Time of day', '56 runs'],
      ['The Monthly Monster', 'Distance', '181.4 km'],
    ]);
  });

  it('keeps the Runner-up rows as they are: who holds the title and the distance to it', async () => {
    const { section } = await openTitles();

    const [batman] = within(within(section).getByRole('list', { name: 'Runner-up titles' })).getAllByRole('listitem');
    expect(batman).toHaveTextContent('The Batman');
    expect(batman).toHaveTextContent('held by Nicklas von Elling');
    expect(batman).toHaveTextContent('7 runs');
  });

  it('shows the invitation text and no filter for a runner without titles', async () => {
    karlTitles = [];
    const { section } = await openTitles();

    expect(await within(section).findByText('No titles yet — Karl is still chasing the first one.')).toBeInTheDocument();
    expect(within(section).queryByRole('group', { name: 'Titles filter' })).toBeNull();
    expect(within(section).queryByRole('list')).toBeNull();
  });

  it('hides the filter for a runner whose titles are all in one category, and keeps the list', async () => {
    const { section } = await openTitles(ADAM);

    expect(within(section).queryByRole('group', { name: 'Titles filter' })).toBeNull();
    expect(await within(section).findByText('1 held')).toBeInTheDocument();
    expect(heldNames(section)).toEqual(['The Park Runner']);
  });

  it('shows the loading and the error states as before, without a filter', async () => {
    let fail = true;
    handlers.getUserTitles = () => (fail ? { success: false, error: 'boom' } : { success: true, data: KARL_TITLES });
    const { section } = await openTitles();

    expect(await within(section).findByText("Couldn't load titles")).toBeInTheDocument();
    expect(within(section).queryByRole('group', { name: 'Titles filter' })).toBeNull();
    expect(within(section).queryByText(/No titles/)).toBeNull();

    fail = false;
    await userEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(await within(section).findByText('4 held')).toBeInTheDocument();
  });

  it('shows the error card with Retry, and no title typed Other, when the title board fails', async () => {
    let boardFails = true;
    const calls = { titles: 0, board: 0 };
    handlers.getUserTitles = () => {
      calls.titles += 1;
      return { success: true, data: KARL_TITLES };
    };
    handlers.getTitleLeaderboard = () => {
      calls.board += 1;
      return boardFails ? { success: false, error: 'boom' } : { success: true, data: TITLE_BOARD };
    };
    const { section } = await openTitles();

    expect(await within(section).findByText("Couldn't load titles")).toBeInTheDocument();
    expect(within(section).queryByText('Other')).toBeNull();
    expect(section.querySelector('.rq-runner-title__type')).toBeNull();
    expect(within(section).queryByRole('group', { name: 'Titles filter' })).toBeNull();
    expect(within(section).queryByText(/No titles/)).toBeNull();

    boardFails = false;
    const before = { ...calls };
    await userEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    expect(await within(section).findByText('4 held')).toBeInTheDocument();
    // Retry fetches both the title board and the runner's titles again.
    expect(calls.board).toBe(before.board + 1);
    expect(calls.titles).toBe(before.titles + 1);
    expect(filterLabels(section)).toEqual(['All', 'Time of day', 'Distance', 'Pace', 'Consistency']);
    expect(within(section).queryByText('Other')).toBeNull();
    expect(within(within(section).getByRole('list', { name: 'Titles held' })).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'The Daaaaaviiiiid GogginsConsistency44 days',
      'The Longest RunDistance32.8 km',
      'The RoosterTime of day56 runs',
      'The Monthly MonsterDistance181.4 km',
    ]);
  });

  it('shows the loading oval while the titles load', async () => {
    handlers.getUserTitles = () => new Promise(() => {});
    const { section } = await openTitles();

    expect(within(section).getByText('Loading titles')).toBeInTheDocument();
    expect(within(section).queryByRole('group', { name: 'Titles filter' })).toBeNull();
  });
});

describe('the title panel when the chosen category has no title', () => {
  it('says "No titles of this type." and draws neither list', async () => {
    renderWithApp(<PopupTitlesPanel user={KARL} filter="weather" onFilterChange={noop} />, { width: DESKTOP });

    const section = await screen.findByRole('region', { name: 'Titles' });
    expect(await within(section).findByText('No titles of this type.')).toBeInTheDocument();
    expect(within(section).queryByRole('list')).toBeNull();
    expect(within(section).queryByRole('heading', { name: /^Runner-up/ })).toBeNull();
    expect(within(section).getByText('0 held')).toBeInTheDocument();
    // The filter stays, with nothing pressed, so that the way back to "All" is still there.
    expect(pressed(section)).toEqual([]);
  });

  it('keeps the filter when a choice is still made but only one category is left, so that the way back to "All" exists', async () => {
    renderWithApp(<PopupTitlesPanel user={ADAM} filter="distance" onFilterChange={noop} />, { width: DESKTOP });

    const section = await screen.findByRole('region', { name: 'Titles' });
    expect(await within(section).findByText('No titles of this type.')).toBeInTheDocument();
    expect(filterLabels(section)).toEqual(['All', 'Time of day']);
  });

  it('reports the choice to the owner of the state', async () => {
    const onFilterChange = vi.fn();
    renderWithApp(<PopupTitlesPanel user={KARL} filter="all" onFilterChange={onFilterChange} />, { width: DESKTOP });

    const section = await screen.findByRole('region', { name: 'Titles' });
    await within(section).findByText('4 held');
    await choose(section, 'Consistency');

    expect(onFilterChange).toHaveBeenCalledWith('consistency');
  });
});

describe('the tab panel of the popup', () => {
  it('is the same single tab stop on Overview and on Titles held (the scrolling list adds its own only when it scrolls)', async () => {
    const { section } = await openTitles();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('tabindex', '0');
    expect(panel.contains(section)).toBe(true);

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });
});

describe('the title filter across openings', () => {
  it('starts on "All" at every opening', async () => {
    const first = await openTitles();
    await choose(first.section, 'Distance');
    expect(pressed(first.section)).toEqual(['Distance']);
    first.unmount();

    const second = await openTitles();
    expect(pressed(second.section)).toEqual(['All']);
    expect(heldNames(second.section)).toHaveLength(4);
  });

  it('starts on "All" for another runner, and keeps the choice while the tabs are switched', async () => {
    let switchRunner: (runner: User) => void = noop;
    function Host() {
      const [runner, setRunner] = useState(KARL);
      switchRunner = setRunner;
      return popup(runner);
    }
    renderWithApp(<Host />, { entry: `/runner/${KARL.id}`, width: DESKTOP });
    await screen.findByRole('heading', { level: 1, name: 'Karl Persson' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Titles held' }));
    let section = await screen.findByRole('region', { name: 'Titles' });
    await choose(section, 'Consistency');

    await user.click(screen.getByRole('tab', { name: 'Badges' }));
    await user.click(screen.getByRole('tab', { name: 'Titles held' }));
    section = await screen.findByRole('region', { name: 'Titles' });
    expect(pressed(section)).toEqual(['Consistency']);
    expect(heldNames(section)).toEqual(['The Daaaaaviiiiid Goggins']);

    act(() => switchRunner(BEN));
    await screen.findByRole('heading', { level: 1, name: 'Ben Holm' });
    await user.click(screen.getByRole('tab', { name: 'Titles held' }));
    section = await screen.findByRole('region', { name: 'Titles' });
    expect(await within(section).findByText('2 held')).toBeInTheDocument();
    expect(pressed(section)).toEqual(['All']);
  });
});

describe('the scrolling list of the Titles held tab', () => {
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
  const isList = (element: Element) => element.classList.contains('rq-runner-titles__scroll');
  const listFor = (section: HTMLElement) => within(section).getByRole('region', { name: 'Title list' });

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
    const { section } = await openTitles();
    expect(listFor(section)).toHaveAttribute('tabindex', '0');

    layout.scroll = 300;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(listFor(section)).not.toHaveAttribute('tabindex');
  });

  it('is measured again when the filter changes what it holds', async () => {
    layout.scroll = 640;
    const { section } = await openTitles();
    expect(listFor(section)).toHaveAttribute('tabindex', '0');

    layout.scroll = 300;
    await choose(section, 'Time of day');
    expect(listFor(section)).not.toHaveAttribute('tabindex');
  });

  it('has the filter outside of the scrolling part, so that the filter stays', async () => {
    const { section } = await openTitles();

    expect(listFor(section).contains(filterGroup(section))).toBe(false);
    expect(listFor(section).contains(within(section).getByRole('list', { name: 'Titles held' }))).toBe(true);
    expect(listFor(section).contains(within(section).getByRole('list', { name: 'Runner-up titles' }))).toBe(true);
  });
});
