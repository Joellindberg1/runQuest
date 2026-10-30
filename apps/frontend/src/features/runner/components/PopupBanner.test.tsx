import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Run, User } from '@runquest/types';
import type { BadgeUserItem, BadgeUserResponse, HeadToHeadResponse } from '@runquest/shared';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import { getLevelFromXP, getXPForLevel } from '@/shared/services/levelService';
import { stat, token } from '@/features/challenges/duels.fixture';
import { ME, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { RunnerCard } from './RunnerCard';
import { RunnerPopup } from './RunnerPopup';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
const badgesApi = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn() }));
vi.mock('@/features/badges/api', () => ({ badgesApi }));

// Popupens banner (ADR 006 punkt 4): nivåring, namn, högst tre showcase-badges, ställningen på en rad och fyra statceller, och Head to head i en egen panel uppe till höger som läses upp
// som EN mening. Sidvarianten (mobil och direktladdning) har kvar hjältekortet med CHALLENGES och det separata Head to head-kortet.

const DESKTOP = 1280;
// Queries gör ett snabbt omförsök (~1 s) före felläget.
const SLOW = { timeout: 4000 };

const run = (id: string): Run => ({
  id, user_id: 'u-karl', date: '2026-09-20', distance: 5, xp_gained: 120, multiplier: 1, streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0,
});
const KARL: User = {
  ...ME, id: 'u-karl', name: 'Karl Persson', total_xp: 5539, total_km: 46.2, current_streak: 0, longest_streak: 0, wins: 0, draws: 0, losses: 2,
  runs: [run('r1'), run('r2')], challenge_counts: {},
};
const PACK = [ME, KARL];
const record = (wins: number, draws: number, losses: number): HeadToHeadResponse => ({
  opponent: { id: KARL.id, name: KARL.name, profile_picture: null },
  record: { wins, draws, losses, total: wins + draws + losses },
  history: [],
  active: null,
});

const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z' });
const [speedster, milestoner, nightOwl, streakKeeper] = BADGE_SERIES;
const FOUR_SHOWN: BadgeUserResponse = {
  items: [item(speedster.key, 5), item(milestoner.key, 3), item(nightOwl.key, 2), item(streakKeeper.key, 4)],
  showcase: [speedster.key, milestoner.key, nightOwl.key, streakKeeper.key],
};

const noop = () => {};
function renderPopup() {
  return renderWithApp(<RunnerPopup id={KARL.id} runner={KARL} users={PACK} failure={null} failed={false} onClose={noop} />, { entry: '/runner/u-karl', width: DESKTOP });
}
const banner = async () => within(await screen.findByRole('region', { name: 'Runner' }));
const heroName = () => screen.findByRole('heading', { level: 1, name: 'Karl Persson' });
const sentence = (text: string) => screen.findByText(text);

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: PACK });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({ success: true, data: record(2, 0, 1) });
  badgesApi.getUserBadges.mockReset();
  badgesApi.getGroupBadges.mockReset();
  badgesApi.getUserBadges.mockResolvedValue({ items: [item(speedster.key, 5)], showcase: [speedster.key] });
  badgesApi.getGroupBadges.mockResolvedValue({ members: [], holders: {}, member_count: 2 });
});

