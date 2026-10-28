import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PositionHistoryResponse } from '@runquest/shared';
import { buildPositionChart, type PositionChartModel } from '../positionChartModel';
import { ME_ID, YEAR_END_WEEKS, pictureOf, responseOf, runnerOf, six, twelve, weeksOf } from '../positionBoard.fixture';
import { PackPositionChart } from './PackPositionChart';

// Grafen ritas ur vymodellen (positionChartModel); här prövas det komponenten gör: texten för skärmläsaren, linjerna, slutpunkterna, valt läge och
// de olika lägena. Måtten och färgerna läggs av CSS och prövas i positionBoardCss.test.ts och i webbläsaren (jsdom har ingen layout).

const modelOf = (data: PositionHistoryResponse, selectedId: string | null = null, mobile = true): PositionChartModel =>
  buildPositionChart(data, { meId: ME_ID, mobile, selectedId });

const renderChart = (data: PositionHistoryResponse, selectedId: string | null = null, mobile = true) => {
  const model = modelOf(data, selectedId, mobile);
  return { model, ...render(<PackPositionChart model={model} />) };
};

const lineOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`.rq-board-position__line[data-line="${id}"]`)!;
const dotsOf = (line: HTMLElement) => Array.from(line.querySelectorAll<HTMLElement>('.rq-board-position__dot'));
const nameOf = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`.rq-board-position__name[data-line="${id}"]`)!;
const varOf = (node: HTMLElement, name: string) => node.style.getPropertyValue(name);

