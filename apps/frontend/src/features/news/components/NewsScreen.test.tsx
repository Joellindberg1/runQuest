import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTIFICATION_KINDS } from '@runquest/shared';
import { NotificationsPopover } from '@/app-shell/NotificationsPopover';
import { POINTER_SETTLE_MS } from '../newsModel';
import { ADAM, DAN, NOW_ISO, at, challengeWon, eventOpen, levelUp, newsServer, titleTaken } from '../news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import '@/test/pointerEvent';
import { NewsScreen } from './NewsScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer och hör inte till det som provas här.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Skärmens egen datakoppling för kvittering. Radernas gester provas i NewsRow.test.tsx, och sidans övriga beteende i pages/NewsPage.test.tsx.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => vi.useRealTimers());

describe('NewsScreen — Mark all read', () => {
  it('Mark all read fungerar fortfarande och nollar räknaren', async () => {
    const news = newsServer([levelUp(3, 15, { occurred_at: at(1) }), levelUp(2, 20, { occurred_at: at(2) }), levelUp(1, 25, { occurred_at: at(3) })], 0);
    handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
    handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
    handlers.markNewsRead = (...args: unknown[]) => news.markNewsRead(...(args as [never]));
    renderWithApp(<NewsScreen />, { entry: '/news' });
    await screen.findByText('3 unread');

    // En rad läst per gest först, sedan resten med knappen.
    act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS); });
    fireEvent.pointerEnter(screen.getByRole('button', { name: /Karl reached level 15$/ }), { pointerType: 'mouse' });
    await screen.findByText('2 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(await screen.findByText('All caught up')).toBeInTheDocument();
    await waitFor(() => expect(news.server.seenCalls).toEqual([3]));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 marked as read'));
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    for (const button of screen.getAllByRole('button', { name: /Karl reached level/ })) expect(button).not.toHaveAccessibleName(/unread/);
  });
});

const MOBILE = 390;
const DESKTOP = 1280;
const TITLES_OTHERS_ROW = 'Daniel took The Consistent King from Adam — 21 days';

// Fyra olästa (20, 19, 18, 17) och tre lästa; Daniels titelbyte (19) är ett "andras titelbyte" som går att stänga av.
const FEED = () => [
  titleTaken(20, { occurred_at: at(2) }),
  titleTaken(19, { occurred_at: at(5), actor: DAN, target: ADAM }, { title_name: 'The Consistent King', metric_key: 'longestStreak', value: 21 }),
  eventOpen(18, { occurred_at: at(9) }),
  challengeWon(17, { occurred_at: at(30) }),
  levelUp(16, 25, { occurred_at: at(31) }),
  levelUp(15, 24, { occurred_at: at(32) }),
  levelUp(14, 9, { occurred_at: at(24 * 3) }),
];

let panelNews: ReturnType<typeof newsServer>;
function serve(feed = FEED(), lastSeen: number | null = 16) {
  panelNews = newsServer(feed, lastSeen);
  handlers.getNews = (...args: unknown[]) => panelNews.getNews(...(args as [never]));
  handlers.markNewsSeen = (...args: unknown[]) => panelNews.markNewsSeen(...(args as [never]));
  handlers.markNewsRead = (...args: unknown[]) => panelNews.markNewsRead(...(args as [never]));
  handlers.getSettings = () => panelNews.getSettings();
  handlers.putSettings = (...args: unknown[]) => panelNews.putSettings(...(args as [never]));
}

const gear = () => screen.findByRole('button', { name: 'Notification settings' });
const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await gear());
  return screen.findByRole('dialog', { name: 'Notifications' });
};
const panels = () => screen.queryAllByRole('region', { name: 'Notifications' });
const total = new RegExp(`of ${NOTIFICATION_KINDS.length} on`);

