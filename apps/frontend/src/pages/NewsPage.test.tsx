import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { NewsItem } from '@runquest/shared';
import NewsPage from './NewsPage';
import { TOUR_NEWS_V1 } from '@/features/onboarding/featureTourSteps';
import { ADAM, DAN, ME, NICK, NOW_ISO, at, challengeWon, eventOpen, item, levelUp, newsServer, streakBroken, titleTaken } from '@/features/news/news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer; ankar-vakten nedan kollar DOM:en i stället.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({
  FeatureTour: ({ slug }: { slug: string }) => <div data-testid="feature-tour" data-slug={slug} />,
}));

const MOBILE = 390;
const DESKTOP = 1280;
// Felkortet kommer efter ett snabbt omförsök (~1 s).
const SLOW = { timeout: 4000 };

const location = () => screen.getByTestId('location').textContent;

// Torsdag 8 oktober 12:00 (Stockholm): idag, igår och "Earlier this week" (måndag) i samma flöde.
// Med vattenmärket på 12 är 20, 19, 18, 17, 16, 15 och 13 olästa; 14 är min egen handling och 12 är backfill.
const FEED = (): NewsItem[] => [
  titleTaken(20, { occurred_at: at(2) }),
  titleTaken(19, { occurred_at: at(5), actor: DAN, target: ADAM }, { title_name: 'The Consistent King', metric_key: 'longestStreak', value: 21 }),
  eventOpen(18, { occurred_at: at(9) }),
  challengeWon(17, { occurred_at: at(30) }),
  levelUp(16, 25, { occurred_at: at(31) }),
  streakBroken(15, { occurred_at: at(33) }),
  levelUp(14, 9, { occurred_at: at(24 * 3), actor: ME }),
  item('event_closed', 13, { event_id: 'e', event_type: 'participation', template_name: 'Morning Run', participants: 4, members: 6 }, { occurred_at: at(24 * 3 + 2) }),
  levelUp(12, 5, { occurred_at: at(24 * 20), is_backfill: true, actor: NICK }),
];

let news: ReturnType<typeof newsServer>;

function setup(feed: NewsItem[] = FEED(), lastSeen: number | null = 12) {
  news = newsServer(feed, lastSeen);
  handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
  handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
}

function renderNews(entry = '/news', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/news" element={<NewsPage />} />
    </Routes>,
    { entry, width },
  );
}

