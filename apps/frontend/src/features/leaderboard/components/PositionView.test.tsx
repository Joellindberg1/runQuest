import { Suspense, lazy } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PositionHistoryResponse } from '@runquest/shared';
import { setViewportWidth } from '@/test/viewport';
import { NO_FINISHED_WEEK_MESSAGE } from '../positionTexts';
import { ME_ID, responseOf, runnerOf, six, twelve, weeksOf } from '../positionBoard.fixture';
import { PositionView } from './PositionView';

// Hela Position-fliken som en lazy-laddningsbar enhet: kortet med grafen eller tabellen och "Current order". Föräldern äger valtillståndet, så ett
// klick på en rad i legenden lyfter linjen i grafen. Kortet (rubrik, tabell, förklaringsrad) prövas i PositionChartCard.test, raderna i CurrentOrder.test.

const MOBILE = 390;
const DESKTOP = 1440;

const renderView = (data: PositionHistoryResponse = six(), width = MOBILE, meId: string | null = ME_ID) => {
  setViewportWidth(width);
  return render(<PositionView data={data} meId={meId} />);
};

const lineOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`.rq-board-position__line[data-line="${id}"]`)!;
const rowHeightOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.rq-board-position__chart')!.style.getPropertyValue('--rq-board-position-row');

describe('PositionView', () => {
  describe('the shared selection', () => {
    it('lifts the line of a runner picked in Current order and dims the others, and a second click deselects', async () => {
      const user = userEvent.setup();
      const { container } = renderView();

      await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));

      expect(screen.getByRole('button', { name: /Adam Einstein/ })).toHaveAttribute('aria-pressed', 'true');
      expect(lineOf(container, 'u-adam')).toHaveAttribute('data-selected', 'true');
      expect(lineOf(container, 'u-karl')).toHaveAttribute('data-dimmed', 'true');
      expect(lineOf(container, ME_ID)).toHaveAttribute('data-dimmed', 'true');

      await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));

      expect(screen.getByRole('button', { name: /Adam Einstein/ })).toHaveAttribute('aria-pressed', 'false');
      expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
      expect(container.querySelectorAll('[data-dimmed="true"]')).toHaveLength(0);
    });

    it('moves the selection to another runner, and only one runner is selected at a time', async () => {
      const user = userEvent.setup();
      const { container } = renderView();

      await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));
      await user.click(screen.getByRole('button', { name: /Karl Persson/ }));

      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
      expect(lineOf(container, 'u-karl')).toHaveAttribute('data-selected', 'true');
      expect(lineOf(container, 'u-adam')).toHaveAttribute('data-dimmed', 'true');
    });

    it('works from the keyboard: Enter selects, Space deselects', async () => {
      const user = userEvent.setup();
      const { container } = renderView();

      screen.getByRole('button', { name: /Johan/ }).focus();
      await user.keyboard('{Enter}');
      expect(lineOf(container, 'u-johan')).toHaveAttribute('data-selected', 'true');
      await user.keyboard(' ');
      expect(lineOf(container, 'u-johan')).not.toHaveAttribute('data-selected', 'true');
    });

    it('can select the signed-in runner, who keeps the gold line and the "You" tag', async () => {
      const user = userEvent.setup();
      const { container } = renderView();

      await user.click(screen.getByRole('button', { name: /Joel Lindberg/ }));

      expect(lineOf(container, ME_ID)).toHaveAttribute('data-selected', 'true');
      expect(lineOf(container, ME_ID)).toHaveAttribute('data-me', 'true');
      expect(screen.getByText('You')).toBeInTheDocument();
    });

    it('keeps the selection when the chart is switched to the table and back', async () => {
      const user = userEvent.setup();
      const { container } = renderView();

      await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));
      await user.click(screen.getByRole('button', { name: 'Show as table' }));
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      expect(lineOf(container, 'u-adam')).toHaveAttribute('data-selected', 'true');
    });

    it('keeps Current order usable beside or under the table', async () => {
      const user = userEvent.setup();
      renderView();
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      expect(screen.getAllByRole('button', { name: /#\d/ })).toHaveLength(6);
    });

    it('drops a selection whose runner is no longer in a fresh response', async () => {
      const user = userEvent.setup();
      const { container, rerender } = renderView();
      await user.click(screen.getByRole('button', { name: /Adam Einstein/ }));

      const fresh = six();
      fresh.runners = fresh.runners.filter((runner) => runner.user_id !== 'u-adam');
      rerender(<PositionView data={fresh} meId={ME_ID} />);

      expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
      expect(container.querySelectorAll('[data-dimmed="true"]')).toHaveLength(0);
    });
  });

  describe('one component at every width', () => {
    it.each([['mobile', MOBILE], ['desktop', DESKTOP]])('has exactly one Current order and one chart on %s', (_, width) => {
      const { container } = renderView(six(), width);

      expect(screen.getAllByRole('list')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: /#\d/ })).toHaveLength(6);
      expect(screen.getAllByRole('img')).toHaveLength(1);
      expect(container.querySelectorAll('.rq-board-position-order')).toHaveLength(1);
      expect(container.querySelectorAll('.rq-board-position__chart')).toHaveLength(1);
    });

    it('has the chart first and Current order after it in the DOM, which puts it beside the chart on desktop and under it on mobile', () => {
      const { container } = renderView(six(), MOBILE);

      const chart = container.querySelector('.rq-board-position__chart')!;
      const order = container.querySelector('.rq-board-position-order')!;
      expect(chart.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('spaces the rows for the width: tighter on desktop with many runners, looser on mobile', () => {
      const mobile = renderView(twelve(), MOBILE);
      const mobileRow = rowHeightOf(mobile.container);
      mobile.unmount();
      const desktop = renderView(twelve(), DESKTOP);

      expect(mobileRow).toBe('33px');
      expect(rowHeightOf(desktop.container)).toBe('27px');
    });
  });

  describe('modes', () => {
    it('draws nothing for a single runner', () => {
      const { container } = renderView(responseOf(weeksOf(8), [runnerOf(ME_ID, 'Joel Lindberg', [1, 1, 1, 1, 1, 1, 1, 1])]));

      expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing for a response without weeks', () => {
      const { container } = renderView(responseOf([], [runnerOf(ME_ID, 'Joel Lindberg', []), runnerOf('u-ada', 'Ada Lund', [])]));

      expect(container).toBeEmptyDOMElement();
    });

    it('explains a group with no finished week with the shared message, and still shows Current order', () => {
      renderView(responseOf(weeksOf(1, 34), [runnerOf('u-ada', 'Ada Lund', [1]), runnerOf(ME_ID, 'Joel Lindberg', [2])]));

      expect(screen.getByText(NO_FINISHED_WEEK_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Show as/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('draws two runners with one finished week', () => {
      renderView(responseOf(weeksOf(2, 33), [runnerOf('u-ada', 'Ada Lund', [1, 1]), runnerOf(ME_ID, 'Joel Lindberg', [2, 2])]));

      expect(screen.getByRole('img')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /#\d/ })).toHaveLength(2);
    });

    it('works with no signed-in runner: nobody is marked as you', () => {
      const { container } = renderView(six(), MOBILE, null);

      expect(screen.queryByText('You')).not.toBeInTheDocument();
      expect(container.querySelector('[data-me="true"]')).toBeNull();
    });

    it('works with twelve runners on mobile and desktop', () => {
      for (const width of [MOBILE, DESKTOP]) {
        const { container, unmount } = renderView(twelve(), width);
        expect(container.querySelectorAll('.rq-board-position__line')).toHaveLength(12);
        expect(screen.getAllByRole('button', { name: /#\d/ })).toHaveLength(12);
        unmount();
      }
    });
  });

  describe('lazy loading', () => {
    it('loads through a dynamic import, as the Position tab does', async () => {
      setViewportWidth(MOBILE);
      const LazyView = lazy(() => import('./PositionView').then((module) => ({ default: module.PositionView })));
      render(
        <Suspense fallback={<p>Loading position</p>}>
          <LazyView data={six()} meId={ME_ID} />
        </Suspense>,
      );

      expect(await screen.findByRole('img')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Current order' })).toBeInTheDocument();
    });

    it('lets Current order load on its own, for a tab that wants to split the two', async () => {
      const order = await import('./CurrentOrder');

      expect(typeof order.CurrentOrder).toBe('function');
    });
  });
});
