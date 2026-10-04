import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { LocationProbe } from '@/test/LocationProbe';
import { useViewParam } from './useViewParam';

// ADR 006 beslut 12(c): default, okänt värde, replace.
const VIEWS = ['season', 'week', 'streaks'] as const;

function Harness() {
  const [view, setView] = useViewParam(VIEWS, 'season');
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="view">{view}</span>
      <button onClick={() => setView('week')}>to-week</button>
      <button onClick={() => setView('streaks')}>to-streaks</button>
      <button onClick={() => navigate(-1)}>back</button>
    </div>
  );
}

const renderAt = (entries: string[], index?: number) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Harness />
      <LocationProbe />
    </MemoryRouter>,
  );

const view = () => screen.getByTestId('view').textContent;
const location = () => screen.getByTestId('location').textContent;

describe('useViewParam', () => {
  it('saknad parameter → default', () => {
    renderAt(['/board']);
    expect(view()).toBe('season');
  });

  it('känt värde läses ur ?view=', () => {
    renderAt(['/board?view=streaks']);
    expect(view()).toBe('streaks');
  });

  it('okänt värde faller tillbaka på default (adressen lämnas orörd)', () => {
    renderAt(['/board?view=hopp']);
    expect(view()).toBe('season');
    expect(location()).toBe('/board?view=hopp');
  });

  it('är skiftlägeskänslig: ?view=WEEK är okänt', () => {
    renderAt(['/board?view=WEEK']);
    expect(view()).toBe('season');
  });

  it('byte skriver ?view= och lämnar övriga parametrar orörda', () => {
    renderAt(['/board?x=1']);
    fireEvent.click(screen.getByText('to-week'));
    expect(view()).toBe('week');
    expect(location()).toBe('/board?x=1&view=week');
  });

  it('byte använder replace: back lämnar sidan i stället för att gå tillbaka en flik', () => {
    renderAt(['/start', '/board'], 1);

    fireEvent.click(screen.getByText('to-week'));
    fireEvent.click(screen.getByText('to-streaks'));
    expect(location()).toBe('/board?view=streaks');

    fireEvent.click(screen.getByText('back'));
    expect(location()).toBe('/start');
  });

  it('router-state följer med vid byte (Runner cards background får inte tappas när statfliken växlar)', () => {
    const StateProbe = () => <span data-testid="state">{JSON.stringify(useLocation().state)}</span>;
    render(
      <MemoryRouter initialEntries={[{ pathname: '/runner/u1', state: { background: { pathname: '/board' } } }]}>
        <Harness />
        <StateProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('to-week'));
    expect(screen.getByTestId('state').textContent).toBe('{"background":{"pathname":"/board"}}');
  });

  it('annat parameternamn: ?filter= läses och skrivs, ?view= lämnas orörd', () => {
    const FILTERS = ['all', 'mine', 'unclaimed'] as const;
    function FilterHarness() {
      const [filter, setFilter] = useViewParam(FILTERS, 'all', 'filter');
      return (
        <div>
          <span data-testid="filter">{filter}</span>
          <button onClick={() => setFilter('mine')}>to-mine</button>
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={['/titles?view=x&filter=unclaimed']}>
        <FilterHarness />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('filter').textContent).toBe('unclaimed');
    fireEvent.click(screen.getByText('to-mine'));
    expect(screen.getByTestId('filter').textContent).toBe('mine');
    expect(location()).toBe('/titles?view=x&filter=mine');
  });
});