const rowTexts = () => [...document.querySelectorAll('.rq-news-row__text')].map((el) => el.textContent);
const filterButton = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
const manyOlder = (count: number) => Array.from({ length: count }, (_, index) => levelUp(100 + index, 1 + index, { occurred_at: at(24 * 30 + index), is_backfill: true }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
  setup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Pack News — flödet', () => {
  it('rubrik, dag-grupper och rader ur typ + payload, sedda från den som tittar', async () => {
    renderNews();
    expect(await screen.findByRole('heading', { name: 'Pack News', level: 1 })).toBeInTheDocument();
    await screen.findByText('Karl took The Longest Run from you — 32.8 km');

    expect([...document.querySelectorAll('.rq-news-day__label')].map((el) => el.textContent)).toEqual(['Today', 'Yesterday', 'Earlier this week', 'Fri 18 Sep']);
    expect(rowTexts()).toEqual([
      'Karl took The Longest Run from you — 32.8 km',
      'Daniel took The Consistent King from Adam — 21 days',
      '5K Friday is open until midnight · +25 XP',
      "Nicklas beat you in Most km · 7 days. Nicklas's boost is live",
      'Karl reached level 25',
      'Daniel lost a 27-day streak — multiplier back to 1.0×',
      'You reached level 9',
      'Morning Run closed — 4 of 6 finished it',
      'Nicklas reached level 5',
    ]);
  });

  it('typraden följer kategorin (ikon, färg, kant) och tiden är ett <time> med exakt klockslag', async () => {
    renderNews();
    await screen.findByText('Karl took The Longest Run from you — 32.8 km');
    const rows = [...document.querySelectorAll('.rq-news-row')];
    expect(rows.map((row) => row.getAttribute('data-category'))).toEqual(['title', 'title', 'event', 'challenge', 'level', 'streak', 'level', 'event', 'level']);
    expect(rows.map((row) => row.querySelector('.rq-news-row__kind')?.textContent?.replace(' (unread)', ''))).toEqual([
      'Title taken', 'Title taken', 'Event open', 'Challenge lost', 'Level up', 'Streak broken', 'Level up', 'Event closed', 'Level up',
    ]);
    const time = rows[0].querySelector('time') as HTMLTimeElement;
    expect(time).toHaveTextContent('2h');
    expect(time).toHaveAttribute('datetime', at(2));
    expect(time.title).toBe('Thu 8 Oct · 10:00');
    expect(rows[0].querySelector('svg')).not.toBeNull();
  });

  it('oläst: räknaren i rubriken, guldtint och skärmläsartext på olästa rader — inte på egna handlingar eller backfill', async () => {
    renderNews();
    await screen.findByText('7 unread');
    const unread = [...document.querySelectorAll('.rq-news-row[data-unread]')];
    expect(unread).toHaveLength(7);
    expect(unread.every((row) => within(row as HTMLElement).queryByText('(unread)') !== null)).toBe(true);
    const own = screen.getByText('You reached level 9').closest('li') as HTMLElement;
    const backfill = screen.getByText('Nicklas reached level 5').closest('li') as HTMLElement;
    expect(own).not.toHaveAttribute('data-unread');
    expect(backfill).not.toHaveAttribute('data-unread');
  });

  it('en backfill-rad markeras aldrig som oläst, även om servern skulle skicka is_unread', async () => {
    handlers.getNews = async () => ({
      success: true,
      data: { items: [{ ...levelUp(5, 3, { is_backfill: true, occurred_at: at(24 * 10) }), is_unread: true }] },
      meta: { unread_count: 0, last_seen_id: null, has_more: false, next_before: null },
    });
    renderNews();
    const row = (await screen.findByText('Karl reached level 3')).closest('li') as HTMLElement;
    expect(row).not.toHaveAttribute('data-unread');
  });

  it('inga guldknappar: Mark all read är en länkknapp och Show more en sekundärknapp', async () => {
    setup([...FEED(), ...manyOlder(40)]);
    renderNews();
    await screen.findByRole('button', { name: 'Show more' });
    expect(document.querySelectorAll('.rq-btn--primary')).toHaveLength(0);
  });

  it('dag-ordningen följer occurred_at, inte id: en backfillad rad med högt id hamnar på sin dag', async () => {
    setup([levelUp(50, 1, { occurred_at: at(24 * 20), is_backfill: true }), levelUp(49, 2, { occurred_at: at(1) }), levelUp(48, 3, { occurred_at: at(30) })]);
    renderNews();
    await screen.findByText('Karl reached level 2');
    expect(rowTexts()).toEqual(['Karl reached level 2', 'Karl reached level 3', 'Karl reached level 1']);
  });
});