describe('the popup banner', () => {
  it('shows the level ring, the name, the standing on one line and the four stats', async () => {
    renderPopup();
    await heroName();
    const hero = await banner();

    const level = getLevelFromXP(5539);
    const toNext = getXPForLevel(level + 1) - 5539;
    expect(hero.getByRole('img', { name: new RegExp(`^Level ${level}, \\d+% of the way to level ${level + 1}$`) })).toHaveTextContent(String(level));
    expect(hero.getByText(`#1 in the group · 2 runs · ${toNext.toLocaleString('sv-SE')} XP to level ${level + 1}`)).toBeInTheDocument();

    const labels = [...document.querySelectorAll('.rq-runner-hero--popup .rq-runner-cells dt')].map((label) => label.textContent);
    expect(labels).toEqual(['total xp', 'total km', 'runs', 'titles held']);
  });

  it('has no CHALLENGES box in the popup, while the page keeps it', async () => {
    const popup = renderPopup();
    await heroName();
    await waitFor(() => expect(document.querySelector('.rq-runner-cells [data-cell="titles"] dd')).toHaveTextContent('0'));
    expect(document.querySelector('.rq-runner-cells [data-cell="challenges"]')).toBeNull();
    expect(screen.queryByText('challenges')).toBeNull();
    popup.unmount();

    const page = renderWithApp(<RunnerCard user={KARL} allUsers={PACK} onBack={noop} />, { entry: '/runner/u-karl', width: DESKTOP });
    await heroName();
    const cell = page.container.querySelector('.rq-runner-cells [data-cell="challenges"]') as HTMLElement;
    expect(within(cell).getByText('challenges')).toBeInTheDocument();
    expect(cell.querySelector('dd')).toHaveTextContent('0–2');
    expect(page.container.querySelectorAll('.rq-runner-cells > div')).toHaveLength(5);
  });

  it('shows at most three showcase badges, from the showcase that is already fetched', async () => {
    badgesApi.getUserBadges.mockResolvedValue(FOUR_SHOWN);
    renderPopup();
    await heroName();

    const minis = await screen.findByRole('img', { name: `Badges: ${TIER_NAMES[4]} ${speedster.name}, ${TIER_NAMES[2]} ${milestoner.name}, ${TIER_NAMES[1]} ${nightOwl.name}` });
    expect(minis.querySelectorAll('.rq-badge--sm')).toHaveLength(3);
    expect(badgesApi.getUserBadges).toHaveBeenCalledTimes(1);
  });

  it.each([[0, 0], [1, 1], [3, 3]])('with %i showcase badges it shows %i minis and keeps the name line in place', async (shown, expected) => {
    const items = [item(speedster.key, 5), item(milestoner.key, 3), item(nightOwl.key, 2)];
    badgesApi.getUserBadges.mockResolvedValue({ items, showcase: items.slice(0, shown).map((entry) => entry.series) });
    renderPopup();
    await heroName();

    await waitFor(() => expect(document.querySelectorAll('.rq-runner-hero--popup .rq-badge-minis .rq-badge--sm')).toHaveLength(expected));
    expect(document.querySelector('.rq-runner-hero__nameline')).not.toBeNull();
  });
});

