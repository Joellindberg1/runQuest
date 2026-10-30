import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deltaView } from '../boardFormat';
import type { SeasonRow } from '../seasonModel';
import { PodiumCard } from './PodiumCard';

function row(overrides: Partial<SeasonRow> = {}): SeasonRow {
  return {
    id: 'u-karl',
    name: 'Karl Persson',
    rank: 1,
    level: 24,
    initials: 'KP',
    pictureUrl: null,
    delta: deltaView(1),
    titleNames: ['The Double Trouble'],
    heldTitleCount: 1,
    progress: { pct: 62, into: '586 / 949 XP', atMax: false },
    kmTotal: '988',
    longest: '32.8',
    runs: 159,
    avgPerRun: '6.2',
    pace: { perDay: 39, text: '39/D', tone: 'up' },
    nextLevelDays: 10,
    lastRun: { age: '5 h ago', km: '8.4' },
    tokens: { minor: 3, major: 1, legendary: 0 },
    tokensLeft: 4,
    showcase: [],
    ...overrides,
  };
}

function renderCard(overrides: Partial<SeasonRow> = {}, wide = false, onOpen = vi.fn()) {
  render(<PodiumCard row={row(overrides)} wide={wide} onOpen={onOpen} />);
  return { onOpen, card: screen.getByTestId(`podium-${overrides.rank ?? 1}`) };
}

describe('PodiumCard på mobil: namnet', () => {
  it('delar namnet i förnamn och efternamn men knappens text är fortfarande hela namnet', () => {
    const { card } = renderCard();
    const button = within(card).getByRole('button', { name: 'Karl Persson' });

    expect(button.textContent).toBe('Karl Persson');
    expect(button.querySelector('.rq-board-podium__given')).toHaveTextContent(/^Karl$/);
    expect(button.querySelector('.rq-board-podium__surname')).toHaveTextContent(/^Persson$/);
  });

  it('allt efter första ordet är efternamnet, också när det är flera ord', () => {
    const { card } = renderCard({ name: 'Nicklas von Elling' });
    const button = within(card).getByRole('button', { name: 'Nicklas von Elling' });

    expect(button.querySelector('.rq-board-podium__given')).toHaveTextContent(/^Nicklas$/);
    expect(button.querySelector('.rq-board-podium__surname')).toHaveTextContent(/^von Elling$/);
  });

  it('ett ord långt namn får ingen tom andra rad', () => {
    const { card } = renderCard({ name: 'Cher' });
    const button = within(card).getByRole('button', { name: 'Cher' });

    expect(button.textContent).toBe('Cher');
    expect(button.querySelector('.rq-board-podium__surname')).toBeNull();
  });

  it('ett långt ord utan mellanslag eller med bindestreck stannar ett ord', () => {
    const word = 'Montgomery-Featherstonehaugh';
    const { card } = renderCard({ name: word });
    const button = within(card).getByRole('button', { name: word });

    expect(button.querySelector('.rq-board-podium__given')).toHaveTextContent(word);
    expect(button.querySelector('.rq-board-podium__surname')).toBeNull();
  });

  it('ett långt efternamn utan mellanslag ligger i efternamnet', () => {
    const surname = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
    const { card } = renderCard({ name: `Ann ${surname}` });
    const button = within(card).getByRole('button', { name: `Ann ${surname}` });

    expect(button.querySelector('.rq-board-podium__given')).toHaveTextContent(/^Ann$/);
    expect(button.querySelector('.rq-board-podium__surname')).toHaveTextContent(surname);
  });

  it('pilen ligger utanför knappen och läses en gång, med riktningen', () => {
    const { card } = renderCard();
    const button = within(card).getByRole('button', { name: 'Karl Persson' });
    const arrows = within(card).getAllByRole('img', { name: 'Up 1 place' });

    expect(arrows).toHaveLength(1);
    expect(button.contains(arrows[0]!)).toBe(false);
    expect(arrows[0]).toHaveTextContent('▲ 1');
  });

  it('namnknappen bär data-runner-id, går att fokusera och öppnar löparen utan att kortets klick öppnar en gång till', async () => {
    const { card, onOpen } = renderCard();
    const button = within(card).getByRole('button', { name: 'Karl Persson' });

    expect(button).toHaveAttribute('data-runner-id', 'u-karl');
    button.focus();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('u-karl');
  });
});