describe('Pack News — Mark all read', () => {
  it('kvitterar högsta kända id, räknaren blir "All caught up", raderna är lästa och bekräftelsen står i en live-region med fokus', async () => {
    renderNews();
    await screen.findByText('7 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    await screen.findByText('All caught up');
    expect(news.server.seenCalls).toEqual([20]);
    expect(document.querySelectorAll('.rq-news-row[data-unread]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('marked as read')) as HTMLElement;
    expect(status).toHaveTextContent('7 marked as read');
    await waitFor(() => expect(status).toHaveFocus());
    // Invalideringen hämtar bara det nya (catch-up), inte hela flödet om.
    await waitFor(() => expect(news.server.calls.at(-1)).toEqual({ after: 20, limit: 100, type: undefined }));
  });

  it('kvitterar med flödet för alla typer även när ett filter visas', async () => {
    renderNews('/news?type=levels');
    await screen.findByText('Karl reached level 25');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await screen.findByText('All caught up');
    expect(news.server.seenCalls).toEqual([20]);
  });

  it('fokus går till statusregionen direkt vid klicket (inte först vid svaret), och tillbaka till knappen om kvitteringen misslyckas', async () => {
    renderNews();
    await screen.findByText('7 unread');
    let fail: (value: unknown) => void = () => {};
    handlers.markNewsSeen = () => new Promise((resolve) => { fail = resolve; });
    const button = screen.getByRole('button', { name: 'Mark all read' });
    button.focus();
    fireEvent.click(button);

    const status = screen.getAllByRole('status').find((el) => el.tabIndex === -1) as HTMLElement;
    expect(status).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull());
    expect(status).toHaveFocus();

    fail({ success: false, error: 'Failed to update news state' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveFocus());
  });

  it('knappen finns inte när inget är oläst', async () => {
    setup(FEED(), 20);
    renderNews();
    await screen.findByText('All caught up');
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('serverfel: räknaren och olästa rader återställs och felet står i en alert-region', async () => {
    renderNews();
    await screen.findByText('7 unread');
    news.server.failNext = 'Failed to update news state';
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => el.textContent?.includes("Couldn't mark the news as read — Failed to update news state"))).toBe(true));
    await screen.findByText('7 unread');
    expect(document.querySelectorAll('.rq-news-row[data-unread]')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeEnabled();
  });
});

describe('Pack News — filter (?type=)', () => {
  it('ett chip filtrerar via type= i klienten→servern, adressen följer och valt = aria-pressed', async () => {
    renderNews();
    await screen.findByText('7 unread');
    expect(filterButton('Titles')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(filterButton('Titles'));
    await waitFor(() => expect(location()).toBe('/news?type=titles'));
    await screen.findByRole('heading', { name: 'Today' });
    await waitFor(() => expect(rowTexts()).toEqual(['Karl took The Longest Run from you — 32.8 km', 'Daniel took The Consistent King from Adam — 21 days']));
    expect(news.server.calls.some((call) => call.type === 'title_unlocked,title_taken,title_revoked')).toBe(true);
    expect(filterButton('Titles')).toHaveAttribute('aria-pressed', 'true');
  });

  it('flera chips samtidigt; Levels = level_up + run_milestone; att avmarkera tar bort parametern', async () => {
    renderNews();
    await screen.findByText('7 unread');
    fireEvent.click(filterButton('Levels'));
    fireEvent.click(filterButton('Streaks'));
    await waitFor(() => expect(location()).toBe('/news?type=levels%2Cstreaks'));
    await waitFor(() => expect(news.server.calls.some((call) => call.type === 'level_up,run_milestone,streak_broken')).toBe(true));
    await waitFor(() => expect(rowTexts()).toEqual(['Karl reached level 25', 'Daniel lost a 27-day streak — multiplier back to 1.0×', 'You reached level 9', 'Nicklas reached level 5']));

    fireEvent.click(filterButton('Levels'));
    fireEvent.click(filterButton('Streaks'));
    await waitFor(() => expect(location()).toBe('/news'));
  });

  it('adressen styr filtret vid direktladdning; okända nycklar ignoreras', async () => {
    renderNews('/news?type=events,nonsense');
    await waitFor(() => expect(filterButton('Events')).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(rowTexts()).toEqual(['5K Friday is open until midnight · +25 XP', 'Morning Run closed — 4 of 6 finished it']));
  });

  it('chip-räknarna är antal per kategori i det laddade (ofiltrerade) fönstret — och står kvar när ett filter visas', async () => {
    renderNews('/news?type=streaks');
    await waitFor(() => expect(rowTexts()).toEqual(['Daniel lost a 27-day streak — multiplier back to 1.0×']));
    const counts = Object.fromEntries(['Titles', 'Challenges', 'Events', 'Levels', 'Streaks'].map((label) => [label, filterButton(label).querySelector('.rq-news-filter__count')?.firstChild?.textContent]));
    expect(counts).toEqual({ Titles: '2', Challenges: '1', Events: '2', Levels: '3', Streaks: '1' });
    // Räknarens förklaring för den som hovrar: antal av det laddade fönstret.
    expect(filterButton('Titles')).toHaveAttribute('title', '2 in the latest 9');
    expect(filterButton('Levels')).toHaveAttribute('title', '3 in the latest 9');
  });

  it('inget träffar: tomt läge med en knapp som visar allt', async () => {
    setup(FEED().filter((row) => row.type !== 'challenge_won'));
    renderNews('/news?type=challenges');
    await screen.findByRole('heading', { name: 'Nothing here' });
    fireEvent.click(screen.getByRole('button', { name: 'Show all news' }));
    await waitFor(() => expect(location()).toBe('/news'));
    await screen.findByText('Karl reached level 25');
  });

  it('desktop: samma knappar (filterkortet) — en DOM, ingen dubblering', async () => {
    renderNews('/news', DESKTOP);
    await screen.findByText('7 unread');
    expect(screen.getAllByRole('button', { name: /^Titles/ })).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
  });
});

describe('Pack News — Show more', () => {
  it('hämtar nästa sida från next_before, lägger raderna efter, och knappen försvinner på sista sidan', async () => {
    setup([...FEED(), ...manyOlder(40)]);
    renderNews();
    await screen.findByRole('button', { name: 'Show more' });
    expect(document.querySelectorAll('.rq-news-row')).toHaveLength(30);

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(document.querySelectorAll('.rq-news-row')).toHaveLength(49));
    expect(news.server.calls.at(-1)).toMatchObject({ before: 110, limit: 30 });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull());
  });

  it('ett fel vid Show more står kvar i en alert-region och flödet är orört', async () => {
    setup([...FEED(), ...manyOlder(40)]);
    renderNews();
    await screen.findByRole('button', { name: 'Show more' });
    news.server.failNext = 'The pack is out of range';
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((el) => el.textContent?.includes("Couldn't load older news — "))).toBe(true));
    expect(document.querySelectorAll('.rq-news-row')).toHaveLength(30);
  });
});

