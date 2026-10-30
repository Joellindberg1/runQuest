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
