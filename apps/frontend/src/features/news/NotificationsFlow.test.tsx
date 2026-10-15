import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTIFICATION_KINDS, type NewsItem, type NotificationKind } from '@runquest/shared';
import { NotificationsPopover } from '@/app-shell/NotificationsPopover';
import { NotificationSettingsPanel } from '@/features/settings/components/NotificationSettingsPanel';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import '@/test/pointerEvent';
import { POINTER_SETTLE_MS, READ_FLUSH_MS } from './newsModel';
import { ADAM, DAN, NOW_ISO, at, challengeWon, eventOpen, levelUp, ME, newsServer, titleTaken } from './news.fixture';

// Flödestest för klockan (ADR 011 beslut 3, 4 och 9): inställningspanelen, klockans badge och popoverns läst-gester är de RIKTIGA komponenterna med de
// riktiga query-hooksen. Det enda som är en fake är nätverket (backendApi), och det avgörs av samma `isNotifiable`/`resolveSettings`/`sanitizePatch` i
// shared som backend använder (se newsServer i news.fixture.ts). Delarna är enhetstestade var för sig; här provas att de hänger ihop.
vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const SLOW = { timeout: 4000 };

// Sett från ME (u-me), golv 0. Fem rader är notiser (olästa). Den sjätte, min egen handling, är NYAST med flit: popovern kapar vid fem rader, så en egen
// rad som låg sist skulle kapas bort oavsett om filtret fungerar. Ligger den först syns den i popovern bara om egna rader inte filtreras bort.
//   7 level_up (jag själv)                   -> egen rad, räknas aldrig och visas inte i popovern
//   6 title_taken (Karl tar från mig)        -> title_taken_from_me
//   5 title_taken (Daniel tar från Adam)     -> title_others
//   4 event_open                             -> event_open
//   3 challenge_won (Nicklas slår mig)       -> challenge_lost_me
//   2 level_up (Karl)                        -> level_up_others
const FEED = (): NewsItem[] => [
  levelUp(7, 9, { actor: ME, occurred_at: at(1) }),
  titleTaken(6, { occurred_at: at(2) }),
  titleTaken(5, { occurred_at: at(3), actor: DAN, target: ADAM }, { title_name: 'The Consistent King', metric_key: 'longestStreak', value: 21 }),
  eventOpen(4, { occurred_at: at(4) }),
  challengeWon(3, { occurred_at: at(5) }),
  levelUp(2, 25, { occurred_at: at(6) }),
];

const FEED_UNREAD = 5;
const FROM_ME = 'title_taken_from_me';
const LEVEL_OTHERS = 'level_up_others';

const labelOf = (kind: NotificationKind) => NOTIFICATION_KINDS.find((def) => def.kind === kind)!.label;
const keyOf = (kind: NotificationKind) => NOTIFICATION_KINDS.find((def) => def.kind === kind)!.key;

/** Nätverket för hela flödet: en newsServer (serverns state) kopplad till alla handlers de tre ytorna använder. */
function startNetwork(feed: NewsItem[], lastSeen: number | null = null) {
  const news = newsServer(feed, lastSeen);
  handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
  handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
  handlers.markNewsRead = (...args: unknown[]) => news.markNewsRead(...(args as [never]));
  handlers.getSettings = () => news.getSettings();
  handlers.putSettings = (...args: unknown[]) => news.putSettings(...(args as [never]));
  return news;
}

/** Klockan och panelen sida vid sida, som på Settings-sidan (klockan sitter i headern). */
const renderBellAndPanel = () => renderWithApp(<><NotificationsPopover variant="desktop" /><NotificationSettingsPanel /></>, { entry: '/settings', width: 1280 });

const bellWith = (unread: number) => (unread > 0 ? `Pack news, ${unread} unread` : 'Pack news');
const bell = (unread: number) => screen.findByRole('button', { name: bellWith(unread) }, SLOW);
const switchOf = (kind: NotificationKind) => screen.getByRole('switch', { name: labelOf(kind) });
const rowIn = (popover: HTMLElement, text: RegExp) => within(popover).getByRole('button', { name: text });
const isUnread = (row: HTMLElement) => /\(unread\)/.test(row.textContent ?? '');