describe('Pack News — laddning, tomt och fel', () => {
  it('skelett medan första sidan hämtas', async () => {
    handlers.getNews = () => new Promise(() => {});
    renderNews();
    expect(await screen.findByText('Loading Pack News')).toBeInTheDocument();
  });

  it('tomt: ett streckat läge med en sekundärknapp till Log a run', async () => {
    setup([]);
    renderNews();
    expect(await screen.findByRole('heading', { name: 'No news yet — go make some' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Log a run' }));
    await waitFor(() => expect(location()).toBe('/log'));
  });

  it('fel: felkort med Retry — Retry hämtar om', async () => {
    news = newsServer(FEED(), 12);
    handlers.getNews = async () => ({ success: false, error: 'down' });
    renderNews();
    expect(await screen.findByText("Couldn't load Pack News", {}, SLOW)).toBeInTheDocument();
    handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Karl took The Longest Run from you — 32.8 km')).toBeInTheDocument();
  });
});

describe('Pack News — tour', () => {
  it('turen är tour_news_v1 och ankarna finns i sidan (mobil och desktop)', async () => {
    for (const width of [MOBILE, DESKTOP]) {
      const view = renderNews('/news', width);
      await screen.findByText('7 unread');
      expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_news_v1');
      const anchors = TOUR_NEWS_V1.flatMap((step) => (step.element ? [step.element] : []));
      expect(anchors.length).toBe(3);
      for (const selector of anchors) expect(document.querySelector(selector), selector).not.toBeNull();
      view.unmount();
    }
  });
});
