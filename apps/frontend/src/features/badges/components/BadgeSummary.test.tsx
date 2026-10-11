import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { BADGE_SERIES, MAX_TIER, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import { paths } from '@/paths';
import { renderWithApp } from '@/test/renderApp';
import type { GroupBadges } from '../api';
import { buildCollection } from '../badgeModel';
import { BadgeSummary } from './BadgeSummary';

// Profilens kompakta sammanfattning (RUN-151, spec v2 F10): rubrik + räknare, "All badges →" till /badges, intjänade 44 px-emblem på nivå, låsta-raden och tillstånden
// laddar/tomt/fel. Texterna räknas fram ur shared — inga serienamn skrivs som strängar här.

const [milestoner, earthTrotter, climber, streakKeeper, earlyBird] = BADGE_SERIES;
const ME = { viewerId: 'u-me', ownerId: 'u-me' };
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });

// Fem intjänade (en maxad), tre låsta; serielistans ordning och nivåordningen skiljer sig åt.
const DATA: BadgeUserResponse = {
  items: [item(milestoner.key, 3), item(earthTrotter.key, 2), item(climber.key, 1), item(streakKeeper.key, MAX_TIER), item(earlyBird.key, 4)],
  showcase: [streakKeeper.key, earlyBird.key],
};
function group(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= MAX_TIER; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}
const HELD = group({ [milestoner.key]: 5, [streakKeeper.key]: 1, [earlyBird.key]: 2, [BADGE_SERIES[5].key]: 3 });

const rowsFor = (data: BadgeUserResponse | undefined, grid: GroupBadges | null = HELD) => buildCollection(data, grid ?? undefined, ME);
const lockedSeries = BADGE_SERIES.filter((series) => !DATA.items.some((entry) => entry.series === series.key));
const renderSummary = (props: Partial<Parameters<typeof BadgeSummary>[0]> = {}, width = 390) =>
  renderWithApp(<BadgeSummary rows={rowsFor(DATA)} isDesktop={width >= 1024} {...props} />, { width });
const earnedList = () => screen.getByRole('list', { name: 'Earned badges' });
const lockedList = () => screen.getByRole('list', { name: 'Locked badges' });
const buttonNames = (list: HTMLElement) => within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label'));

describe('BadgeSummary — innehåll (F10.2, F10.3)', () => {
  it('intjänade serier som emblemknappar i nivåordning (högst först, lika nivå i serieordning)', () => {
    renderSummary();
    expect(buttonNames(earnedList())).toEqual([
      `${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}`,
      `${TIER_NAMES[3]} ${earlyBird.name}`,
      `${TIER_NAMES[2]} ${milestoner.name}`,
      `${TIER_NAMES[1]} ${earthTrotter.name}`,
      `${TIER_NAMES[0]} ${climber.name}`,
    ]);
    expect(earnedList().querySelectorAll('.rq-badge--cp')).toHaveLength(5);
  });

  it('låsta-raden: de låsta som "Locked {Serie}" i serieordning, och "Locked · n left" på mobil', () => {
    renderSummary();
    expect(buttonNames(lockedList())).toEqual(lockedSeries.map((series) => `Locked ${series.name}`));
    expect(screen.getByText(`Locked · ${lockedSeries.length} left`)).toBeInTheDocument();
  });

  it('desktop: "Locked · n series left"', () => {
    renderSummary({}, 1280);
    expect(screen.getByText(`Locked · ${lockedSeries.length} series left`)).toBeInTheDocument();
  });

  it('inga låsta: låsta-raden och dess hårlinje utelämnas', () => {
    const all = rowsFor({ items: BADGE_SERIES.map((series) => item(series.key, 2)), showcase: [] });
    const { container } = renderSummary({ rows: all });
    expect(screen.queryByRole('list', { name: 'Locked badges' })).toBeNull();
    expect(screen.queryByText(/^Locked ·/)).toBeNull();
    expect(container.querySelector('.rq-badge-summary__locked')).toBeNull();
    expect(within(earnedList()).getAllByRole('button')).toHaveLength(BADGE_SERIES.length);
  });

  it('inga procent och ingen global siffra någonstans i sammanfattningen (O2)', () => {
    const { container } = renderSummary();
    expect(container.textContent).not.toMatch(/%|globally|has it/i);
  });
});