beforeEach(() => {
  // Bara Date är falsk (relativa tider och rörelsevaktens klocka); timers och nätverk är riktiga.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => vi.useRealTimers());

it('att växla ett reglage i panelen ändrar klockans badge utan omladdning', async () => {
  const user = userEvent.setup();
  const news = startNetwork(FEED());
  renderBellAndPanel();
  await screen.findByRole('group', { name: 'Titles' }, SLOW);
  await bell(FEED_UNREAD);

  // Titel tagen från mig av: raden 6 slutar räknas.
  await user.click(switchOf(FROM_ME));
  await bell(FEED_UNREAD - 1);
  expect(switchOf(FROM_ME)).not.toBeChecked();

  // "Someone levels up" av: raden 2 slutar också räknas.
  await user.click(switchOf(LEVEL_OTHERS));
  await bell(FEED_UNREAD - 2);

  // Och på igen: raden 6 räknas igen, utan att något laddats om.
  await user.click(switchOf(FROM_ME));
  await bell(FEED_UNREAD - 1);
  expect(switchOf(FROM_ME)).toBeChecked();
  expect(news.server.settingsCalls).toEqual([{ [keyOf(FROM_ME)]: false }, { [keyOf(LEVEL_OTHERS)]: false }, { [keyOf(FROM_ME)]: true }]);
  // Servern håller samma sanning: bara de uttryckliga valen är lagrade.
  expect(news.server.settings).toEqual({ [keyOf(FROM_ME)]: true, [keyOf(LEVEL_OTHERS)]: false });
});

it('hover på en oläst rad minskar badgen direkt och skickar ett buntat anrop', async () => {
  // delay: null håller de två hoverna inom ett buntningsfönster (READ_FLUSH_MS) oavsett maskinens tempo.
  const user = userEvent.setup({ delay: null });
  const news = startNetwork(FEED());
  renderWithApp(<NotificationsPopover variant="desktop" />, { entry: '/board', width: 1280 });
  await user.click(await bell(FEED_UNREAD));
  const popover = await screen.findByRole('dialog', { name: 'Pack news' });
  const titleRow = await within(popover).findByRole('button', { name: /Karl took The Longest Run from you/ });
  const eventRow = rowIn(popover, /5K Friday is open/);
  const lostRow = rowIn(popover, /Nicklas beat you in Most km/);
  // Popovern visar notiserna, inte min egen (nyaste) rad 7: fem rader, alla olästa, och den äldsta notisen kom med eftersom den egna inte tog en plats.
  expect(within(popover).getAllByRole('listitem')).toHaveLength(FEED_UNREAD);
  expect(within(popover).queryByRole('button', { name: /You reached level 9/ })).toBeNull();
  expect(within(popover).getByRole('button', { name: /Karl reached level 25/ })).toBeInTheDocument();

  // Rörelsevakten: en pekare som rör sig in i samma stund som popovern öppnas markerar ingenting.
  await user.hover(titleRow);
  expect(isUnread(titleRow)).toBe(true);
  expect(screen.getByRole('button', { name: bellWith(FEED_UNREAD) })).toBeInTheDocument();

  // Efter vakten räknas riktig pekarrörelse (pointerenter + pointermove, som user-event skickar i webbläsarens ordning).
  act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS); });
  await user.hover(eventRow);
  // Direkt: badgen och raden ändras lokalt, innan något nätverksanrop har gått (anropet väntar på buntningen).
  await bell(FEED_UNREAD - 1);
  expect(isUnread(eventRow)).toBe(false);
  expect(news.server.readCalls).toEqual([]);
  await user.hover(lostRow);
  await bell(FEED_UNREAD - 2);
  expect(isUnread(lostRow)).toBe(false);
  // Raden jag hovrade före vakten är fortfarande oläst.
  expect(isUnread(titleRow)).toBe(true);

  // Exakt ett anrop bär båda id:n (ordning: som de hovrades). Det skickas först när buntningsfönstret gått.
  await waitFor(() => expect(news.server.readCalls).toHaveLength(1), { timeout: READ_FLUSH_MS * 8 });
  expect(news.server.readCalls).toEqual([[4, 3]]);
  // Serverns räknare är sanningen och stämmer med den lokala; inget mer skickas.
  await bell(FEED_UNREAD - 2);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, READ_FLUSH_MS + 100)); });
  expect(news.server.readCalls).toEqual([[4, 3]]);
  expect([...news.server.readIds].sort()).toEqual([3, 4]);
  expect(news.server.seenCalls).toEqual([]);
});

it('popovern visar "Nothing new for you" när alla slag är avstängda', async () => {
  const user = userEvent.setup({ delay: null });
  const news = startNetwork(FEED());
  renderBellAndPanel();
  await screen.findByRole('group', { name: 'Titles' }, SLOW);
  await bell(FEED_UNREAD);

  // Stäng av varje slag som är på, ett reglage i taget i panelen (popovern är stängd medan man klickar utanför den).
  const switchedOn = screen.getAllByRole('switch').filter((toggle) => toggle.getAttribute('aria-checked') === 'true');
  expect(switchedOn.length).toBeGreaterThan(0);
  for (const toggle of switchedOn) await user.click(toggle);
  await waitFor(() => expect(news.server.settingsCalls).toHaveLength(switchedOn.length), SLOW);
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).not.toBeChecked();
  await bell(0);

  await user.click(screen.getByRole('button', { name: bellWith(0) }));
  const popover = await screen.findByRole('dialog', { name: 'Pack news' });
  expect(await within(popover).findByRole('heading', { name: 'Nothing new for you' })).toBeInTheDocument();
  expect(within(popover).queryByRole('list', { name: 'Latest news' })).toBeNull();
  // Flödet är inte tomt: det är inställningarna som döljer. Länken till /news, där allt syns, finns kvar.
  expect(within(popover).queryByText('No news yet — go make some.')).toBeNull();
  expect(within(popover).getByRole('link', { name: 'See all pack news' })).toHaveAttribute('href', '/news');
});
