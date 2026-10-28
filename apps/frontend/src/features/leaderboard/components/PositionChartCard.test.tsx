import { Suspense, lazy } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PositionHistoryResponse } from '@runquest/shared';
import { buildPositionChart } from '../positionChartModel';
import { NO_FINISHED_WEEK_MESSAGE } from '../positionTexts';
import { ME_ID, YEAR_END_WEEKS, responseOf, runnerOf, six, twelve, weeksOf } from '../positionBoard.fixture';
import { PositionChartCard } from './PositionChartCard';

// Kortet runt grafen: rubrik, "Show as table", förklaringsraden, grafen eller tabellen, och lägena utan graf. "Current order" och valtillståndet
// hör till PositionView.

const renderCard = (data: PositionHistoryResponse = six(), selectedId: string | null = null) => {
  const model = buildPositionChart(data, { meId: ME_ID, mobile: true, selectedId });
  return { model, ...render(<PositionChartCard model={model} />) };
};

describe('PositionChartCard', () => {
  describe('text alternative', () => {
    it('has a button "Show as table" that swaps the chart for a table of the same runners with full names', async () => {
      const user = userEvent.setup();
      const { container } = renderCard();

      const button = screen.getByRole('button', { name: 'Show as table' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button.getAttribute('aria-controls')).toBe(container.querySelector('.rq-board-position__table-slot')!.id);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('img')).toBeVisible();

      await user.click(button);

      expect(button).toHaveAccessibleName('Show as table');
      expect(button).toHaveAttribute('aria-expanded', 'true');
      const table = screen.getByRole('table', { name: 'Position per week, weeks 27 to 34. Week 34 is this week so far.' });
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(6);
      expect(within(rows[4]).getByRole('rowheader')).toHaveTextContent('Daniel Lindblad Lüthje');
      expect(within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['#2', '#2', '#1', '#2', '#2', '#2', '#2', '#1']);
      expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('(you)');

      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('img')).toBeVisible();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('puts the table in a focusable, named scroll region, so a long period scrolls inside the card and not the page', async () => {
      const user = userEvent.setup();
      const { container } = renderCard();
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      const slot = container.querySelector<HTMLElement>('.rq-board-position__table-slot')!;
      expect(slot).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('region', { name: 'Position per week, weeks 27 to 34. Week 34 is this week so far.' })).toBe(slot);
      expect(slot).toContainElement(screen.getByRole('table'));
    });

    it('has no tab stop for the table while it is hidden', () => {
      const { container } = renderCard();

      expect(container.querySelector('.rq-board-position__table-slot')).toHaveAttribute('hidden');
      expect(screen.queryByRole('region', { name: /Position per week/ })).not.toBeInTheDocument();
    });

    it('keeps one column per week for the longest period of 26 weeks, and the table sits in the scroll region', async () => {
      const user = userEvent.setup();
      const long = responseOf(weeksOf(26, 9), [
        runnerOf('u-ada', 'Ada Lund', Array.from({ length: 26 }, () => 1)),
        runnerOf(ME_ID, 'Joel Lindberg', Array.from({ length: 26 }, () => 2)),
      ]);
      const { container } = renderCard(long);
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      const table = screen.getByRole('table');
      expect(within(table).getAllByRole('columnheader')).toHaveLength(27);
      expect(container.querySelector('.rq-board-position__table-slot')).toContainElement(table);
    });

    it('reads the weeks in the table as "week 27" and names the week in progress', async () => {
      const user = userEvent.setup();
      renderCard();
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
      expect(headers[0]).toHaveTextContent('Runner');
      expect(headers[1]).toHaveAccessibleName('week 27');
      expect(headers.at(-1)).toHaveTextContent('this week so far');
      expect(headers.at(-1)).toHaveAccessibleName(/week 34.*this week so far/);
    });

    it('speaks a week before a runner joined as "not in the group yet" and explains the dash in a footnote', async () => {
      const user = userEvent.setup();
      renderCard(twelve({ id: 'u-sara', firstIndex: 3 }));
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      const sara = within(screen.getByRole('table')).getByRole('rowheader', { name: /Sara Ek/ }).closest('tr')!;
      expect(within(sara).getAllByRole('cell')[0]).toHaveTextContent('—not in the group yet');
      expect(screen.getByText('— = not in the group yet')).toBeInTheDocument();
    });

    it('has no footnote when every runner has a placement in every week', async () => {
      const user = userEvent.setup();
      renderCard();
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      expect(screen.queryByText(/not in the group yet/)).not.toBeInTheDocument();
    });

    it('marks the week in progress in the table with the shared phrase, week 53 and the years included', async () => {
      const user = userEvent.setup();
      renderCard(responseOf(YEAR_END_WEEKS, [runnerOf('u-ada', 'Ada Lund', [1, 1, 2, 1, 1, 1, 1, 1]), runnerOf(ME_ID, 'Joel Lindberg', [2, 2, 1, 2, 2, 2, 2, 2])]));
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      const table = screen.getByRole('table');
      expect(table).toHaveAccessibleName('Position per week, week 50, 2026 to week 4, 2027. Week 4, 2027 is this week so far.');
      expect(within(table).getAllByRole('columnheader')[4]).toHaveAccessibleName('week 53, 2026');
    });
  });

  describe('the heading and the explanation', () => {
    it('has a heading and an eyebrow that says when the chart is read: "Read every Sunday midnight"', () => {
      renderCard();

      expect(screen.getByRole('heading', { name: 'Position over time' })).toBeInTheDocument();
      expect(screen.getByText(/Read every Sunday midnight/)).toBeInTheDocument();
    });

    it('shows the visual period in the eyebrow and hides it from the screen reader, because the image text carries the period', () => {
      renderCard();

      const range = screen.getByText('week 27-34');
      expect(range).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain('weeks 27 to 34');
    });

    it('names the years in the visible period across the year boundary, week 53 included', () => {
      renderCard(responseOf(YEAR_END_WEEKS, [runnerOf('u-ada', 'Ada Lund', [1, 1, 2, 1, 1, 1, 1, 1]), runnerOf(ME_ID, 'Joel Lindberg', [2, 2, 1, 2, 2, 2, 2, 2])]));

      expect(screen.getByText('week 50, 2026 - week 4, 2027')).toBeInTheDocument();
      expect(screen.getByRole('img').getAttribute('aria-label')).toContain('week 50, 2026 to week 4, 2027');
    });

    it('draws no dashed explanation box: the explanation is the eyebrow row', () => {
      const { container } = renderCard();

      expect(container.querySelector('.rq-board-note')).toBeNull();
    });
  });

  describe('modes', () => {
    it('draws nothing for a single runner', () => {
      const { container } = renderCard(responseOf(weeksOf(8), [runnerOf(ME_ID, 'Joel Lindberg', [1, 1, 1, 1, 1, 1, 1, 1])]));

      expect(container).toBeEmptyDOMElement();
    });

    it('draws nothing for a response without weeks', () => {
      const { container } = renderCard(responseOf([], [runnerOf(ME_ID, 'Joel Lindberg', []), runnerOf('u-ada', 'Ada Lund', [])]));

      expect(container).toBeEmptyDOMElement();
    });

    it('explains a group with no finished week with the shared message, and draws no chart and no toggle', () => {
      renderCard(responseOf(weeksOf(1, 34), [runnerOf('u-ada', 'Ada Lund', [1]), runnerOf(ME_ID, 'Joel Lindberg', [2])]));

      expect(screen.getByText(NO_FINISHED_WEEK_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Position over time' })).toBeInTheDocument();
    });

    it('draws two runners with one finished week', () => {
      renderCard(responseOf(weeksOf(2, 33), [runnerOf('u-ada', 'Ada Lund', [1, 1]), runnerOf(ME_ID, 'Joel Lindberg', [2, 2])]));

      expect(screen.getByRole('img')).toBeInTheDocument();
    });
  });

  describe('lazy loading', () => {
    it('loads through a dynamic import, as the Position tab does, and lets the chart load on its own too', async () => {
      const LazyCard = lazy(() => import('./PositionChartCard').then((module) => ({ default: module.PositionChartCard })));
      const model = buildPositionChart(six(), { meId: ME_ID, mobile: true });
      render(
        <Suspense fallback={<p>Loading position</p>}>
          <LazyCard model={model} />
        </Suspense>,
      );

      expect(await screen.findByRole('img')).toBeInTheDocument();
      expect(typeof (await import('./PackPositionChart')).PackPositionChart).toBe('function');
    });
  });
});