describe('PackPositionChart', () => {
  describe('text alternative', () => {
    it('is one image named by the sentence from the model, with every runner and the week in progress in it', () => {
      const { model } = renderChart(six());

      const image = screen.getByRole('img', { name: model.ariaLabel });
      expect(image).toBeInTheDocument();
      expect(model.ariaLabel).toBe(
        'Position over time, weeks 27 to 34. Week 34 is this week so far. Karl Persson #1, Joel Lindberg (you) #2, Adam Einstein #3, Nicklas von Elling #4, Daniel Lindblad Lüthje #5, Johan Björell #6.',
      );
      expect(screen.getAllByRole('img')).toHaveLength(1);
    });

    it('reads weeks as "week 27" and never as the visual range or the W27 labels', () => {
      const { model } = renderChart(six());

      expect(model.ariaLabel).toContain('weeks 27 to 34');
      expect(model.ariaLabel).not.toMatch(/W2\d|27-34/);
    });

    it('hides the axis numbers, the dots, the week labels, the names and the initials from the screen reader', () => {
      const { container } = renderChart(six());
      const image = screen.getByRole('img');

      const parts = Array.from(image.querySelectorAll<HTMLElement>('.rq-board-position__axis, .rq-board-position__field, .rq-board-position__names, .rq-board-position__weeks'));
      expect(parts).toHaveLength(4);
      for (const part of parts) expect(part).toHaveAttribute('aria-hidden', 'true');
      for (const node of container.querySelectorAll('.rq-board-position__dot, .rq-board-position__hollow, .rq-board-position__endpoint, .rq-board-position__name')) {
        expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
      }
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('lines', () => {
    it('draws one line per runner, and only the signed-in runner is marked as yours', () => {
      const { container, model } = renderChart(six());

      const lines = Array.from(container.querySelectorAll<HTMLElement>('.rq-board-position__line'));
      expect(lines.map((line) => line.dataset.line).sort()).toEqual(model.lines.map((line) => line.id).sort());
      expect(lines.filter((line) => line.dataset.me === 'true').map((line) => line.dataset.line)).toEqual([ME_ID]);
    });

    it('paints the lines in the order of the model, yours and the selected one last so they are on top', () => {
      const { container } = renderChart(six(), 'u-adam');

      const order = Array.from(container.querySelectorAll<HTMLElement>('.rq-board-position__line')).map((line) => line.dataset.line);
      expect(order.slice(-2)).toEqual([ME_ID, 'u-adam']);
    });

    it('draws no colour per runner: no inline colour, and every line is styled by data attributes only', () => {
      const { container } = renderChart(twelve());

      expect(container.querySelectorAll('[style]').length).toBeGreaterThan(20);
      for (const node of container.querySelectorAll<HTMLElement>('[style]')) {
        const properties = Array.from({ length: node.style.length }, (_, i) => node.style.item(i));
        expect(properties.filter((property) => !property.startsWith('--'))).toEqual([]);
      }
      expect(container.querySelectorAll('[stroke], [fill]')).toHaveLength(0);
    });

    it('puts the first name at the line end and keeps the full name for the aria text', () => {
      const { container, model } = renderChart(six());

      expect(nameOf(container, 'u-daniel')).toHaveTextContent('Daniel');
      expect(nameOf(container, 'u-daniel').textContent).toBe('Daniel');
      expect(nameOf(container, 'u-nicklas').textContent).toBe('Nicklas');
      expect(container.textContent).not.toContain('Lindblad');
      expect(model.ariaLabel).toContain('Daniel Lindblad Lüthje');
    });

    it('places each name on the row of the live placement', () => {
      const { container, model } = renderChart(twelve());

      for (const line of model.lines) {
        expect(varOf(nameOf(container, line.id), '--p')).toBe(String(line.position));
      }
    });

    it('draws a plain dot for every other finished week, a hollow point for the week in progress and the picture at the last finished week', () => {
      const { container } = renderChart(six());
      const joel = lineOf(container, ME_ID);

      expect(dotsOf(joel)).toHaveLength(6);
      expect(joel.querySelectorAll('.rq-board-position__hollow')).toHaveLength(1);
      expect(joel.querySelectorAll('.rq-board-position__endpoint')).toHaveLength(1);
      expect(joel.querySelectorAll('polyline')).toHaveLength(1);
      expect(joel.querySelectorAll('line')).toHaveLength(1);
      // Prickarna är enkla: ingen text i dem.
      for (const dot of dotsOf(joel)) expect(dot.textContent).toBe('');
    });

    it('ends each line with the profile picture of the runner when there is one', () => {
      const { container } = renderChart(six());

      const image = lineOf(container, ME_ID).querySelector<HTMLImageElement>('.rq-board-position__endpoint img')!;
      expect(image).toHaveAttribute('src', pictureOf(ME_ID));
      expect(image).toHaveAttribute('alt', '');
    });

    it('falls back to the initials when there is no picture', () => {
      const { container } = renderChart(six());

      const endpoint = lineOf(container, 'u-daniel').querySelector<HTMLElement>('.rq-board-position__endpoint')!;
      expect(endpoint.querySelector('img')).toBeNull();
      expect(endpoint).toHaveTextContent('DL');
    });

    it('falls back to the initials when the picture is broken', () => {
      const { container } = renderChart(six());
      const endpoint = lineOf(container, 'u-karl').querySelector<HTMLElement>('.rq-board-position__endpoint')!;

      fireEvent.error(endpoint.querySelector('img')!);

      expect(endpoint.querySelector('img')).toBeNull();
      expect(endpoint).toHaveTextContent('KP');
    });

    it('tries the new picture again when a runner gets a different one after a broken one', () => {
      const first = six();
      const { container, rerender } = render(<PackPositionChart model={modelOf(first)} />);
      fireEvent.error(lineOf(container, 'u-karl').querySelector('img')!);

      const second = six();
      second.runners[0] = { ...second.runners[0], profile_picture: 'https://img.test/karl-new.png' };
      rerender(<PackPositionChart model={modelOf(second)} />);

      expect(lineOf(container, 'u-karl').querySelector('.rq-board-position__endpoint img')).toHaveAttribute('src', 'https://img.test/karl-new.png');
    });
  });

  describe('selected runner', () => {
    it('lifts the selected line, and dims the others, through data attributes the stylesheet reads', () => {
      const { container } = renderChart(six(), 'u-adam');

      const selected = lineOf(container, 'u-adam');
      expect(selected).toHaveAttribute('data-selected', 'true');
      expect(selected).not.toHaveAttribute('data-dimmed', 'true');
      expect(nameOf(container, 'u-adam')).toHaveAttribute('data-selected', 'true');
      for (const id of ['u-karl', ME_ID, 'u-nicklas', 'u-daniel', 'u-johan']) {
        expect(lineOf(container, id)).toHaveAttribute('data-dimmed', 'true');
        expect(nameOf(container, id)).toHaveAttribute('data-dimmed', 'true');
        expect(lineOf(container, id)).not.toHaveAttribute('data-selected', 'true');
      }
    });

    it('dims nothing when nobody is selected', () => {
      const { container } = renderChart(six());

      expect(container.querySelectorAll('[data-dimmed="true"]')).toHaveLength(0);
      expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);
    });

    it('can lift your own line too, and everyone else dims', () => {
      const { container } = renderChart(six(), ME_ID);

      expect(lineOf(container, ME_ID)).toHaveAttribute('data-selected', 'true');
      expect(lineOf(container, ME_ID)).toHaveAttribute('data-me', 'true');
      expect(lineOf(container, 'u-karl')).toHaveAttribute('data-dimmed', 'true');
    });
  });

  describe('week in progress', () => {
    it('explains the hollow point in a legend: the week and "this week so far"', () => {
      renderChart(six());

      expect(screen.getByText('W34 · this week so far')).toBeInTheDocument();
    });

    it('hides the legend from the screen reader, which already has the sentence in the image text', () => {
      renderChart(six());

      expect(screen.getByText('W34 · this week so far').closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  describe('height and spacing', () => {
    it.each([2, 6, 12])('for %i runners the plot is as tall as the model says, with a row for every placement and no row under 24 px', (count) => {
      const data = count === 12 ? twelve() : count === 6 ? six() : responseOf(weeksOf(8), [runnerOf('u-a', 'Ada Lund', [1, 2, 1, 2, 1, 2, 1, 1]), runnerOf(ME_ID, 'Joel Lindberg', [2, 1, 2, 1, 2, 1, 2, 2])]);
      for (const mobile of [true, false]) {
        const { container, model, unmount } = renderChart(data, null, mobile);
        const plot = container.querySelector<HTMLElement>('.rq-board-position__chart')!;

        expect(varOf(plot, '--rq-board-position-h')).toBe(`${model.geometry.height}px`);
        expect(varOf(plot, '--rq-board-position-row')).toBe(`${model.geometry.rowHeight}px`);
        expect(model.geometry.rowHeight).toBeGreaterThanOrEqual(24);
        expect(container.querySelectorAll('.rq-board-position__axis-num')).toHaveLength(count);
        expect(container.querySelectorAll('.rq-board-position__name')).toHaveLength(count);
        unmount();
      }
    });

    it('gives each runner its own row: the live placements are all different', () => {
      const { container } = renderChart(twelve());

      const rows = Array.from(container.querySelectorAll<HTMLElement>('.rq-board-position__name')).map((name) => varOf(name, '--p'));
      expect(new Set(rows).size).toBe(12);
    });

    it('asks for no scrolling: the plot has no fixed width and nothing scrolls', () => {
      const { container } = renderChart(twelve());

      expect(container.querySelector('[style*="width"]')).toBeNull();
      expect(container.querySelector('[style*="overflow"]')).toBeNull();
    });
  });

  describe('a runner who joined in the middle of the period', () => {
    it('starts the line at the first placement: no points and no line before it', () => {
      const { container, model } = renderChart(twelve({ id: 'u-sara', firstIndex: 3 }));

      const sara = lineOf(container, 'u-sara');
      const line = model.lines.find((l) => l.id === 'u-sara')!;
      expect(line.points[0].weekIndex).toBe(3);
      // Fem avslutade veckor (3..6) och den pågående: tre prickar, en slutpunkt och en ihålig punkt.
      expect(dotsOf(sara)).toHaveLength(3);
      const first = sara.querySelector('polyline')!.getAttribute('points')!.split(' ')[0].split(',');
      expect(Number(first[0])).toBeCloseTo((3 / 7) * 100, 2);
    });

    it('draws only the hollow point and the name for a runner who joined this week', () => {
      const data = responseOf(weeksOf(4), [
        runnerOf('u-ada', 'Ada Lund', [1, 1, 1, 1]),
        runnerOf(ME_ID, 'Joel Lindberg', [2, 2, 2, 2]),
        runnerOf('u-new', 'Nils Ek', [null, null, null, 3]),
      ]);
      const { container } = renderChart(data);

      const fresh = lineOf(container, 'u-new');
      expect(fresh.querySelectorAll('.rq-board-position__hollow')).toHaveLength(1);
      expect(fresh.querySelectorAll('.rq-board-position__endpoint')).toHaveLength(0);
      expect(fresh.querySelectorAll('polyline, line')).toHaveLength(0);
      expect(nameOf(container, 'u-new')).toHaveTextContent('Nils');
    });
  });

  describe('week 53', () => {
    it('labels the weeks across the year boundary and names the years for the screen reader', () => {
      const data = responseOf(YEAR_END_WEEKS, [runnerOf('u-ada', 'Ada Lund', [1, 1, 2, 1, 1, 1, 1, 1]), runnerOf(ME_ID, 'Joel Lindberg', [2, 2, 1, 2, 2, 2, 2, 2])]);
      const { container, model } = renderChart(data);

      const labels = Array.from(container.querySelectorAll('.rq-board-position__week')).map((node) => node.textContent);
      expect(labels).toEqual(['W50', 'W51', 'W52', 'W53', 'W1', 'W2', 'W3', 'W4']);
      expect(model.ariaLabel).toContain('week 50, 2026 to week 4, 2027');
      expect(screen.getByText('W4 · this week so far')).toBeInTheDocument();
    });
  });

  describe('week labels', () => {
    it('thins the labels of a long period so they never overlap, and keeps the week in progress', () => {
      const data = responseOf(weeksOf(26, 9), [runnerOf('u-ada', 'Ada Lund', Array.from({ length: 26 }, () => 1)), runnerOf(ME_ID, 'Joel Lindberg', Array.from({ length: 26 }, () => 2))]);
      const { container } = renderChart(data);

      const labels = Array.from(container.querySelectorAll('.rq-board-position__week')).map((node) => node.textContent);
      expect(labels.length).toBeLessThanOrEqual(8);
      expect(labels.at(-1)).toBe('W34');
    });
  });
});
