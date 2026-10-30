import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ViewTab } from '@/shared/components/ViewTabs';
import type { BoardView } from '../boardViews';
import { BoardTabs } from './BoardTabs';

// Flikraden på Board: fyra flikar som på 320 px inte ryms och därför scrollar i sidled (lika breda flikar, scroll i raden), med kantfade åt det håll det finns fler flikar, och med
// "på väg"-signalen (pekare eller fokus på en flik) som sidan använder för att förladda Position-vyns chunk. jsdom har ingen layout, så måtten lånas ut per element;
// toningen (mask), zonens bredd, 44 px och fokusringen är CSS som mäts i webbläsaren (e2e).

const FOUR: readonly ViewTab<BoardView>[] = [
  { key: 'season', label: 'All-time' },
  { key: 'week', label: 'Week' },
  { key: 'streaks', label: 'Streaks' },
  { key: 'position', label: 'Position' },
];

const ROW_WIDTH = 282;
const TABS_WIDTH = 430;

function lendLayout(tablist: HTMLElement, widths: { client: number; scroll: number }) {
  Object.defineProperty(tablist, 'clientWidth', { configurable: true, value: widths.client });
  Object.defineProperty(tablist, 'scrollWidth', { configurable: true, value: widths.scroll });
}

function renderRow(widths: { client: number; scroll: number }, view: BoardView = 'season', onIntent = vi.fn()) {
  render(<BoardTabs tabs={FOUR} view={view} onChange={vi.fn()} onIntent={onIntent} />);
  const tablist = screen.getByRole('tablist', { name: 'Standings view' });
  lendLayout(tablist, widths);
  // Måtten fanns inte vid första mätningen (monteringen); raden mäts om när den scrollar.
  act(() => {
    fireEvent.scroll(tablist);
  });
  return { tablist, wrap: tablist.parentElement as HTMLElement, onIntent };
}

const edges = (wrap: HTMLElement) => ({ start: wrap.getAttribute('data-fade-start'), end: wrap.getAttribute('data-fade-end') });

describe('BoardTabs', () => {
  describe('the row of tabs', () => {
    it('has the four tabs in order, with the selected one marked', () => {
      renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH }, 'position');

      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All-time', 'Week', 'Streaks', 'Position']);
      expect(screen.getByRole('tab', { name: 'Position' })).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps the tab row itself as the only tablist, with the fade as markup around it and nothing the screen reader reads', () => {
      const { tablist, wrap } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

      expect(screen.getAllByRole('tablist')).toHaveLength(1);
      expect(wrap).not.toHaveAttribute('role');
      expect(wrap.children).toHaveLength(1);
      expect(wrap.firstElementChild).toBe(tablist);
    });
  });

  describe('the fade at the edges', () => {
    it('fades the end of a row that does not fit its tabs, and nothing at the start', () => {
      const { wrap } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

      expect(edges(wrap)).toEqual({ start: 'false', end: 'true' });
    });

    it('draws no fade when all four tabs fit', () => {
      const { wrap } = renderRow({ client: TABS_WIDTH, scroll: TABS_WIDTH });

      expect(edges(wrap)).toEqual({ start: 'false', end: 'false' });
    });

    it('moves the fade to the start when the row has been scrolled to its end, and to both sides in between', () => {
      const { tablist, wrap } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

      tablist.scrollLeft = 70;
      act(() => {
        fireEvent.scroll(tablist);
      });
      expect(edges(wrap)).toEqual({ start: 'true', end: 'true' });

      tablist.scrollLeft = TABS_WIDTH - ROW_WIDTH;
      act(() => {
        fireEvent.scroll(tablist);
      });
      expect(edges(wrap)).toEqual({ start: 'true', end: 'false' });
    });
  });

  describe('heading for a tab', () => {
    it('reports the tab the pointer moves over, before it is clicked', async () => {
      const { onIntent } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

      await userEvent.hover(screen.getByRole('tab', { name: 'Position' }));

      expect(onIntent).toHaveBeenCalledWith('position');
    });

    it('reports a tab that gets keyboard focus', () => {
      const { onIntent } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

      screen.getByRole('tab', { name: 'Week' }).focus();

      expect(onIntent).toHaveBeenCalledWith('week');
    });

    it('reports nothing for the empty space in the row', () => {
      const { tablist, onIntent } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

      fireEvent.pointerOver(tablist);

      expect(onIntent).not.toHaveBeenCalled();
    });
  });
});