describe('Head to head in its own panel in the banner', () => {
  it('sits in the banner, with the heading, a decorative sword and three boxes: you won, drawn and you lost', async () => {
    renderPopup();
    await heroName();
    const hero = await banner();
    await sentence('Head to head: 2–0–1 to you');

    const panel = document.querySelector('.rq-runner-hero--popup .rq-runner-h2h-banner') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.closest('section[aria-label="Runner"]')).not.toBeNull();
    const heading = within(panel).getByText('Head to head with you');
    expect(heading.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(panel.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();

    const boxes = [...panel.querySelectorAll('.rq-runner-record > div')].map((box) => [box.querySelector('dt')?.textContent, box.querySelector('dd')?.textContent]);
    expect(boxes).toEqual([['you won', '2'], ['drawn', '0'], ['you lost', '1']]);
    // Bannern är en region: panelen är inte en egen.
    expect(hero.queryByRole('region', { name: 'Head to head' })).toBeNull();
  });

  it('is read once, as one sentence, while the visible numbers are hidden from assistive technology', async () => {
    renderPopup();
    await heroName();
    await sentence('Head to head: 2–0–1 to you');

    expect(screen.getAllByText(/Head to head: 2–0–1 to you/)).toHaveLength(1);
    const record = document.querySelector('.rq-runner-h2h-banner .rq-runner-record') as HTMLElement;
    expect(record).toHaveAttribute('aria-hidden', 'true');
    // Tillgänglighetsträdet innehåller meningen men inga lösa siffror ur panelen.
    const panel = document.querySelector('.rq-runner-h2h-banner') as HTMLElement;
    expect(within(panel).queryAllByRole('term')).toHaveLength(0);
    expect(within(panel).getByText('Head to head: 2–0–1 to you')).not.toHaveAttribute('aria-hidden');
  });

  it('reads to the opponent by first name when they lead, and level when it is even', async () => {
    handlers.getHeadToHead = () => ({ success: true, data: record(0, 1, 2) });
    const first = renderPopup();
    await sentence('Head to head: 0–1–2 to Karl');
    first.unmount();

    handlers.getHeadToHead = () => ({ success: true, data: record(1, 0, 1) });
    renderPopup();
    await sentence('Head to head: 1–0–1 level');
  });

  it('says there are no duels against the opponent yet', async () => {
    handlers.getHeadToHead = () => ({ success: true, data: record(0, 0, 0) });
    renderPopup();
    await heroName();

    expect(await screen.findByText('No duels against Karl yet')).toBeInTheDocument();
    expect(screen.getByText('Head to head: no duels against Karl yet')).toBeInTheDocument();
    expect(document.querySelector('.rq-runner-h2h-banner .rq-runner-record')).toBeNull();
  });

  it('shows the loader inside the panel while the record loads, and the banner has no separate Head to head card', async () => {
    handlers.getHeadToHead = () => new Promise(() => {});
    renderPopup();
    await heroName();

    const panel = document.querySelector('.rq-runner-h2h-banner') as HTMLElement;
    expect(within(panel).getByText('Loading head to head')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Head to head' })).toBeNull();
    expect(document.querySelector('.rq-runner-h2h')).toBeNull();
  });

  it('shows the error state with Retry inside the panel, and Retry fetches again', async () => {
    let fail = true;
    const spy = vi.fn(() => (fail ? { success: false, error: 'boom' } : { success: true, data: record(2, 0, 1) }));
    handlers.getHeadToHead = spy;
    // Challenge is on when I can send and Karl is free, whatever Head to head did.
    handlers.getMyChallenges = () => ({ success: true, data: { tokens: [token({ id: 't1' })], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [] } });
    handlers.getChallengeGroupStats = () => ({ success: true, data: [stat(ME.id), stat(KARL.id)] });
    renderPopup();
    await heroName();

    const panel = document.querySelector('.rq-runner-h2h-banner') as HTMLElement;
    expect(await within(panel).findByText("Couldn't load head to head", undefined, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Challenge' })).toBeInTheDocument();

    fail = false;
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    await sentence('Head to head: 2–0–1 to you');
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('after a successful Retry the focus goes to the panel record, not to the dialog frame', async () => {
    let fail = true;
    handlers.getHeadToHead = () => (fail ? { success: false, error: 'boom' } : { success: true, data: record(2, 0, 1) });
    renderPopup();
    await heroName();
    const panel = document.querySelector('.rq-runner-h2h-banner') as HTMLElement;
    await within(panel).findByText("Couldn't load head to head", undefined, SLOW);
    const retry = within(panel).getByRole('button', { name: 'Retry' });
    retry.focus();
    expect(retry).toHaveFocus();

    fail = false;
    fireEvent.click(retry);

    const recordLine = await sentence('Head to head: 2–0–1 to you');
    await waitFor(() => expect(recordLine).toHaveFocus());
    expect(screen.getByRole('dialog')).not.toHaveFocus();
  });

  it('is no longer in the Overview panel, and the stats fill it', async () => {
    renderPopup();
    await heroName();
    await sentence('Head to head: 2–0–1 to you');

    const overview = document.querySelector('.rq-runner-popup-panel') as HTMLElement;
    expect(within(overview).queryByText(/head to head/i)).toBeNull();
    expect(within(overview).getByRole('group', { name: 'Overview' })).toBeInTheDocument();
    expect(overview.querySelector('.rq-runner__split')).toBeNull();
  });

  it('reads the record once for the banner, the Challenge chip and the loader: one request', async () => {
    const spy = vi.fn(() => ({ success: true, data: record(2, 0, 1) }));
    handlers.getHeadToHead = spy;
    renderPopup();
    await heroName();
    await sentence('Head to head: 2–0–1 to you');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('u-karl', 5);
  });

  it('has no panel without a signed-in user, who has nobody to compare with', async () => {
    renderWithApp(<RunnerPopup id={KARL.id} runner={KARL} users={PACK} failure={null} failed={false} onClose={noop} />, { entry: '/runner/u-karl', width: DESKTOP, user: null });
    await heroName();

    expect(document.querySelector('.rq-runner-h2h-banner')).toBeNull();
  });
});
