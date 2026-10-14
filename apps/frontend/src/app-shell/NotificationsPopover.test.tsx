import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { NewsItem } from '@runquest/shared';
import { AppShell } from './AppShell';
import { NotificationsPopover } from './NotificationsPopover';
import { useUserSettings } from '@/features/settings/hooks/useUserSettings';
import { ADAM, DAN, NOW_ISO, at, challengeWon, eventOpen, levelUp, newsServer, streakBroken, titleTaken } from '@/features/news/news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const MOBILE = 390;
const DESKTOP = 1280;

const Tree: React.FC = () => (
  <Routes>
    <Route element={<AppShell />}>
      {['/board', '/news'].map((path) => <Route key={path} path={path} element={<div>page {path}</div>} />)}
      <Route path="*" element={<div>not found page</div>} />
    </Route>
  </Routes>
);

const location = () => screen.getByTestId('location').textContent;

// Fyra olästa (20, 19, 18, 17), tre lästa; sju rader totalt — popovern visar de fem senaste.
const FEED = (): NewsItem[] => [
  titleTaken(20, { occurred_at: at(2) }),
  titleTaken(19, { occurred_at: at(5), actor: DAN, target: ADAM }, { title_name: 'The Consistent King', metric_key: 'longestStreak', value: 21 }),
  eventOpen(18, { occurred_at: at(9) }),
  challengeWon(17, { occurred_at: at(30) }),
  levelUp(16, 25, { occurred_at: at(31) }),
  streakBroken(15, { occurred_at: at(33) }),
  levelUp(14, 9, { occurred_at: at(24 * 3) }),
];

let news: ReturnType<typeof newsServer>;
function setup(feed: NewsItem[] = FEED(), lastSeen: number | null = 16) {
  news = newsServer(feed, lastSeen);
  handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
  handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
}

const bell = () => screen.findByRole('button', { name: /^Pack news/ });
const openPopover = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /^Pack news, \d+ unread$/ }));
  return screen.findByRole('dialog', { name: 'Pack news' });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
  setup();
});
afterEach(() => vi.useRealTimers());

describe('klockan i headern', () => {
  it.each([MOBILE, DESKTOP])('oläst-räknaren ur meta.unread_count (egna handlingar räknas inte av backend), vid %d px', async (width) => {
    renderWithApp(<Tree />, { entry: '/board', width });
    const button = await screen.findByRole('button', { name: 'Pack news, 4 unread' });
    // Siffran är aria-hidden (namnet bär räknaren för hjälpmedel), så den hittas på text, inte på roll.
    expect(within(button).getByText('4')).toBeInTheDocument();
    expect(button).toHaveAttribute('data-tour', 'header-news');
  });

  it('badgen följer meta.unread_count (dold vid 0, 99+ över 99)', async () => {
    setup(FEED(), 20);
    const none = renderWithApp(<Tree />, { entry: '/board', width: MOBILE });
    const button = await bell();
    await waitFor(() => expect(news.server.calls).toHaveLength(1));
    expect(button).toHaveAccessibleName('Pack news');
    expect(button.querySelector('.rq-news-badge')).toBeNull();
    none.unmount();

    setup(Array.from({ length: 120 }, (_, index) => levelUp(index + 1, index + 1, { occurred_at: at(1) })), 0);
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE });
    await screen.findByRole('button', { name: 'Pack news, 120 unread' });
    expect(document.querySelector('.rq-news-badge')).toHaveTextContent('99+');
  });

  it('en hämtning för skalet — popovern öppnas ur samma cache utan ny hämtning', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE });
    await openPopover();
    expect(news.server.calls).toEqual([{ limit: 30, type: undefined }]);
  });
});

