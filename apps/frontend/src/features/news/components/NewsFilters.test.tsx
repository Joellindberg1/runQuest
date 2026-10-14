import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NEWS_FILTERS, countByFilter } from '../newsModel';
import { NOW_ISO, at, challengeAccepted, levelUp, newsServer, rankPassed } from '../news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import '@/test/pointerEvent';
import { NewsFilters } from './NewsFilters';
import { NewsScreen } from './NewsScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer och hör inte till det som provas här.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Chip-raden (sju chips sedan Ranks, frame N3). Räknarna är modellens `countByFilter`; här provas att raden ritar dem, hur ett val når adressen och
// hämtningen, och att det sista chipet går att nå och scrollas i bild med tangentbordet. Det sidledes scrollet (position: relative) vaktas i guards.test.ts.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

const FEED = () => [
  rankPassed(5, { occurred_at: at(1) }),
  rankPassed(4, { occurred_at: at(2) }),
  challengeAccepted(3, { occurred_at: at(3) }),
  levelUp(2, 25, { occurred_at: at(4) }),
  levelUp(1, 20, { occurred_at: at(5) }),
];

function renderFilters(counts = countByFilter(FEED())) {
  return render(
    <NewsFilters selected={[]} counts={counts} loaded={FEED().length} onToggle={() => {}} involves={false} involvesCount={0} onToggleInvolves={() => {}} />,
  );
}

const chipRow = () => screen.getByRole('group', { name: 'Filter' });

describe('NewsFilters — Ranks', () => {
  it('renderar sju chips med Ranks efter Events och räknare per chip', () => {
    // Ordningen är modellens (NEWS_FILTERS): Ranks ligger efter Challenges och före Events, som frame N3 ritar den. Ingen egen lista i komponenten.
    renderFilters();
    const chips = within(chipRow()).getAllByRole('button');
    expect(chips).toHaveLength(7);
    expect(chips.map((chip) => chip.querySelector('.rq-news-filter__name')?.textContent)).toEqual(NEWS_FILTERS.map((filter) => filter.label));
    expect(NEWS_FILTERS.map((filter) => filter.label)).toEqual(['Titles', 'Challenges', 'Ranks', 'Events', 'Levels', 'Badges', 'Streaks']);

    // Räknarna är raderna i det laddade fönstret: en passering är en Ranks-rad, en accepterad utmaning en Challenges-rad.
    expect(within(chipRow()).getByRole('button', { name: 'Ranks 2 loaded' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(chipRow()).getByRole('button', { name: 'Challenges 1 loaded' })).toBeInTheDocument();
    expect(within(chipRow()).getByRole('button', { name: 'Levels 2 loaded' })).toBeInTheDocument();
    expect(within(chipRow()).getByRole('button', { name: 'Titles 0 loaded' })).toBeInTheDocument();
    // "Involves me" är en egen knapp utanför chip-raden, inte ett åttonde chip.
    expect(screen.getByRole('button', { name: /^Involves me/ })).toBeInTheDocument();
    expect(within(chipRow()).queryByRole('button', { name: /^Involves me/ })).toBeNull();
    // Ikonen är dekoration: chipets namn är bara texten och siffran.
    expect(chipRow().querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });

  it('att välja Ranks sätter ?type=ranks och hämtar bara rank_passed', async () => {
    const user = userEvent.setup();
    const news = newsServer(FEED(), 0);
    handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
    handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
    handlers.markNewsRead = (...args: unknown[]) => news.markNewsRead(...(args as [never]));
    handlers.getSettings = () => news.getSettings();
    renderWithApp(<NewsScreen />, { entry: '/news', width: 390 });
    const rows = () => document.querySelectorAll('.rq-news-row');
    await waitFor(() => expect(rows()).toHaveLength(5));

    await user.click(await screen.findByRole('button', { name: /^Ranks/ }));

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByTestId('location').textContent).toBe('/news?type=ranks');
    expect(screen.getByRole('button', { name: /^Ranks/ })).toHaveAttribute('aria-pressed', 'true');
    expect(news.server.calls[news.server.calls.length - 1]).toMatchObject({ type: 'rank_passed' });
    for (const row of rows()) expect(row).toHaveAttribute('data-category', 'rank');
    // Chip-räknarna läser det ofiltrerade fönstret och ändras inte av valet.
    expect(screen.getByRole('button', { name: 'Challenges 1 loaded' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Levels 2 loaded' })).toBeInTheDocument();
  });

  it('det sjunde chipet nås med tangentbordet och scrollas i bild vid fokus', async () => {
    // jsdom saknar scrollIntoView; mocken visar vilket element som fick anropet och med vilka argument.
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView });
    const user = userEvent.setup();
    renderFilters();
    const chips = within(chipRow()).getAllByRole('button');
    const last = chips[chips.length - 1];
    expect(last).toHaveTextContent('Streaks');

    // Fokus går in i raden via tab; ingen chip hoppas över, och det sista är nåbart utan mus.
    const focused: Element[] = [];
    for (let step = 0; step < chips.length + 1 && !focused.includes(last); step += 1) {
      await user.tab();
      if (document.activeElement && chips.includes(document.activeElement as HTMLElement)) focused.push(document.activeElement);
    }
    expect(focused).toEqual(chips);
    expect(last).toHaveFocus();

    // Det fokuserade chipet scrollas i bild: närmaste position, och inget smooth-beteende som reducerad rörelse inte kunde stänga av.
    const call = scrollIntoView.mock.calls.length - 1;
    expect(scrollIntoView.mock.contexts[call]).toBe(last);
    expect(scrollIntoView.mock.calls[call][0]).toEqual({ block: 'nearest', inline: 'nearest' });
  });
});