describe('PodiumCard på mobil: placeringen', () => {
  it.each([
    [1, '1st place', '#1'],
    [2, '2nd place', '#2'],
    [3, '3rd place', '#3'],
  ])('plats %i står som läsbar text och har ett eget tillgängligt namn', (rank, label, text) => {
    const { card } = renderCard({ rank });
    const place = within(card).getByRole('img', { name: label });

    expect(place).toHaveTextContent(text);
    expect(within(card).getAllByRole('img', { name: label })).toHaveLength(1);
  });

  it('placeringen läses inte in i namnknappens namn', () => {
    const { card } = renderCard();

    expect(within(card).getByRole('button', { name: 'Karl Persson' }).textContent).not.toMatch(/place|#|1st/);
  });

  it('spöksiffran ritas inte på mobil: det synliga #N är placeringen, så inget står dubbelt', () => {
    const { card } = renderCard();

    expect(card.querySelector('.rq-ghost-rank')).toBeNull();
  });
});

describe('PodiumCard på desktop (wide) är som förut', () => {
  it('spöksiffran är dekor, namnet är en ofördelad text och ingen synlig placeringstext tillkommer', () => {
    const { card } = renderCard({}, true);
    const ghost = card.querySelector('.rq-ghost-rank');
    const button = within(card).getByRole('button', { name: 'Karl Persson' });

    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(button.children).toHaveLength(0);
    expect(card.querySelector('.rq-board-podium__rank')).toBeNull();
    expect(within(card).queryByRole('img', { name: '1st place' })).toBeNull();
    expect(within(card).getByText('Lvl 24')).toBeInTheDocument();
  });
});

const THREE_BADGES = [
  { series: 'climber', tier: 5 },
  { series: 'milestoner', tier: 3 },
  { series: 'night_owl', tier: 1 },
];
const BADGE_LABELS = ['Epic Climber', 'Rare Milestoner', 'Common Night Owl'];

describe('PodiumCard på mobil: badgepyramiden', () => {
  it('utan badges finns varken yta, grupp eller text för dem, och namnet ligger kvar', () => {
    const { card } = renderCard({ showcase: [] });

    expect(card.querySelector('.rq-board-podium__pyramid')).toBeNull();
    expect(card.querySelector('.rq-badge-minis')).toBeNull();
    expect(card.querySelector('.rq-badge')).toBeNull();
    expect(within(card).queryByRole('img', { name: /^Badges/ })).toBeNull();
    expect(card.querySelector('.rq-board-podium__head')).not.toHaveAttribute('data-minis');
    expect(within(card).getByRole('button', { name: 'Karl Persson' })).toBeInTheDocument();
  });

  it.each([1, 2, 3])('med %i badge(s): pyramiden bär antalet och bara sm-emblem ritas', (count) => {
    const { card } = renderCard({ showcase: THREE_BADGES.slice(0, count) });
    const pyramid = card.querySelector('.rq-board-podium__pyramid');

    expect(pyramid).toHaveAttribute('data-count', String(count));
    expect(card.querySelector('.rq-board-podium__head')).toHaveAttribute('data-minis', 'true');
    const emblems = pyramid!.querySelectorAll('.rq-badge');
    expect(emblems).toHaveLength(count);
    for (const emblem of emblems) expect(emblem).toHaveClass('rq-badge--sm');
  });

  it.each([1, 2, 3])('med %i badge(s): gruppen läses en gång med ett namn per emblem i ordning, emblemen är dekorativa', (count) => {
    const { card } = renderCard({ showcase: THREE_BADGES.slice(0, count) });
    const label = `Badges: ${BADGE_LABELS.slice(0, count).join(', ')}`;
    const group = within(card).getByRole('img', { name: label });

    expect(within(card).getAllByRole('img', { name: /^Badges/ })).toHaveLength(1);
    expect(group).toHaveAttribute('aria-label', label);
    for (const emblem of group.querySelectorAll('.rq-badge')) {
      expect(emblem).toHaveAttribute('aria-hidden', 'true');
      expect(emblem).not.toHaveAttribute('aria-label');
    }
    expect(within(group).queryAllByRole('img')).toHaveLength(0);
  });

  it('gruppen ligger utanför namnknappen och namnraden, efter namnet, och dubblerar varken placeringen eller namnet', () => {
    const { card } = renderCard({ showcase: THREE_BADGES });
    const button = within(card).getByRole('button', { name: 'Karl Persson' });
    const group = within(card).getByRole('img', { name: /^Badges/ });

    expect(button.contains(group)).toBe(false);
    expect(group.closest('.rq-board-podium__nameline')).toBeNull();
    expect(group.closest('.rq-board-podium__head')).not.toBeNull();
    expect(button.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.textContent).toBe('Karl Persson');
    const names = within(card).getAllByRole('img').map((node) => node.getAttribute('aria-label'));
    expect(names).toEqual(['1st place', 'Up 1 place', `Badges: ${BADGE_LABELS.join(', ')}`]);
  });

  it('namnraden har bara namnet och pilen: gruppen delar inte behållare med dem', () => {
    const { card } = renderCard({ showcase: THREE_BADGES });
    const nameline = card.querySelector('.rq-board-podium__nameline')!;

    expect([...nameline.children].map((child) => child.getAttribute('aria-label') ?? child.textContent)).toEqual(['Karl Persson', 'Up 1 place']);
  });
});

describe('PodiumCard på desktop (wide): badgesen ligger kvar på namnraden, ingen pyramid', () => {
  it('tre badges står som minis på rad efter namnet och kortet har ingen pyramid', () => {
    const { card } = renderCard({ showcase: THREE_BADGES }, true);
    const group = within(card).getByRole('img', { name: `Badges: ${BADGE_LABELS.join(', ')}` });

    expect(card.querySelector('.rq-board-podium__pyramid')).toBeNull();
    expect(card.querySelector('.rq-board-podium__head')).not.toHaveAttribute('data-minis');
    expect(group.closest('.rq-board-podium__nameline')).not.toBeNull();
    expect(group.parentElement).toHaveAttribute('data-minis', 'true');
  });
});
