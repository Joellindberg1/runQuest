import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@runquest/types';
import { ME, XP_CONFIG, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { run, user } from '@/features/profile/profile.fixture';
import { StatsPanel as ProfileStatsPanel } from '@/features/profile/components/StatsPanel';
import { DEFAULT_OVERVIEW_VIEW } from '../popupSections';
import { buildStatCells } from '../runnerModel';
import { OverviewPanel } from './OverviewPanel';
import type { StatView } from '@/features/profile/statsModel';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// 12:00 i Stockholm, 2026-10-04.
const NOW = new Date('2026-10-04T10:00:00Z');
// Queries gör ett snabbt omförsök (~1 s) före felkortet.
const SLOW = { timeout: 4000 };

const KARL: User = user({
  id: 'u-karl',
  name: 'Karl Persson',
  total_xp: 5539,
  total_km: 46.2,
  current_streak: 8,
  longest_streak: 31,
  wins: 1,
  losses: 3,
  runs: [
    run({ id: 'k1', user_id: 'u-karl', date: '2026-10-03', distance: 12 }),
    run({ id: 'k2', user_id: 'u-karl', date: '2026-10-01', distance: 5 }),
    run({ id: 'k3', user_id: 'u-karl', date: '2026-09-20', distance: 32.8 }),
  ],
});

/** Värden äger valet i popupen (nollställs med resten vid öppning): här en liten värd med samma form. */
function Host({ runner = KARL }: { runner?: User }) {
  const [view, setView] = useState<StatView>(DEFAULT_OVERVIEW_VIEW);
  return <OverviewPanel user={runner} now={NOW} cells={buildStatCells(runner, 0)} view={view} onChange={setView} />;
}

const overview = () => screen.getByRole('group', { name: 'Overview' });
const choose = (name: string) => userEvent.click(within(overview()).getByRole('button', { name }));
const pressed = () => within(overview()).getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent);

/** Raderna i en lista som `{ etikett: värde }`; samma läsning för popupen och profilen. */
const rowsOf = (list: HTMLElement): Record<string, string | null> =>
  Object.fromEntries([...list.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling?.textContent ?? null]));

beforeEach(() => {
  resetFakeBackend();
});

