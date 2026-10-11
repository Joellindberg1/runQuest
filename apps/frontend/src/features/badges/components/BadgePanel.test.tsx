import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '../api';
import { buildRunnerBadges } from '../badgeModel';
import { BadgePanel } from './BadgePanel';

// Den skrivskyddade BADGES-panelen (RUN-130, spec §4 F4, Council 1, 14, 16): bara intjänade serier, "On display" bara på visade, held-by som modellen
// ger den, nivå-chip till höger, inga kontroller.

const [first, second, third, fourth] = BADGE_SERIES;
const others = { viewerId: 'u-me', ownerId: 'u-karl' };

const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z' });
const user = (items: BadgeUserItem[], showcase: string[] = []): BadgeUserResponse => ({ items, showcase });

function group(held: Record<string, number>, memberCount = 6): GroupBadges {
  const holders: GroupBadges['holders'] = {};
  for (const series of BADGE_SERIES) {
    holders[series.key] = {};
    for (let tier = 1; tier <= 6; tier += 1) holders[series.key][String(tier)] = held[series.key] ?? 0;
  }
  return { members: [], holders, member_count: memberCount };
}

const panelFor = (data: BadgeUserResponse, grid?: GroupBadges) => <BadgePanel rows={buildRunnerBadges(data, grid, others).rows} />;
const rowsIn = () => within(screen.getByRole('list', { name: 'Earned badges' })).getAllByRole('listitem');

describe('BadgePanel', () => {
  it('visar den andra användarens samling och tre valda: en rad per intjänad serie, visade först med "On display"', () => {
    const data = user(
      [item(first.key, 3), item(second.key, 6), item(third.key, 1), item(fourth.key, 4)],
      [third.key, first.key, second.key],
    );
    render(panelFor(data));

    const rows = rowsIn();
    // Visade i användarens ordning (third, first, second), sedan den fjärde (ej visad).
    expect(rows.map((row) => within(row).getByText(/./, { selector: '.rq-badge-panel__name' }).textContent)).toEqual([third.name, first.name, second.name, fourth.name]);
    expect(screen.getAllByText('On display')).toHaveLength(3);
    expect(within(rows[3]).queryByText('On display')).toBeNull();

    // Nivå-chip till höger med nivånamnet i text (Council 14): Common, Rare, Legendary, Heroic.
    expect(within(rows[0]).getByText(TIER_NAMES[0])).toHaveClass('rq-chip');
    expect(within(rows[1]).getByText(TIER_NAMES[2])).toHaveClass('rq-chip', 'rq-chip--status');
    expect(within(rows[2]).getByText(TIER_NAMES[5])).toHaveAttribute('data-tier', 'legendary');
    expect(within(rows[3]).getByText(TIER_NAMES[3])).toHaveAttribute('data-tier', 'heroic');
    // Rubrik och räknare.
    expect(screen.getByRole('heading', { name: 'BADGES' })).toBeInTheDocument();
    expect(screen.getByText(`4 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
  });

  it('listar bara intjänade serier: en låst serie finns inte i panelen', () => {
    render(panelFor(user([item(second.key, 2)])));
    expect(rowsIn()).toHaveLength(1);
    expect(screen.queryByText(first.name)).toBeNull();
    expect(screen.queryByText(/locked/i)).toBeNull();
  });

  it('raden läses en gång: emblemet är dekorativt (aria-hidden, ingen img-roll) och chip-texten bär nivån', () => {
    const { container } = render(panelFor(user([item(first.key, 3)], [first.key])));

    expect(screen.queryByRole('img')).toBeNull();
    const emblem = container.querySelector('.rq-badge') as HTMLElement;
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    expect(emblem).not.toHaveAttribute('aria-label');
    expect(emblem).toHaveClass('rq-badge--md');
    // Radens text, i läsordning: serie, visad, nivå.
    expect(rowsIn()[0]).toHaveTextContent(`${first.name}On display${TIER_NAMES[2]}`);
  });

  it('inga redigeringsknappar: panelen är skrivskyddad', () => {
    render(panelFor(user([item(first.key, 3), item(second.key, 2)], [first.key])));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText(/save|edit|choose|display on/i)).toBeNull();
  });

  it('held-by visas som "Held by X of N in your pack" på raden', () => {
    render(panelFor(user([item(first.key, 3)]), group({ [first.key]: 2 })));
    expect(screen.getByText('Held by 2 of 6 in your pack')).toBeInTheDocument();
  });

  it('held-by göms när X = N (alla har nivån eller högre) men finns kvar på de andra raderna', () => {
    render(panelFor(user([item(first.key, 3), item(second.key, 3)]), group({ [first.key]: 6, [second.key]: 4 })));

    const [firstRow, secondRow] = rowsIn();
    expect(within(firstRow).queryByText(/held by/i)).toBeNull();
    expect(within(secondRow).getByText('Held by 4 of 6 in your pack')).toBeInTheDocument();
  });

  it('held-by utelämnas utan platshållare när gruppens data saknas', () => {
    const { container } = render(panelFor(user([item(first.key, 3)])));
    expect(screen.queryByText(/held by/i)).toBeNull();
    expect(container.querySelector('.rq-badge-panel__held')).toBeNull();
    expect(rowsIn()[0]).toHaveTextContent(`${first.name}${TIER_NAMES[2]}`);
  });

  it('tomläge: "No badges yet." i en streckad ruta, ingen lista och ingen räknare', () => {
    render(<BadgePanel rows={[]} />);

    const note = screen.getByText('No badges yet.');
    expect(note).toHaveClass('rq-badge-panel__empty');
    expect(screen.getByRole('heading', { name: 'BADGES' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/series$/)).toBeNull();
  });

  it('laddning: stadion-ovalen med skärmläsartext, varken lista eller tomläge', () => {
    render(<BadgePanel rows={[]} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading badges');
    expect(screen.queryByText('No badges yet.')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