describe('BadgeSummary — rubrik och länk (F10.2)', () => {
  it('mobil: eyebrow "Badges · N of 8 series", ingen kortyta och ingen Bebas-rubrik', () => {
    const { container } = renderSummary();
    expect(screen.getByRole('heading', { level: 2, name: `Badges · 5 of ${BADGE_SERIES.length} series` })).toBeInTheDocument();
    const section = screen.getByRole('region', { name: 'Badges' });
    expect(section).not.toHaveClass('rq-card');
    expect(container.querySelector('.rq-title')).toBeNull();
  });

  it('desktop: kort (.rq-card) med rubriken BADGES och "N of 8 series" som egen text', () => {
    renderSummary({}, 1280);
    expect(screen.getByRole('region', { name: 'Badges' })).toHaveClass('rq-card');
    expect(screen.getByRole('heading', { level: 2, name: 'BADGES' })).toHaveClass('rq-title');
    expect(screen.getByText(`5 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
  });

  it.each([['mobil', 390], ['desktop', 1280]])('%s: "All badges →" är en länk till /badges', (_label, width) => {
    renderSummary({}, width);
    const link = screen.getByRole('link', { name: 'All badges' });
    expect(link).toHaveAttribute('href', paths.badges);
    expect(link).toHaveTextContent('All badges →');
    fireEvent.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent(paths.badges);
  });

  it('inga väljar- eller Edit-element: bara emblemknapparna är knappar', () => {
    renderSummary();
    expect(screen.queryByRole('button', { name: /edit|save|show$/i })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(BADGE_SERIES.length);
  });
});

describe('BadgeSummary — popover per emblem (F10.4)', () => {
  it('ett tryck på ett intjänat emblem öppnar nivån, "On display" och held-by', async () => {
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: `${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}` }));
    const dialog = await screen.findByRole('dialog', { name: streakKeeper.name });
    expect(within(dialog).getByText('On display')).toBeInTheDocument();
    expect(within(dialog).getByText(TIER_NAMES[MAX_TIER - 1])).toBeInTheDocument();
    expect(within(dialog).getByText('Only you hold this in your pack')).toBeInTheDocument();
  });

  it('ett tryck på ett låst emblem visar Unlock men varken held-by eller flavor', async () => {
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: `Locked ${lockedSeries[0].name}` }));
    const locked = await screen.findByRole('dialog', { name: lockedSeries[0].name });
    expect(within(locked).getByText(/^Unlock: /)).toBeInTheDocument();
    expect(within(locked).queryByText(/in your pack|Only you hold/)).toBeNull();
    expect(locked.querySelector('.rq-badge-detail__flavor')).toBeNull();
  });

  it('gruppen felar (inga held-by-data): popovern utelämnar held-by', async () => {
    renderSummary({ rows: rowsFor(DATA, null) });
    fireEvent.click(screen.getByRole('button', { name: `${TIER_NAMES[MAX_TIER - 1]} ${streakKeeper.name}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/in your pack|Only you hold/)).toBeNull();
  });
});

describe('BadgeSummary — tillstånd (F10.5)', () => {
  it('laddar: fem cp-stora skelettblock i en statusregion, rubriken utan räknare, inga emblem', () => {
    const { container } = renderSummary({ rows: [], loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('Loading badges');
    expect(container.querySelectorAll('.rq-badge-skel__shape--cp')).toHaveLength(5);
    expect(screen.getByRole('heading', { level: 2, name: 'Badges' })).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ series/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: 'All badges' })).toBeInTheDocument();
  });

  it('tomt: streckad ruta "No badges yet. Log a run to start collecting." och en låst rad med alla åtta', () => {
    renderSummary({ rows: rowsFor({ items: [], showcase: [] }) });
    expect(screen.getByText('No badges yet. Log a run to start collecting.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Earned badges' })).toBeNull();
    expect(within(lockedList()).getAllByRole('button')).toHaveLength(BADGE_SERIES.length);
    expect(screen.getByText(`Locked · ${BADGE_SERIES.length} left`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: `Badges · 0 of ${BADGE_SERIES.length} series` })).toBeInTheDocument();
  });

  it('fel: ErrorState med Retry i stället för raderna, rubriken och länken kvar; Retry anropar onRetry', () => {
    const onRetry = vi.fn();
    renderSummary({ rows: rowsFor(undefined, null), error: { onRetry, retrying: false } });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: "Couldn't load your badges" })).toBeInTheDocument();
    expect(within(alert).getByText('Your runs are safe.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Earned badges' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Locked badges' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Badges' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All badges' })).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Retry är avstängd medan omhämtningen pågår', () => {
    renderSummary({ rows: [], error: { onRetry: vi.fn(), retrying: true } });
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
