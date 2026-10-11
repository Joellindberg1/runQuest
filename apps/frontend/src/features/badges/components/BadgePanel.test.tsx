import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BADGE_SERIES, TIER_NAMES } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '../api';
import { buildRunnerBadges } from '../badgeModel';
import { BadgePanel } from './BadgePanel';

// Den kompakta BADGES-panelen på Runner card (RUN-152, spec F11, V2.9 #8–9): bara intjänade serier som 44 px-emblemknappar med en detaljpopover; nivå,
// krav, "On display" och held-by bor i popovern, aldrig i panelen. Serie- och nivånamn räknas fram ur shared — inga literaler.

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
const emblemButtons = () => within(screen.getByRole('list', { name: 'Earned badges' })).getAllByRole('button');
const nameOf = (tier: number, series: { name: string }) => `${TIER_NAMES[tier - 1]} ${series.name}`;
const open = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog');
};
/** Webbläsaren gör Enter (keydown) på en <button> till ett klick; jsdom gör det inte, så det efterliknas här. */
function pressEnter(element: HTMLElement) {
  element.focus();
  if (fireEvent.keyDown(element, { key: 'Enter' })) fireEvent.click(element);
}

describe('BadgePanel — emblemen (F11.2)', () => {
  it('ett emblem per intjänad serie som knapp "{Nivå} {Serie}": visade först i löparens ordning, sedan högst nivå, sedan serieordning', () => {
    const data = user(
      [item(first.key, 3), item(second.key, 6), item(third.key, 1), item(fourth.key, 4)],
      [third.key, first.key, second.key],
    );
    render(panelFor(data));

    expect(emblemButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      nameOf(1, third), nameOf(3, first), nameOf(6, second), nameOf(4, fourth),
    ]);
    expect(within(screen.getByRole('list', { name: 'Earned badges' })).getAllByRole('listitem')).toHaveLength(4);
  });

  it('rubriken BADGES utan ikon och räknaren "{N} of {antal serier} series"', () => {
    const { container } = render(panelFor(user([item(first.key, 3), item(second.key, 2)])));

    expect(screen.getByRole('heading', { name: 'BADGES' })).toBeInTheDocument();
    expect(screen.getByText(`2 of ${BADGE_SERIES.length} series`)).toBeInTheDocument();
    expect(container.querySelector('.rq-badge-panel__head svg')).toBeNull();
  });

  it('listar bara intjänade serier: en låst serie finns varken som emblem eller som text', () => {
    render(panelFor(user([item(second.key, 2)])));
    expect(emblemButtons()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: new RegExp(first.name) })).toBeNull();
    expect(screen.queryByText(/locked/i)).toBeNull();
  });

  it('panelen innehåller bara emblemknappar: cp-emblem (dekorativa), inga chip, ingen "On display", ingen held-by, ingen title', () => {
    const { container } = render(panelFor(user([item(first.key, 3), item(second.key, 2)], [first.key]), group({ [first.key]: 2, [second.key]: 1 })));

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(container.querySelectorAll('.rq-badge--cp[aria-hidden="true"]')).toHaveLength(2);
    expect(container.querySelector('.rq-badge-panel__row')).toBeNull();
    expect(container.querySelector('.rq-chip')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
    expect(screen.queryByText('On display')).toBeNull();
    expect(screen.queryByText(/held by/i)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

describe('BadgePanel — popovern (F10.4 via F11.2, L4)', () => {
  it('ett tryck öppnar en dialog med serienamnet, nivåchippet och kravet — nivån syns utan tooltip', async () => {
    const data = user([item(first.key, 3)]);
    const rows = buildRunnerBadges(data, undefined, others).rows;
    render(<BadgePanel rows={rows} />);

    const dialog = await open(nameOf(3, first));
    expect(dialog).toHaveAccessibleName(first.name);
    expect(within(dialog).getByText(TIER_NAMES[2])).toHaveClass('rq-chip');
    expect(within(dialog).getByText(rows[0].requirement as string)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: nameOf(3, first) })).toHaveAttribute('aria-expanded', 'true');
  });

  it('"On display" står i popovern för en visad serie men inte för en som inte är visad', async () => {
    render(panelFor(user([item(first.key, 3), item(second.key, 2)], [first.key])));

    expect(within(await open(nameOf(3, first))).getByText('On display')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(await open(nameOf(2, second))).queryByText('On display')).toBeNull();
  });

  it('tangentbord: Enter öppnar, Escape stänger och fokus återvänder till emblemknappen', async () => {
    render(panelFor(user([item(first.key, 3)])));
    const button = screen.getByRole('button', { name: nameOf(3, first) });

    pressEnter(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
  });
});

describe('BadgePanel — held-by i popovern (Council 1)', () => {
  it('"Held by X of N in your pack" står i popovern, inte i panelen', async () => {
    render(panelFor(user([item(first.key, 3)]), group({ [first.key]: 2 })));

    expect(screen.queryByText(/held by/i)).toBeNull();
    expect(within(await open(nameOf(3, first))).getByText('Held by 2 of 6 in your pack')).toBeInTheDocument();
  });

  it('göms när X = N (alla har nivån) men finns kvar på de andra emblemen', async () => {
    render(panelFor(user([item(first.key, 3), item(second.key, 3)]), group({ [first.key]: 6, [second.key]: 4 })));

    expect(within(await open(nameOf(3, first))).queryByText(/held by/i)).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(await open(nameOf(3, second))).getByText('Held by 4 of 6 in your pack')).toBeInTheDocument();
  });

  it('utelämnas utan platshållare när gruppens data saknas (group-fel)', async () => {
    render(panelFor(user([item(first.key, 3)])));
    const dialog = await open(nameOf(3, first));
    expect(within(dialog).queryByText(/held by/i)).toBeNull();
    expect(dialog.querySelector('.rq-badge-detail__held')).toBeNull();
  });
});

describe('BadgePanel — tillstånd', () => {
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

  it('felläge: felkort med Retry i stället för tomläget och emblemen, utan räknare; Retry anropar onRetry', () => {
    const onRetry = vi.fn();
    render(<BadgePanel rows={[]} error={{ onRetry, retrying: false }} />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load badges");
    expect(screen.queryByText('No badges yet.')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/series$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('felläge under omförsök: Retry är avstängd', () => {
    render(<BadgePanel rows={[]} error={{ onRetry: () => {}, retrying: true }} />);
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
