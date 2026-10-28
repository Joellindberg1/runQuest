import { Suspense, lazy } from 'react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import postcss from 'postcss';
import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';
import { buildPositionProfileModel, type PositionGraphModel, type PositionProfileModel } from '../positionModel';
import { PositionChart } from './PositionChart';

// Veckor ur svaret: första måndagen 2026-07-06 = vecka 28 (som positionModel.test).
const weeksOf = (count: number, firstIsoWeek = 27): PositionWeek[] =>
  Array.from({ length: count }, (_, i) => ({
    start: '2026-07-06',
    end: '2026-07-12',
    iso_week: firstIsoWeek + i,
    iso_year: 2026,
    is_current_week: i === count - 1,
  }));

const YEAR_END: PositionWeek[] = [
  { start: '2026-12-14', end: '2026-12-20', iso_week: 51, iso_year: 2026, is_current_week: false },
  { start: '2026-12-21', end: '2026-12-27', iso_week: 52, iso_year: 2026, is_current_week: false },
  { start: '2026-12-28', end: '2027-01-03', iso_week: 53, iso_year: 2026, is_current_week: false },
  { start: '2027-01-04', end: '2027-01-10', iso_week: 1, iso_year: 2027, is_current_week: true },
];

const runner = (user_id: string, positions: Array<number | null>): PositionRunner => ({
  user_id,
  name: user_id.toUpperCase(),
  profile_picture: null,
  member_since: null,
  positions,
});

const history = (positions: Array<number | null>, members = 6, weeks = weeksOf(positions.length)): PositionHistoryResponse => ({
  as_of: '2026-08-26',
  weeks,
  runners: [runner('me', positions), ...Array.from({ length: members - 1 }, (_, i) => runner(`other-${i}`, positions.map(() => null)))],
});

const modelOf = (positions: Array<number | null>, members = 6, weeks?: PositionWeek[]): PositionProfileModel =>
  buildPositionProfileModel(history(positions, members, weeks), 'me');

const readyOf = (positions: Array<number | null>, members = 6, weeks?: PositionWeek[]): PositionGraphModel => {
  const model = modelOf(positions, members, weeks);
  if (model.mode !== 'ready') throw new Error(`expected ready, got ${model.mode}`);
  return model;
};

// Prototypens Joel: #1 i sex av sju avslutade veckor, #2 den pågående.
const EIGHT = [1, 1, 2, 1, 1, 1, 1, 2];

const CHART_LIBRARY = /recharts|chart\.?js|^d3|victory|visx|nivo|echarts|apexcharts|plotly/i;

