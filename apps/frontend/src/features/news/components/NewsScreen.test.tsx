import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTIFICATION_KINDS } from '@runquest/shared';
import { NotificationsPopover } from '@/app-shell/NotificationsPopover';
import { POINTER_SETTLE_MS } from '../newsModel';
import { ADAM, DAN, ME, NOW_ISO, at, challengeWon, eventOpen, levelUp, newsServer, titleTaken } from '../news.fixture';
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
    // Bekräftelsen står i en status-region (skärmen har även en egen region för filterväxlingen, så rollen ensam är inte unik).
    await waitFor(() => expect(screen.getByText('2 marked as read').closest('[role="status"]')).toBeInTheDocument());
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
    // Sektionerna börjar hopfällda i bladet, som i kolumnen.
    expect(within(sheet).getByRole('button', { name: /^Titles/ })).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(panels()).toHaveLength(0);
  });

  it('bladet fångar fokus: Tab och Shift+Tab lämnar det aldrig och bakgrunden är inert', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    const sheet = await openSheet(user);
    await within(sheet).findByRole('group', { name: 'Titles' });

    // Bakgrunden göms för hjälpmedel medan bladet är modalt (kugghjulet ligger bakom bladet).
    expect(screen.queryByRole('button', { name: 'Notification settings' })).toBeNull();
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    // Loopen provas vid kanterna, inte genom alla stopp: Shift+Tab från det första elementet landar på det sista, och Tab från det sista på det första.
    const first = within(sheet).getByRole('button', { name: 'Close' });
    const last = within(sheet).getByRole('button', { name: 'Done' });
    first.focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it.each([
    ['Done', (user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement) => user.click(within(sheet).getByRole('button', { name: 'Done' }))],
    ['✕', (user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement) => user.click(within(sheet).getByRole('button', { name: 'Close' }))],
    ['Esc', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ['ett klick utanför', (user: ReturnType<typeof userEvent.setup>) => user.click(document.querySelector('.rq-scrim') as HTMLElement)],
  ])('bladet stängs med %s och fokus återvänder till knappen', async (_how, close) => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    const sheet = await openSheet(user);

    await close(user, sheet);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Notification settings' })).toHaveFocus();
  });

  it('Retry i bladet flyttar fokus till bladets synliga rubrik', async () => {
    const user = userEvent.setup();
    handlers.getSettings = () => ({ success: false, error: 'down' });
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await screen.findByText('4 unread');
    const sheet = await openSheet(user);

    await user.click(await within(sheet).findByRole('button', { name: 'Retry' }, { timeout: 4000 }));
    expect(within(sheet).getByRole('heading', { level: 2, name: 'Notifications' })).toHaveFocus();
  });

  it('desktop: panelen finns även när flödet är tomt', async () => {
    serve([], null);
    renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    await screen.findByRole('heading', { name: 'No news yet — go make some' });

    expect(await screen.findAllByRole('region', { name: 'Notifications' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-tour="news-settings"]')).toHaveLength(1);
  });

  it('desktop: kortet monteras först när flödet eller felet är känt, så filtret inte skjuts ner', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    handlers.getNews = async (...args: unknown[]) => {
      await gate;
      return panelNews.getNews(...(args as [never]));
    };
    renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    await screen.findByText('Loading Pack News');
    expect(panels()).toHaveLength(0);

    release();
    expect(await screen.findByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    const column = screen.getByRole('complementary');
    expect(within(column).getByRole('group', { name: 'Filter' }).compareDocumentPosition(panels()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('desktop: ett flödesfel ger ändå panelen (inställningarna är inte flödet)', async () => {
    handlers.getNews = async () => ({ success: false, error: 'down' });
    renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    expect(await screen.findByText("Couldn't load Pack News", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findAllByRole('region', { name: 'Notifications' })).toHaveLength(1);
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

// ── "Involves me": ett vyfilter vid sidan av typchipsen (?involves=me) ──────────────────────────────────────────────────────────────
// Serverfaken filtrerar som backend: bara rader där jag är aktör/target (eller deltar i ett event) kommer tillbaka.

// Överst en rad som inte rör mig; därefter FEED: Karls titel från mig (20) och Nicks vinst över mig (17) är de enda som rör mig.
const INVOLVES_FEED = () => [levelUp(21, 30, { occurred_at: at(1) }), ...FEED()];
const rowCount = () => document.querySelectorAll('.rq-news-row').length;
const involvesToggle = () => screen.findByRole('button', { name: /^Involves me/ });
const chip = (name: RegExp) => screen.getByRole('button', { name });
const searchOf = () => new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1] ?? '');
const lastCall = () => panelNews.server.calls[panelNews.server.calls.length - 1];

describe('NewsScreen — Involves me', () => {
  beforeEach(() => serve(INVOLVES_FEED(), 16));

  it('togglen skickar involves=me och visar bara returnerade rader', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    const toggle = await involvesToggle();
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(panelNews.server.calls.some((call) => call.involves)).toBe(false);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(rowCount()).toBe(2));
    expect(panelNews.server.calls.filter((call) => call.involves)).toEqual([{ limit: 30, type: undefined, involves: 'me' }]);
    expect(searchOf().get('involves')).toBe('me');
    expect(screen.getByRole('button', { name: /took The Longest Run from you/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Daniel took/ })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));
    expect(searchOf().has('involves')).toBe(false);
  });

  it('adressen styr: ?involves=me börjar på, allt annat är av och skickas aldrig vidare', async () => {
    const on = renderWithApp(<NewsScreen />, { entry: '/news?involves=me', width: MOBILE });
    expect(await involvesToggle()).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(rowCount()).toBe(2));
    on.unmount();

    serve(INVOLVES_FEED(), 16);
    renderWithApp(<NewsScreen />, { entry: '/news?involves=all', width: MOBILE });
    expect(await involvesToggle()).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));
    expect(panelNews.server.calls.some((call) => call.involves)).toBe(false);
  });

  it('togglen kombineras med typfiltret (AND) och båda ligger i adressen', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await involvesToggle();
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));

    await user.click(await involvesToggle());
    await waitFor(() => expect(rowCount()).toBe(2));
    await user.click(chip(/^Challenges/));
    await waitFor(() => expect(rowCount()).toBe(1));

    expect(lastCall()).toMatchObject({ involves: 'me', type: expect.stringContaining('challenge_won') });
    expect(Object.fromEntries(searchOf())).toEqual({ type: 'challenges', involves: 'me' });

    // Typfiltret av igen: toggeln står kvar, och bara den bär adressen.
    await user.click(chip(/^Challenges/));
    await waitFor(() => expect(rowCount()).toBe(2));
    expect(Object.fromEntries(searchOf())).toEqual({ involves: 'me' });
  });

  it('tomläge när inget involverar mig', async () => {
    const user = userEvent.setup();
    serve([levelUp(3, 25), levelUp(2, 24), levelUp(1, 9)], 0);
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await user.click(await involvesToggle());

    expect(await screen.findByRole('heading', { name: 'Nothing involves you yet' })).toBeInTheDocument();
    expect(rowCount()).toBe(0);
    // Filterkortet står kvar så att toggeln går att stänga av.
    expect(screen.getByRole('button', { name: /^Involves me/ })).toHaveAttribute('aria-pressed', 'true');

    // Ett typfilter ovanpå ger det vanliga "Nothing here" — och "Show all news" rensar båda.
    await user.click(chip(/^Titles/));
    expect(await screen.findByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all news' }));
    await waitFor(() => expect(rowCount()).toBe(3));
    expect(searchOf().size).toBe(0);
    expect(screen.getByRole('button', { name: /^Involves me/ })).toHaveAttribute('aria-pressed', 'false');

    // Och från bara toggeln: knappen i tomläget stänger av den.
    await user.click(screen.getByRole('button', { name: /^Involves me/ }));
    await screen.findByRole('heading', { name: 'Nothing involves you yet' });
    await user.click(screen.getByRole('button', { name: 'Show all news' }));
    await waitFor(() => expect(rowCount()).toBe(3));
  });

  it('chip-räknarna och Mark all read påverkas inte av togglen', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    const toggle = await involvesToggle();
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));
    const chips = () => ['Titles', 'Challenges', 'Ranks', 'Events', 'Levels', 'Badges', 'Streaks'].map((name) => chip(new RegExp(`^${name}`)).textContent);
    const before = { chips: chips(), summary: screen.getByText(/ unread$/).textContent, toggle: toggle.textContent };

    await user.click(toggle);
    await waitFor(() => expect(rowCount()).toBe(2));
    // Samma siffror: de läser det ofiltrerade flödet, och knappens egen siffra är raderna som rör mig i det fönstret.
    expect(chips()).toEqual(before.chips);
    expect(screen.getByText(/ unread$/).textContent).toBe(before.summary);
    expect(toggle.textContent).toBe(before.toggle);
    expect(toggle).toHaveTextContent(/2/);

    // Mark all read kvitterar upp till nyaste raden i HELA flödet (21), inte filtrerade flödets (20).
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(panelNews.server.seenCalls).toEqual([21]));
  });

  it('att slå på eller av filtret annonseras i en status-region', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    const toggle = await involvesToggle();
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));
    const region = screen.getByRole('status', { name: 'Filter result' });
    expect(region).toHaveTextContent('');

    // Varje text som regionen någonsin får är en annonsering; ingen annan live-region får text av en växling.
    const announced: string[] = [];
    const observer = new MutationObserver(() => { if (region.textContent) announced.push(region.textContent); });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    const others = () => [...screen.getAllByRole('status'), ...screen.queryAllByRole('alert')].filter((live) => live !== region).map((live) => live.textContent);

    // Annonseras när raderna har landat, inte när knappen trycks.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const serverGetNews = handlers.getNews;
    handlers.getNews = async (...args: unknown[]) => {
      if ((args[0] as { involves?: string } | undefined)?.involves) await gate;
      return serverGetNews(...args);
    };
    await user.click(toggle);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(announced).toEqual([]);
    release();
    await waitFor(() => expect(region).toHaveTextContent('Showing 2 rows that involve you'));
    expect(rowCount()).toBe(2);

    await user.click(toggle);
    await waitFor(() => expect(region).toHaveTextContent('Showing all pack news'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    observer.disconnect();

    // Exakt en annonsering per växling, och inget annat i sidan sa något.
    expect(announced).toEqual(['Showing 2 rows that involve you', 'Showing all pack news']);
    expect(others().every((text) => text === '')).toBe(true);
  });

  it('senare liständringar (Show more, fokusläkning, catch-up) annonserar inte filtret en gång till', async () => {
    const user = userEvent.setup();
    serve(Array.from({ length: 40 }, (_, index) => levelUp(index + 1, index + 1, { target: ME, occurred_at: at(2 + index / 10) })), 0);
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await waitFor(() => expect(rowCount()).toBe(30));
    const region = screen.getByRole('status', { name: 'Filter result' });

    await user.click(await involvesToggle());
    await waitFor(() => expect(region).toHaveTextContent('Showing 30 rows that involve you'));
    const later: string[] = [];
    const observer = new MutationObserver(() => { if (region.textContent) later.push(region.textContent); });
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    // Show more: raderna blir fler men det är inte en filterväxling.
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(rowCount()).toBe(40));
    // Fokusläkning (samma hämtning som pollen): en ny rad på servern landar i listan.
    panelNews.server.rows.unshift(levelUp(41, 41, { target: ME }));
    vi.setSystemTime(new Date(NOW_ISO).getTime() + 60_000);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(rowCount()).toBe(41));
    // Catch-up: Mark all read invaliderar flödena och hämtar bara det nya.
    panelNews.server.rows.unshift(levelUp(42, 42, { target: ME }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(rowCount()).toBe(42));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    observer.disconnect();

    expect(later).toEqual([]);
    expect(region).toHaveTextContent('Showing 30 rows that involve you');
  });

  it('toggelns siffra räknar inte rader med en okänd typ', async () => {
    const unknownMine = { ...levelUp(2, 5, { actor: ME }), type: 'mystery_event' } as never;
    serve([levelUp(3, 5, { target: ME }), unknownMine, levelUp(1, 5)], 0);
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    const toggle = await involvesToggle();
    await waitFor(() => expect(toggle).toHaveTextContent(/1\s*loaded/));
    expect(toggle).not.toHaveTextContent(/2\s*loaded/);
  });

  it('en ändring av typfiltret ensam annonserar inget', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await involvesToggle();
    await waitFor(() => expect(rowCount()).toBe(INVOLVES_FEED().length));
    await user.click(chip(/^Levels/));
    await waitFor(() => expect(rowCount()).toBeLessThan(INVOLVES_FEED().length));
    expect(screen.getByRole('status', { name: 'Filter result' })).toHaveTextContent('');
  });

  it('desktop: knappen ligger först i filterkortet, ovanför typlistan och före inställningspanelen', async () => {
    renderWithApp(<NewsScreen />, { entry: '/news', width: DESKTOP });
    const toggle = await involvesToggle();
    const column = screen.getByRole('complementary');
    const filterCard = toggle.closest('section') as HTMLElement;
    const types = within(column).getByRole('group', { name: 'Filter' });
    const panel = await within(column).findByRole('region', { name: 'Notifications' });

    expect(filterCard).toContainElement(types);
    expect(toggle.compareDocumentPosition(types) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(types.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(column).getByText(/What you did, what was done to you/)).toBeInTheDocument();
    // Ankaret för inställningarna är kvar och finns bara en gång; togglen lägger inget eget.
    expect(document.querySelectorAll('[data-tour="news-settings"]')).toHaveLength(1);
  });

  it('mobil: knappen ligger i filtret men utanför chip-raden, så den inte blir ett åttonde chip', async () => {
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    const toggle = await involvesToggle();
    const chips = screen.getByRole('group', { name: 'Filter' });
    expect(chips).not.toContainElement(toggle);
    expect(within(chips).getAllByRole('button')).toHaveLength(7);
    expect(toggle.closest('section')).toContainElement(chips);
    expect(document.querySelectorAll('[data-tour="news-settings"]')).toHaveLength(1);
  });

  it('rader i det filtrerade flödet markeras som lästa av gesterna', async () => {
    const user = userEvent.setup();
    renderWithApp(<NewsScreen />, { entry: '/news', width: MOBILE });
    await user.click(await involvesToggle());
    await waitFor(() => expect(rowCount()).toBe(2));
    const row = screen.getByRole('button', { name: /\(unread\).*took The Longest Run from you/ });

    act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS); });
    await user.hover(row);
    await waitFor(() => expect(screen.getByRole('button', { name: /took The Longest Run from you/ })).not.toHaveAccessibleName(/unread/));
    await waitFor(() => expect(panelNews.server.readCalls).toEqual([[20]]));
  });
});