describe('popovern', () => {
  it('"The Pack News" med de fem senaste raderna (nyast först), olästa markerade, tid i popoverns form', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP });
    const popover = await openPopover();

    expect(within(popover).getByRole('heading', { name: 'The Pack News' })).toBeInTheDocument();
    const rows = within(popover).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.rq-news-pop__text')?.textContent)).toEqual([
      'Karl took The Longest Run from you — 32.8 km',
      'Daniel took The Consistent King from Adam — 21 days',
      '5K Friday is open until midnight · +25 XP',
      "Nicklas beat you in Most km · 7 days. Nicklas's boost is live",
      'Karl reached level 25',
    ]);
    expect(rows.map((row) => row.querySelector('time')?.textContent)).toEqual(['2h ago', '5h ago', '9h ago', 'Yesterday', 'Yesterday']);
    expect(rows.map((row) => row.hasAttribute('data-unread'))).toEqual([true, true, true, true, false]);
    expect(rows.map((row) => row.querySelector('time .rq-news-unread') !== null)).toEqual([true, true, true, true, false]);
    // En förlorad utmaning är röd i popovern (som Web Prototypen).
    expect(rows[3]).toHaveAttribute('data-tone', 'loss');
  });

  it('"See all pack news" går till /news och stänger popovern', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE });
    const popover = await openPopover();
    fireEvent.click(within(popover).getByRole('link', { name: 'See all pack news' }));
    await waitFor(() => expect(location()).toBe('/news'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('✕ finns på mobil (App Prototype) men inte på desktop; Esc stänger', async () => {
    const mobile = renderWithApp(<Tree />, { entry: '/board', width: MOBILE });
    const popover = await openPopover();
    fireEvent.click(within(popover).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    mobile.unmount();

    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP });
    const desktop = await openPopover();
    expect(within(desktop).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(desktop, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Mark all read: räknaren nollas direkt, POST med högsta id, bekräftelse i live-region med fokus', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP });
    const popover = await openPopover();
    fireEvent.click(within(popover).getByRole('button', { name: 'Mark all read' }));

    await screen.findByRole('button', { name: 'Pack news' });
    expect(news.server.seenCalls).toEqual([20]);
    const status = within(popover).getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('4 marked as read'));
    await waitFor(() => expect(status).toHaveFocus());
    expect(within(popover).queryByRole('button', { name: 'Mark all read' })).toBeNull();
    expect(within(popover).getAllByRole('listitem').some((row) => row.hasAttribute('data-unread'))).toBe(false);
    expect(popover.querySelectorAll('.rq-news-unread')).toHaveLength(0);
  });

  it('Mark all read som misslyckas: räknaren är kvar och felet står i en alert-region', async () => {
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP });
    const popover = await openPopover();
    news.server.failNext = 'Failed to update news state';
    fireEvent.click(within(popover).getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(within(popover).getByRole('alert')).toHaveTextContent("Couldn't mark the news as read — Failed to update news state"));
    expect(await screen.findByRole('button', { name: 'Pack news, 4 unread' })).toBeInTheDocument();
  });

  it('ett laddningsfel i inställningarna använder defaults och popovern öppnas ändå', async () => {
    // Servern har titelbyten avstängda, men inställningarna går inte att läsa: då gäller defaults (allt påslaget) och raden syns.
    news.server.settings = { 'notify.title_others': false };
    const getSettings = vi.fn(async () => ({ success: false, error: 'down' }));
    handlers.getSettings = getSettings;
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP });
    const popover = await openPopover();

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() => expect(within(popover).getAllByRole('listitem')).toHaveLength(5));
    expect(within(popover).getByText('Daniel took The Consistent King from Adam — 21 days')).toBeInTheDocument();
    expect(within(popover).queryByText('Nothing new for you')).toBeNull();
    expect(within(popover).getByRole('link', { name: 'See all pack news' })).toBeInTheDocument();
  });

  it('en rad av ett avstängt slag renderas aldrig vid första öppningen när inställningarna svarat före', async () => {
    news.server.settings = { 'notify.title_others': false };
    let settled = false;
    handlers.getSettings = async () => {
      const response = await news.getSettings();
      settled = true;
      return response;
    };
    renderWithApp(<Tree />, { entry: '/board', width: DESKTOP });
    // Klockan har värmt inställningarna redan när den monteras, innan någon öppnat popovern.
    await waitFor(() => expect(settled).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const popover = await openPopover();
    expect(within(popover).queryByText('Daniel took The Consistent King from Adam — 21 days')).toBeNull();
    expect(within(popover).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('en avstängd kategori tas bort ur popovern och räknaren sjunker utan omladdning', async () => {
    // Fyra olästa: Karl-titeln (title_taken_from_me), Daniels titelbyte (title_others), eventet och förlorade utmaningen.
    setup(FEED(), 16);
    handlers.getSettings = () => news.getSettings();
    handlers.putSettings = (...args: unknown[]) => news.putSettings(...(args as [never]));
    const Switch = () => {
      const settings = useUserSettings();
      return <button type="button" onClick={() => settings.toggle('notify.title_others')}>Title changes off</button>;
    };
    renderWithApp(<><Switch /><NotificationsPopover variant="desktop" /></>, { entry: '/board', width: DESKTOP });
    const popover = await openPopover();
    expect(within(popover).getByText('Daniel took The Consistent King from Adam — 21 days')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Title changes off' }));

    await waitFor(() => expect(within(popover).queryByText('Daniel took The Consistent King from Adam — 21 days')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Pack news, 3 unread' })).toBeInTheDocument();
    expect(within(popover).getByText('Karl took The Longest Run from you — 32.8 km')).toBeInTheDocument();
  });

  it('fel: felkort med Retry i popovern', async () => {
    handlers.getNews = async () => ({ success: false, error: 'down' });
    renderWithApp(<Tree />, { entry: '/board', width: MOBILE });
    fireEvent.click(await bell());
    const popover = await screen.findByRole('dialog', { name: 'Pack news' });
    expect(await within(popover).findByText("Couldn't load Pack News", {}, { timeout: 4000 })).toBeInTheDocument();
    setup();
    fireEvent.click(within(popover).getByRole('button', { name: 'Retry' }));
    expect(await within(popover).findByText('Karl reached level 25')).toBeInTheDocument();
  });
});