// Råtext som i guards.test: komponentens egen källa, stilfilen och frontendens package.json.
const raw = (import.meta.glob(['./PositionChart.tsx', '../../../../package.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const sourceOf = raw['./PositionChart.tsx'];
// Stilfilen läses från disk (vitest css: false tömmer ?raw av .css); sökvägen i en variabel, annars skriver Vite om new URL('literal', import.meta.url).
const CSS_FILE = '../positionChart.css';
const cssOf = readFileSync(fileURLToPath(new URL(CSS_FILE, import.meta.url)), 'utf8');
const packageOf = JSON.parse(raw['../../../../package.json']) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

const dots = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('.rq-profile-position__dot'));

describe('PositionChart', () => {
  it('PositionChart imports no chart library', () => {
    const imports = [...sourceOf.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((name) => CHART_LIBRARY.test(name))).toEqual([]);

    const declared = Object.keys({ ...packageOf.dependencies, ...packageOf.devDependencies });
    expect(declared.length).toBeGreaterThan(10);
    expect(declared.filter((name) => CHART_LIBRARY.test(name))).toEqual([]);
  });

  describe('text alternative', () => {
    it('is one image named by the sentence from the model, with the dots hidden from the screen reader', () => {
      const model = readyOf(EIGHT);
      const { container } = render(<PositionChart model={model} />);

      const image = screen.getByRole('img', { name: model.summary });
      expect(image).toBeInTheDocument();
      expect(model.summary).toBe(
        'Position in the group, week 27–34: week 27 #1, week 28 #1, week 29 #2, week 30 #1, week 31 #1, week 32 #1, week 33 #1, this week so far #2',
      );
      expect(dots(container)).toHaveLength(8);
      for (const dot of dots(container)) expect(dot.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('has a button "Show as table" that toggles aria-expanded and reveals a table with header cells', async () => {
      const user = userEvent.setup();
      const model = readyOf(EIGHT);
      render(<PositionChart model={model} />);

      const button = screen.getByRole('button', { name: 'Show as table' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();

      await user.click(button);

      expect(button).toHaveAttribute('aria-expanded', 'true');
      const table = screen.getByRole('table', { name: model.tableCaption });
      expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Week', 'Position']);
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(8);
      expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('W27week 27');
      expect(within(rows[7]).getByRole('cell')).toHaveTextContent('#2');
      expect(within(rows[7]).getByRole('cell')).toHaveTextContent('this week so far');

      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('the button controls the table it reveals', async () => {
      const user = userEvent.setup();
      render(<PositionChart model={readyOf(EIGHT)} />);
      const button = screen.getByRole('button', { name: 'Show as table' });
      await user.click(button);

      expect(button.getAttribute('aria-controls')).toBe(screen.getByRole('table').parentElement?.id);
    });

    it('speaks a week before the runner joined as "not in the group yet" and explains the dash in a footnote', async () => {
      const user = userEvent.setup();
      render(<PositionChart model={readyOf([null, null, 3, 2, 2, 1])} />);
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      const table = screen.getByRole('table');
      const first = within(table).getAllByRole('row')[1];
      expect(within(first).getByRole('cell')).toHaveTextContent('—not in the group yet');
      expect(screen.getByText('— = not in the group yet')).toBeInTheDocument();
    });

    it('has no footnote when the runner has a placement every week', async () => {
      const user = userEvent.setup();
      render(<PositionChart model={readyOf([3, 2, 1, 2])} />);
      await user.click(screen.getByRole('button', { name: 'Show as table' }));

      expect(screen.queryByText(/not in the group yet/)).not.toBeInTheDocument();
    });
  });

  describe('axis and dots', () => {
    it('draws week labels and one grid row per axis row, but no axis numbers', () => {
      const model = readyOf(EIGHT);
      const { container } = render(<PositionChart model={model} />);

      const labels = Array.from(container.querySelectorAll('.rq-profile-position__week')).map((node) => node.textContent);
      expect(labels).toEqual(['W27', 'W28', 'W29', 'W30', 'W31', 'W32', 'W33', 'W34']);
      expect(container.querySelectorAll('.rq-profile-position__grid')).toHaveLength(model.gridRows);
      // De enda siffrorna i grafytan sitter i dottarna: inga #1…#6 vid rutnätet.
      const plot = container.querySelector('.rq-profile-position__plot') as HTMLElement;
      const outsideDots = Array.from(plot.querySelectorAll('*')).filter((node) => node.children.length === 0 && /\d/.test(node.textContent ?? '') && !node.closest('.rq-profile-position__dot'));
      expect(outsideDots).toEqual([]);
    });

    it('rings every dot, fills the dots on #1 weeks and leaves the week in progress hollow', () => {
      const { container } = render(<PositionChart model={readyOf(EIGHT)} />);
      const all = dots(container);

      expect(all.map((dot) => dot.textContent)).toEqual(['1', '1', '2', '1', '1', '1', '1', '2']);
      expect(all.map((dot) => dot.dataset.filled)).toEqual(['true', 'true', 'false', 'true', 'true', 'true', 'true', 'false']);
      expect(all.map((dot) => dot.dataset.hollow)).toEqual(['false', 'false', 'false', 'false', 'false', 'false', 'false', 'true']);
      expect(all.every((dot) => dot.dataset.ring === 'true')).toBe(true);
    });

    it('the live week at #1 stays hollow, only finished #1 weeks are filled', () => {
      const { container } = render(<PositionChart model={readyOf([2, 2, 1])} />);
      const last = dots(container).at(-1)!;

      expect(last.textContent).toBe('1');
      expect(last.dataset.filled).toBe('false');
      expect(last.dataset.hollow).toBe('true');
    });

    it('says "this week so far" next to the legend for the hollow dot', () => {
      render(<PositionChart model={readyOf(EIGHT)} />);

      expect(screen.getByText('W34 · this week so far')).toBeVisible();
    });

    it('places every dot on the column and row the model gives, inside 0 to 1', () => {
      const model = readyOf([1, 3, 2, 4, 1]);
      const { container } = render(<PositionChart model={model} />);

      dots(container).forEach((dot, i) => {
        const { column, row } = model.dots[i];
        expect(Number(dot.style.getPropertyValue('--x'))).toBeCloseTo(column / (model.columns.length - 1), 5);
        expect(Number(dot.style.getPropertyValue('--y'))).toBeCloseTo(row / (model.axis.rows - 1), 5);
      });
    });

    it('draws the solid line through the finished weeks and a dashed leg to the week in progress, once', () => {
      const model = readyOf([null, null, 4, 3, 3, 2]);
      const { container } = render(<PositionChart model={model} />);

      const solid = container.querySelector('polyline');
      expect(solid?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(model.line.solid.length);
      expect(container.querySelectorAll('polyline')).toHaveLength(1);
      expect(container.querySelectorAll('line.rq-profile-position__dashed')).toHaveLength(1);
      // Raden börjar vid första veckan med placering: ingen dotta och ingen linje före.
      expect(dots(container)).toHaveLength(4);
    });

    it('draws a single finished week as a dot with a dashed leg and no solid line', () => {
      const { container } = render(<PositionChart model={readyOf([null, 3, 2])} />);

      expect(container.querySelectorAll('polyline')).toHaveLength(0);
      expect(container.querySelectorAll('line.rq-profile-position__dashed')).toHaveLength(1);
      expect(dots(container)).toHaveLength(2);
    });
  });

  describe('best, lowest and now', () => {
    it('reads "Best #1 · 6 of 7 weeks", "Lowest #2" and "Now #2" under a divider', () => {
      const { container } = render(<PositionChart model={readyOf(EIGHT)} />);
      const stats = container.querySelector('.rq-profile-position__stats') as HTMLElement;

      const parts = Array.from(stats.children).map((node) => node.textContent);
      expect(parts).toEqual(['Best #1 · 6 of 7 weeks', 'Lowest #2', 'Now #2']);
      expect(stats.querySelector('[data-tone="gold"]')).toHaveTextContent('Best #1 · 6 of 7 weeks');
    });

    it('shows the live placement and the period in the head', () => {
      const { container } = render(<PositionChart model={readyOf(EIGHT)} />);

      expect(container.querySelector('.rq-profile-position__now')).toHaveTextContent(/^#2$/);
      expect(screen.getByText('In the group · week 27–34')).toBeInTheDocument();
    });
  });

  describe('modes', () => {
    it('hidden draws nothing', () => {
      const { container } = render(<PositionChart model={{ mode: 'hidden' }} />);

      expect(container).toBeEmptyDOMElement();
    });

    it('a new runner gets the first-week text instead of a graph', () => {
      const model = modelOf([null, null, null, 2]);
      const { container } = render(<PositionChart model={model} />);

      expect(model.mode).toBe('new-runner');
      expect(screen.getByText('First week in the group. Position appears after your first week')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Show as table' })).not.toBeInTheDocument();
      expect(container.querySelector('svg')).toBeNull();
    });

    it('no finished week gets its own text instead of a graph', () => {
      const model = modelOf([2]);
      const { container } = render(<PositionChart model={model} />);

      expect(model.mode).toBe('no-finished-week');
      expect(screen.getByText('No finished week yet. Position shows where you stood at the end of each week.')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(container.querySelector('svg')).toBeNull();
    });

    it('a runner who joined in the middle of the period draws from the first placement and names the start in the sentence', () => {
      const model = readyOf([null, null, 3, 2, 1, 2]);
      const { container } = render(<PositionChart model={model} />);

      expect(screen.getByRole('img', { name: model.summary })).toBeInTheDocument();
      expect(model.summary).toContain(', from week 29:');
      expect(dots(container)).toHaveLength(4);
      // Veckoetiketterna finns för hela perioden, även före inträdet.
      expect(container.querySelectorAll('.rq-profile-position__week')).toHaveLength(6);
    });

    it('a period across the year boundary names week 53 and the years', () => {
      const model = readyOf([2, 1, 3, 2], 6, YEAR_END);
      const { container } = render(<PositionChart model={model} />);

      const labels = Array.from(container.querySelectorAll('.rq-profile-position__week')).map((node) => node.textContent);
      expect(labels).toEqual(['W51', 'W52', 'W53', 'W1']);
      expect(screen.getByRole('img', { name: /week 53, 2026/ })).toBeInTheDocument();
      expect(screen.getByText('In the group · week 51, 2026 – week 1, 2027')).toBeInTheDocument();
    });
  });

  describe('motion', () => {
    it('draws the line once and nothing moves: no animation elements, no animation in the stylesheet', () => {
      const { container } = render(<PositionChart model={readyOf(EIGHT)} />);

      expect(container.querySelectorAll('animate, animateTransform, animateMotion, set')).toHaveLength(0);
      expect(container.querySelector('[style*="animation"], [style*="transition"]')).toBeNull();

      const moving: string[] = [];
      const sheet = postcss.parse(cssOf);
      sheet.walkDecls((decl) => {
        if (/^(-webkit-)?(animation|transition)/.test(decl.prop)) moving.push(decl.prop);
      });
      sheet.walkAtRules('keyframes', (rule) => moving.push(`@keyframes ${rule.params}`));
      expect(sheet.nodes.length).toBeGreaterThan(10);
      expect(moving).toEqual([]);
    });
  });

  describe('lazy loading', () => {
    it('loads through a dynamic import, as the Position tab does', async () => {
      const LazyChart = lazy(() => import('./PositionChart').then((module) => ({ default: module.PositionChart })));
      const model = readyOf(EIGHT);
      render(
        <Suspense fallback={<p>Loading position</p>}>
          <LazyChart model={model} />
        </Suspense>,
      );

      expect(await screen.findByRole('img', { name: model.summary })).toBeInTheDocument();
    });
  });
});
