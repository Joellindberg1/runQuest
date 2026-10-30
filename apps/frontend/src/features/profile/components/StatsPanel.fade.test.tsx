import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from '@/test/renderApp';
import { user } from '../profile.fixture';
import { StatsPanel } from './StatsPanel';

// Kantfaden på flikraden: raden scrollar i sidled när fem flikar inte ryms, och fadens kanter visas bara åt det håll det finns mer att scrolla mot.
// jsdom har ingen layout, så måtten lånas ut per element; själva toningen (mask) och dess zon är CSS som mäts i webbläsaren.

const runner = user({ id: 'u-karl', name: 'Karl Persson', total_xp: 5539 });
const NOW = new Date('2026-10-04T10:00:00Z');

const ROW_WIDTH = 282;
const TABS_WIDTH = 430;

function lendLayout(tablist: HTMLElement, widths: { client: number; scroll: number }) {
  Object.defineProperty(tablist, 'clientWidth', { configurable: true, value: widths.client });
  Object.defineProperty(tablist, 'scrollWidth', { configurable: true, value: widths.scroll });
}

function renderRow(widths: { client: number; scroll: number }) {
  renderWithApp(<StatsPanel user={runner} now={NOW} isDesktop={false} view="distance" onChange={vi.fn()} label="Your stats" showPosition />, { entry: '/profile' });
  const tablist = screen.getByRole('tablist', { name: 'Your stats' });
  lendLayout(tablist, widths);
  // Måtten fanns inte vid första mätningen (monteringen); raden mäts om när den scrollar.
  act(() => {
    fireEvent.scroll(tablist);
  });
  return { tablist, wrap: tablist.parentElement as HTMLElement };
}

const edges = (wrap: HTMLElement) => ({ start: wrap.getAttribute('data-fade-start'), end: wrap.getAttribute('data-fade-end') });

afterEach(() => vi.restoreAllMocks());

describe('StatsPanel — the fade at the edges of the tab row', () => {
  it('fades the end of a row that does not fit its tabs, and nothing at the start', () => {
    const { wrap } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

    expect(edges(wrap)).toEqual({ start: 'false', end: 'true' });
  });

  it('draws no fade when all five tabs fit', () => {
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

  it('keeps the tab row itself as the only tablist, with the fade as markup around it and nothing the screen reader reads', () => {
    const { tablist, wrap } = renderRow({ client: ROW_WIDTH, scroll: TABS_WIDTH });

    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(wrap).not.toHaveAttribute('role');
    expect(wrap.children).toHaveLength(1);
    expect(wrap.firstElementChild).toBe(tablist);
  });

  it('measures the row again when the Position tab joins it, because the row itself does not change size', () => {
    // Raden är 300 px bred och de fem flikarna behöver 430 px. Fyra flikar ryms (raden mäts bara om när antalet flikar ändras, ingen storleksändring och ingen scroll syns för ResizeObserver).
    function Host() {
      const [showPosition, setShowPosition] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShowPosition(true)}>
            Show Position
          </button>
          <StatsPanel user={runner} now={NOW} isDesktop={false} view="distance" onChange={vi.fn()} label="Your stats" showPosition={showPosition} />
        </>
      );
    }
    renderWithApp(<Host />, { entry: '/profile' });
    const tablist = screen.getByRole('tablist', { name: 'Your stats' });
    const wrap = tablist.parentElement as HTMLElement;
    lendLayout(tablist, { client: 300, scroll: TABS_WIDTH });
    expect(edges(wrap)).toEqual({ start: 'false', end: 'false' });
    expect(screen.getAllByRole('tab')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Show Position' }));

    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getByRole('tablist', { name: 'Your stats' })).toBe(tablist);
    expect(edges(wrap)).toEqual({ start: 'false', end: 'true' });
  });
});