describe('the Overview panel of the popup', () => {
  it('has a segmented control of Activity, Distance, Streak and Fun facts in that order, starting on Activity', () => {
    renderWithApp(<Host />, { width: 1280 });

    const buttons = within(overview()).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Activity', 'Distance', 'Streak', 'Fun facts']);
    expect(pressed()).toEqual(['Activity']);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('moves the pressed state with the choice, one at a time', async () => {
    renderWithApp(<Host />, { width: 1280 });

    for (const name of ['Distance', 'Streak', 'Fun facts', 'Activity']) {
      await choose(name);
      expect(pressed()).toEqual([name]);
    }
  });

  it('shows the activity map of the runner with "N runs in the last 12 months" and keeps the text summary in the region name', () => {
    renderWithApp(<Host />, { width: 1280 });

    expect(screen.getByText(/^runs in the last \d+ months$/).previousElementSibling).toHaveTextContent('3');
    expect(screen.getByRole('region', { name: /^Run heatmap: 3 runs on 3 of \d+ days$/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2026-09-20 · 32.8 km · 1 run' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Distance', { selector: 'dl' })).toBeNull();
  });

  it('shows the activity map without any run: zero runs, the text summary and no cell with a run', () => {
    renderWithApp(<Host runner={{ ...KARL, runs: [] }} />, { width: 1280 });

    expect(screen.getByText(/^runs in the last \d+ months$/).previousElementSibling).toHaveTextContent('0');
    expect(screen.getByRole('region', { name: /^Run heatmap: 0 runs on 0 of \d+ days$/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toEqual([]);
  });

  it('draws Distance, Streak and Fun facts with the same values as the profile for the same runner', async () => {
    const { unmount } = renderWithApp(<ProfileStatsPanel user={KARL} now={NOW} isDesktop view="distance" onChange={vi.fn()} label="Runner stats" />, { width: 1280 });
    const profile: Record<string, Record<string, string | null>> = { Distance: rowsOf(screen.getByLabelText('Distance', { selector: 'dl' })) };
    unmount();
    for (const [view, name] of [['streak', 'Streak'], ['fun', 'Fun facts']] as const) {
      const { unmount: next } = renderWithApp(<ProfileStatsPanel user={KARL} now={NOW} isDesktop view={view} onChange={vi.fn()} label="Runner stats" />, { width: 1280 });
      await waitFor(() => expect(screen.getByLabelText(name, { selector: 'dl' })).toBeInTheDocument(), SLOW);
      profile[name] = rowsOf(screen.getByLabelText(name, { selector: 'dl' }));
      next();
    }
    expect(profile.Distance).toMatchObject({ 'Longest run': '32.80 km' });

    renderWithApp(<Host />, { width: 1280 });
    await choose('Distance');
    expect(rowsOf(screen.getByLabelText('Distance', { selector: 'dl' }))).toEqual(profile.Distance);
    await choose('Streak');
    expect(rowsOf(await screen.findByLabelText('Streak', { selector: 'dl' }, SLOW))).toEqual(profile.Streak);
    await choose('Fun facts');
    const { 'Challenges won–lost': record, ...funFacts } = rowsOf(screen.getByLabelText('Fun facts', { selector: 'dl' }));
    expect(record).toBe('1–3');
    expect(funFacts).toEqual(profile['Fun facts']);
    expect(funFacts).toHaveProperty('Longest gap between runs');
  });

  it('fetches the streak tiers only when Streak is shown', async () => {
    const getXpConfig = vi.fn(() => ({ success: true, data: XP_CONFIG }));
    handlers.getXpConfig = getXpConfig;
    renderWithApp(<Host />, { width: 1280 });

    await choose('Distance');
    await choose('Fun facts');
    expect(getXpConfig).not.toHaveBeenCalled();

    await choose('Streak');
    expect(await screen.findByLabelText('Streak', { selector: 'dl' }, SLOW)).toBeInTheDocument();
    expect(getXpConfig).toHaveBeenCalledTimes(1);
  });

  it('shows a loader while the streak tiers load and an error card with Retry when they fail', async () => {
    let state: 'loading' | 'fail' | 'ok' = 'loading';
    let release: () => void = () => {};
    handlers.getXpConfig = () => {
      if (state === 'loading') return new Promise((resolve) => { release = () => resolve({ success: true, data: XP_CONFIG }); });
      return state === 'fail' ? { success: false, error: 'boom' } : { success: true, data: XP_CONFIG };
    };
    const first = renderWithApp(<Host />, { width: 1280 });
    await choose('Streak');
    expect(await screen.findByText('Loading streak')).toBeInTheDocument();
    release();
    expect(await screen.findByLabelText('Streak', { selector: 'dl' }, SLOW)).toBeInTheDocument();
    first.unmount();

    state = 'fail';
    renderWithApp(<Host />, { width: 1280 });
    await choose('Streak');
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText("Couldn't load streak tiers")).toBeInTheDocument();
    expect(overview()).toBeInTheDocument();

    state = 'ok';
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByLabelText('Streak', { selector: 'dl' }, SLOW)).toBeInTheDocument();
  });

  it('puts no tab or panel role of its own in the document, so the popup tabpanel is the only one', () => {
    renderWithApp(<Host />, { width: 1280 });

    expect(screen.queryAllByRole('tabpanel')).toEqual([]);
    expect(document.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('challenge record appears in fun facts only in the popup', async () => {
    const { unmount } = renderWithApp(<Host />, { width: 1280 });

    for (const name of ['Activity', 'Distance', 'Streak']) {
      await choose(name);
      await waitFor(() => expect(screen.queryByText('Challenges won–lost')).toBeNull(), SLOW);
    }
    await choose('Fun facts');
    const list = screen.getByLabelText('Fun facts', { selector: 'dl' });
    expect(rowsOf(list)['Challenges won–lost']).toBe('1–3');
    expect(list.querySelector('dd[data-tone="down"]')).toHaveTextContent('1–3');
    unmount();

    // The profile builds its rows from its own model, with no challenge row in any of its views.
    for (const view of ['distance', 'streak', 'fun', 'consistency'] as const) {
      const profile = renderWithApp(<ProfileStatsPanel user={KARL} now={NOW} isDesktop view={view} onChange={vi.fn()} label="Runner stats" />, { width: 1280 });
      await waitFor(() => expect(screen.getByRole('tabpanel').children.length).toBeGreaterThan(0), SLOW);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByText('Challenges won–lost')).toBeNull();
      expect(screen.queryByText('1–3')).toBeNull();
      profile.unmount();
    }
  });

  it('shows the record as a green row when the runner has won at least as many as lost', async () => {
    renderWithApp(<Host runner={{ ...KARL, wins: 4, losses: 4 }} />, { width: 1280 });
    await choose('Fun facts');

    const list = screen.getByLabelText('Fun facts', { selector: 'dl' });
    expect(rowsOf(list)['Challenges won–lost']).toBe('4–4');
    expect(list.querySelector('dd[data-tone="up"]')).toHaveTextContent('4–4');
  });

  it('is built for the runner shown, not for the signed-in user', () => {
    expect(ME.id).not.toBe(KARL.id);
    renderWithApp(<Host />, { width: 1280 });

    expect(screen.getByText(/^runs in the last \d+ months$/).previousElementSibling).toHaveTextContent(String(KARL.runs?.length));
  });
});
