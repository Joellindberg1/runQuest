import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildPositionHistory, compareXpStandings, type PositionHistoryUser } from '@runquest/shared';
import { buildPositionChart, type OrderEntry } from '../positionChartModel';
import { ME_ID, pictureOf, six, twelve } from '../positionBoard.fixture';
import { CurrentOrder } from './CurrentOrder';

// "Current order" och legenden är EN komponent: webben har den bredvid grafen, mobilen under. Valtillståndet bor i föräldern (PositionView); här
// prövas listan, knapparna och texterna mot vymodellens `order`.

const orderOf = (data = six(), selectedId: string | null = null): OrderEntry[] => buildPositionChart(data, { meId: ME_ID, mobile: true, selectedId }).order;

const renderOrder = (entries: OrderEntry[], onSelect = vi.fn()) => ({ onSelect, ...render(<CurrentOrder entries={entries} onSelect={onSelect} />) });

describe('CurrentOrder', () => {
  it('is an ordered list with one button per runner', () => {
    renderOrder(orderOf());

    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    for (const item of items) expect(within(item).getAllByRole('button')).toHaveLength(1);
  });

  it('lists the runners in Standings order, the same as the standings of the same users', () => {
    // Samma användare som tabellen: lika XP avgörs av namn, sedan id (compareXpStandings). Namnen står i oordning med flit.
    const users: PositionHistoryUser[] = [
      { id: 'u-3', name: 'Cecilia Berg', profile_picture: null, total_xp: 900, created_at: null },
      { id: 'u-1', name: 'Ada Lund', profile_picture: null, total_xp: 1200, created_at: null },
      { id: 'u-5', name: 'Erik Holm', profile_picture: null, total_xp: 900, created_at: null },
      { id: 'u-2', name: 'Bo Ek', profile_picture: null, total_xp: 900, created_at: null },
      { id: 'u-4', name: 'Bo Ek', profile_picture: null, total_xp: 900, created_at: null },
      { id: 'u-6', name: 'Dan Ström', profile_picture: null, total_xp: 100, created_at: null },
    ];
    const { response } = buildPositionHistory(users, [], new Date('2026-10-28T12:00:00Z'), 3);
    const standings = [...users].sort((a, b) => compareXpStandings({ id: a.id, name: a.name, xp: a.total_xp }, { id: b.id, name: b.name, xp: b.total_xp }));

    renderOrder(buildPositionChart(response, { meId: 'u-2', mobile: true }).order);

    const names = screen.getAllByRole('listitem').map((item) => within(item).getByText(/^[A-Z]/, { selector: '.rq-board-position-order__name' }).textContent);
    expect(names).toEqual(standings.map((user) => user.name));
    const places = screen.getAllByRole('listitem').map((item) => item.querySelector('.rq-board-position-order__place')!.textContent);
    expect(places).toEqual(['#1', '#2', '#3', '#4', '#5', '#6']);
  });

  it('gives every button aria-pressed, false for all when nobody is selected', () => {
    renderOrder(orderOf());

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the selected runner with aria-pressed and the text "Shown", so the state does not rest on colour', () => {
    renderOrder(orderOf(six(), 'u-adam'));

    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent('Adam Einstein');
    expect(within(pressed[0]).getByText('Shown')).toBeInTheDocument();
    expect(screen.getAllByText('Shown')).toHaveLength(1);
  });

  it('asks the parent to select the runner on a click, and the same runner again to deselect', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderOrder(orderOf());

    await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));
    expect(onSelect).toHaveBeenLastCalledWith('u-adam');
    await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith('u-adam');
  });

  it('is reached with Tab on every row, and Enter and Space both toggle', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderOrder(orderOf());

    for (const button of screen.getAllByRole('button')) {
      await user.tab();
      expect(button).toHaveFocus();
    }
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: /Daniel/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('u-daniel');
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('gives only the signed-in runner a "You" tag, as text', () => {
    renderOrder(orderOf());

    const tags = screen.getAllByText('You');
    expect(tags).toHaveLength(1);
    expect(tags[0].closest('button')).toHaveTextContent('Joel Lindberg');
    expect(tags[0].closest('button')).toHaveAttribute('data-me', 'true');
  });

  it('shows the placement and the full name as text on every row', () => {
    renderOrder(orderOf());

    const rows = screen.getAllByRole('button');
    expect(rows[0]).toHaveTextContent('#1');
    expect(rows[0]).toHaveTextContent('Karl Persson');
    expect(rows[4]).toHaveTextContent('#5');
    expect(rows[4]).toHaveTextContent('Daniel Lindblad Lüthje');
  });

  it('says in which week a runner who joined later was first placed', () => {
    renderOrder(orderOf(twelve({ id: 'u-sara', firstIndex: 3 })));

    expect(screen.getByRole('button', { name: /Sara Ek/ })).toHaveTextContent('Joined W30');
    expect(screen.getAllByText(/^Joined /)).toHaveLength(1);
  });

  it('shows the profile picture, and the initials when there is none or the picture is broken', () => {
    const { container } = renderOrder(orderOf());

    expect(within(screen.getByRole('button', { name: /Joel Lindberg/ })).queryByText('JL')).toBeNull();
    expect(container.querySelector(`img[src="${pictureOf(ME_ID)}"]`)).not.toBeNull();
    expect(within(screen.getByRole('button', { name: /Nicklas/ })).getByText('NE')).toBeInTheDocument();

    fireEvent.error(container.querySelector(`img[src="${pictureOf(ME_ID)}"]`)!);
    expect(within(screen.getByRole('button', { name: /Joel Lindberg/ })).getByText('JL')).toBeInTheDocument();
  });

  it('hides the picture and the initials from the screen reader, which gets the name and the placement', () => {
    renderOrder(orderOf());

    const button = screen.getByRole('button', { name: /Nicklas von Elling/ });
    expect(button.querySelector('.rq-board-position-avatar')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAccessibleName(/#4.*Nicklas von Elling/);
  });

  it('has a title and a hint that names what a click does', () => {
    renderOrder(orderOf());

    expect(screen.getByRole('heading', { name: 'Current order' })).toBeInTheDocument();
    expect(screen.getByText('Pick a runner to lift their line.')).toBeInTheDocument();
  });

  it('draws nothing for an empty order', () => {
    const { container } = renderOrder([]);

    expect(container).toBeEmptyDOMElement();
  });
});