describe('NewsScreen — inställningspanelen', () => {
  beforeEach(() => serve());

  it('desktop: panelen ligger i sidokolumnen under filtret', async () => {
    renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    await screen.findByText('4 unread');

    const column = screen.getByRole('complementary');
    const filter = within(column).getByRole('group', { name: 'Filter' });
    const panel = await within(column).findByRole('region', { name: 'Notifications' });
    expect(filter.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Notifications' })).toBeInTheDocument();
    expect(within(column).getByText('This page always shows everything')).toBeInTheDocument();
    // Sektionerna börjar hopfällda i kolumnen, och bladets knapp finns inte på desktop.
    expect(await within(panel).findByRole('button', { name: /^Titles/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Notification settings' })).toBeNull();
  });

  it('mobil: knappen öppnar ett blad med panelen och Esc stänger det', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    expect(screen.queryByRole('dialog')).toBeNull();

    const sheet = await openSheet(user);
    expect(await within(sheet).findByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    expect(await within(sheet).findByRole('group', { name: 'Titles' })).toBeInTheDocument();
    expect(within(sheet).getByText('This page always shows everything')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(panels()).toHaveLength(0);
  });

  it('bladet fångar fokus och återför det till knappen vid stängning', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    const trigger = await gear();
    const sheet = await openSheet(user);
    await within(sheet).findByRole('group', { name: 'Titles' });

    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    for (let step = 0; step < 30; step += 1) {
      await user.tab();
      expect(sheet).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);

    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();

    // Esc och ett klick utanför återför fokus på samma sätt.
    await openSheet(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();

    await openSheet(user);
    await user.click(document.querySelector('.rq-scrim') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('en växling på /news skriver PUT och räknaren på klockan uppdateras', async () => {
    const user = userEvent.setup();
    renderWithApp(<><NotificationsPopover variant="desktop" /><NewsScreen /></>, { entry: '/news', width: DESKTOP });
    expect(await screen.findByRole('button', { name: 'Pack news, 4 unread' })).toBeInTheDocument();

    const panel = await screen.findByRole('region', { name: 'Notifications' });
    await user.click(await within(panel).findByRole('button', { name: /^Titles/ }));
    await user.click(within(panel).getByRole('switch', { name: 'Other title changes in the pack' }));

    await waitFor(() => expect(panelNews.server.settingsCalls).toEqual([{ 'notify.title_others': false }]));
    expect(await screen.findByRole('button', { name: 'Pack news, 3 unread' })).toBeInTheDocument();
  });

  it('avstängda slag döljer aldrig rader i flödet', async () => {
    const user = userEvent.setup();
    renderWithApp(<><NotificationsPopover variant="desktop" /><NewsScreen /></>, { entry: '/news', width: DESKTOP });
    expect(await screen.findByText(TITLES_OTHERS_ROW)).toBeInTheDocument();

    const panel = await screen.findByRole('region', { name: 'Notifications' });
    await user.click(await within(panel).findByRole('button', { name: /^Titles/ }));
    await user.click(within(panel).getByRole('switch', { name: 'Other title changes in the pack' }));
    // Klockan har följt inställningen, men flödet visar fortfarande allt (ADR 011 beslut 2, B2).
    expect(await screen.findByRole('button', { name: 'Pack news, 3 unread' })).toBeInTheDocument();
    expect(screen.getByText(TITLES_OTHERS_ROW)).toBeInTheDocument();
    expect(document.querySelectorAll('.rq-news-row')).toHaveLength(FEED().length);
  });

  it('ankaret news-settings finns i både desktop och mobil', async () => {
    const desktop = renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    await screen.findByText('4 unread');
    const column = await screen.findByRole('region', { name: 'Notifications' });
    const anchors = document.querySelectorAll('[data-tour="news-settings"]');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toContainElement(column);
    desktop.unmount();

    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    const button = await gear();
    expect(document.querySelectorAll('[data-tour="news-settings"]')).toHaveLength(1);
    expect(button).toHaveAttribute('data-tour', 'news-settings');
  });

  it('mobilbladet visar ingen totalsumma', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    const sheet = await openSheet(user);
    await within(sheet).findByRole('group', { name: 'Titles' });

    expect(within(sheet).queryByText(total)).toBeNull();
    // Sektionernas egna räknare finns kvar.
    expect(within(within(sheet).getByRole('group', { name: 'Titles' })).getByRole('button', { name: /^Titles/ })).toHaveTextContent(/\d+ of \d+ on/);
  });

  it('sidokolumnen visar ingen totalsumma heller', async () => {
    renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    const panel = await screen.findByRole('region', { name: 'Notifications' });
    await within(panel).findByRole('group', { name: 'Titles' });
    expect(within(panel).queryByText(total)).toBeNull();
  });

  it('det finns aldrig mer än en panelinstans: en live-region av varje slag, i kolumnen eller i bladet', async () => {
    const user = userEvent.setup();
    const statusName = 'Notification settings status';

    const desktop = renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    await screen.findByText('4 unread');
    await screen.findByRole('region', { name: 'Notifications' });
    expect(panels()).toHaveLength(1);
    expect(screen.getAllByRole('status', { name: statusName })).toHaveLength(1);
    expect(screen.getAllByRole('alert', { name: 'Notification settings error' })).toHaveLength(1);
    desktop.unmount();

    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    await gear();
    expect(panels()).toHaveLength(0);
    expect(screen.queryAllByRole('status', { name: statusName })).toHaveLength(0);

    const sheet = await openSheet(user);
    await within(sheet).findByRole('region', { name: 'Notifications' });
    expect(panels()).toHaveLength(1);
    expect(screen.getAllByRole('status', { name: statusName })).toHaveLength(1);
    expect(screen.getAllByRole('alert', { name: 'Notification settings error' })).toHaveLength(1);
  });
});
