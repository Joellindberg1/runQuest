import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BADGE_SERIES, TIER_NAMES, type NewsItem } from '@runquest/shared';
import { POINTER_SETTLE_MS, READ_FLUSH_MS, buildNewsRow, type NewsContext } from '../newsModel';
import { KARL, ME, NOW, NOW_ISO, at, badgeEarned, item, levelUp, newsServer, releasePublished, titleTaken } from '../news.fixture';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import '@/test/pointerEvent';
import { NewsRow } from './NewsRow';
import { NewsScreen } from './NewsScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer och hör inte till det som provas här.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// badge_earned-raden i flödet (RUN-128, spec F7, Council 23): sm-emblem i ikonkolumnen (aria-hidden) i stället för zap, Levels-grön kant, typraden bär betydelsen.

const ctx: NewsContext = { viewerId: ME.id, now: NOW };
const streakKeeper = BADGE_SERIES.find((series) => series.key === 'streak_keeper') as (typeof BADGE_SERIES)[number];
const milestoner = BADGE_SERIES[0];

const renderRow = (row: ReturnType<typeof buildNewsRow>) => render(<ul>{row && <NewsRow row={row} />}</ul>);

describe('NewsRow — badge_earned (F7)', () => {
  it('ritar ett sm-emblem i ikonkolumnen i stället för kategorins ikon, aria-hidden', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, { actor: KARL }, { series: streakKeeper.key, tier: 1, previous_tier: null }), ctx));
    const iconCell = container.querySelector('.rq-news-row__icon') as HTMLElement;
    const emblem = iconCell.querySelector('.rq-badge');
    expect(emblem).toHaveClass('rq-badge--sm');
    expect(emblem).toHaveAttribute('data-tier', TIER_NAMES[0].toLowerCase());
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    // Ingen zap-ikon bredvid emblemet, och emblemet bär ingen egen etikett (texten under säger det).
    expect(iconCell.querySelectorAll(':scope > svg')).toHaveLength(0);
    expect(emblem).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('emblemet visar den NYA nivån vid "evolved"', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, { actor: ME }, { series: milestoner.key, tier: 3, previous_tier: 2 }), ctx));
    expect(container.querySelector('.rq-news-row__icon .rq-badge')).toHaveAttribute('data-tier', TIER_NAMES[2].toLowerCase());
  });

  it('typraden är "Badge earned" respektive "Badge evolved" och texten oförändrad', () => {
    const earned = renderRow(buildNewsRow(badgeEarned(1, { actor: KARL }, { series: streakKeeper.key, tier: 1, previous_tier: null }), ctx));
    expect(screen.getByText('Badge earned')).toHaveClass('rq-news-row__kind');
    expect(screen.getByText(`Karl earned ${streakKeeper.name} — ${TIER_NAMES[0]}.`)).toBeInTheDocument();
    earned.unmount();
    renderRow(buildNewsRow(badgeEarned(2, { actor: ME }, { series: milestoner.key, tier: 3, previous_tier: 2 }), ctx));
    expect(screen.getByText('Badge evolved')).toBeInTheDocument();
    expect(screen.getByText(`You evolved ${milestoner.name} from ${TIER_NAMES[1]} to ${TIER_NAMES[2]}.`)).toBeInTheDocument();
  });

  it('kanten förblir Levels (data-category="level") och raden har emblem-kolumnen', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1), ctx));
    const row = container.querySelector('.rq-news-row') as HTMLElement;
    expect(row).toHaveAttribute('data-category', 'level');
    expect(row).toHaveAttribute('data-emblem');
  });

  it('okänd serie (annan serverversion) behåller reservikonen: inget emblem och ingen emblem-kolumn', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, {}, { series: 'retired_series', tier: 2, previous_tier: null }), ctx));
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
    expect(container.querySelector('.rq-news-row')).not.toHaveAttribute('data-emblem');
  });

  it('en tier utanför 1..6 ritar inget emblem som ljuger — reservikonen i stället', () => {
    const { container } = renderRow(buildNewsRow(badgeEarned(1, {}, { series: milestoner.key, tier: 9, previous_tier: null }), ctx));
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
  });

  it('övriga rader i Levels (level_up) är oförändrade: ikon, inget emblem', () => {
    const { container } = renderRow(buildNewsRow(levelUp(1, 25), ctx));
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
    expect(container.querySelector('.rq-news-row')).not.toHaveAttribute('data-emblem');
  });
});

describe('NewsRow — release_published', () => {
  it('ritar sparkles-ikonen (ingen emblem-kolumn), typraden "New version" och texten "RunQuest vX is out — titel"', () => {
    const { container } = renderRow(buildNewsRow(releasePublished(1), ctx));
    const row = container.querySelector('.rq-news-row') as HTMLElement;
    expect(row).toHaveAttribute('data-category', 'release');
    expect(row).not.toHaveAttribute('data-emblem');
    expect(container.querySelector('.rq-news-row__icon svg')).not.toBeNull();
    expect(container.querySelector('.rq-badge')).toBeNull();
    expect(screen.getByText('New version')).toHaveClass('rq-news-row__kind');
    expect(screen.getByText('RunQuest v0.6.1 is out — News about releases')).toBeInTheDocument();
  });

  it('ingen länk: nyhetsrader har inget navigeringsmönster, bara läs-knappen', () => {
    renderRow(buildNewsRow(releasePublished(1), ctx));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

// ─── Läs-gesterna (ADR 011 beslut 4 och addendum 2026-10-14) ──────────────────────────────────────────────
// Raderna ritas av NewsScreen mot en fake server: gesten, den optimistiska uppdateringen och det buntade POST-anropet provas tillsammans.
// Datumet är fejkat (bara Date) så att rörelsevaktens fönster styrs med advanceTimersByTime medan waitFor och nätverksfejken kör riktiga timers.

let news: ReturnType<typeof newsServer>;

function setup(feed: NewsItem[], lastSeen: number | null = 0) {
  news = newsServer(feed, lastSeen);
  handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
  handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
  handlers.markNewsRead = (...args: unknown[]) => news.markNewsRead(...(args as [never]));
  handlers.getSettings = () => news.getSettings();
  handlers.putSettings = (...args: unknown[]) => news.putSettings(...(args as [never]));
}

// 5, 4 och 3 är olästa nivårader från Karl; 2 är min egen handling; 1 ligger under vattenmärket (läst).
const UNREAD_FEED = (): NewsItem[] => [
  levelUp(5, 25, { occurred_at: at(1) }),
  levelUp(4, 20, { occurred_at: at(2) }),
  levelUp(3, 15, { occurred_at: at(3) }),
  levelUp(2, 9, { actor: ME, occurred_at: at(4) }),
  levelUp(1, 5, { occurred_at: at(5) }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => vi.useRealTimers());

/** Låter rörelsevaktens fönster passera (listan har varit monterad längre än POINTER_SETTLE_MS). */
const settle = () => act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS); });

async function renderFeed(feed: NewsItem[] = UNREAD_FEED(), lastSeen: number | null = 1) {
  setup(feed, lastSeen);
  renderWithApp(<NewsScreen />, { entry: '/news' });
  await screen.findByRole('button', { name: /Karl reached level 25$/ });
}

const rowButton = (text: RegExp | string) => screen.getByRole('button', { name: text });
const isUnread = (button: HTMLElement) => /\(unread\)/.test(button.textContent ?? '');
/** Ger cachen och React tid att rendera om, så att ett "inget hände" inte godkänns bara för att DOM:en inte hunnit ändras. */
const rendered = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const flushWait =() => act(async () => { await new Promise((resolve) => setTimeout(resolve, READ_FLUSH_MS * 2)); });

describe('NewsRow — läs-gester', () => {
  it('musen som rör sig in över en oläst rad markerar den läst direkt', async () => {
    await renderFeed();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
    settle();

    fireEvent.pointerEnter(rowButton(/Karl reached level 25$/), { pointerType: 'mouse' });

    // Samma ögonblick: inget anrop har gått (det buntas), medan raden och räknaren är lästa i cachen och syns så fort React renderat om.
    expect(news.server.readCalls).toEqual([]);
    await waitFor(() => expect(isUnread(rowButton(/Karl reached level 25$/))).toBe(false));
    expect(isUnread(rowButton(/Karl reached level 20$/))).toBe(true);
    await waitFor(() => expect(screen.getByText('2 unread')).toBeInTheDocument());
    await waitFor(() => expect(news.server.readCalls).toEqual([[5]]), { timeout: READ_FLUSH_MS * 4 });
  });

  it('pointerenter inom 150 ms efter montering markerar inte raden läst', async () => {
    await renderFeed();
    const row = rowButton(/Karl reached level 25$/);

    // Pekaren som vilade över listan när den öppnades: pointerenter inom fönstret räknas inte, och inget anrop går.
    fireEvent.pointerEnter(row, { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS - 1); });
    fireEvent.pointerEnter(row, { pointerType: 'mouse' });
    fireEvent.pointerMove(row, { pointerType: 'mouse' });
    await flushWait();
    expect(isUnread(row)).toBe(true);
    expect(news.server.readCalls).toEqual([]);

    // Efter fönstret räknas verklig rörelse över raden som pekaren redan vilade över (pointermove), utan att den behöver lämna och återinträda.
    settle();
    fireEvent.pointerMove(row, { pointerType: 'pen' });
    await waitFor(() => expect(isUnread(row)).toBe(false));
  });

  it('fönstret gäller listan, inte raden: en rad som kommer in senare (Show more) markeras av första rörelsen', async () => {
    const older = Array.from({ length: 35 }, (_, index) => levelUp(index + 1, index + 1, { occurred_at: at(index + 1) }));
    setup(older, 0);
    renderWithApp(<NewsScreen />, { entry: '/news' });
    await screen.findByRole('button', { name: /Karl reached level 35$/ });
    settle();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    const arrived = await screen.findByRole('button', { name: /Karl reached level 3$/ });
    expect(isUnread(arrived)).toBe(true);

    // Ingen ny 150 ms-vakt för den nya raden: första rörelsen över den räknas direkt.
    fireEvent.pointerEnter(arrived, { pointerType: 'mouse' });
    await waitFor(() => expect(isUnread(rowButton(/Karl reached level 3$/))).toBe(false));
  });

  it('tangentbordsfokus markerar inte raden läst, Enter eller Space gör det', async () => {
    await renderFeed();
    settle();
    const first = rowButton(/Karl reached level 25$/);
    const second = rowButton(/Karl reached level 20$/);

    const user = userEvent.setup();

    // Ett Tab-svep genom listan: fokus (focusin) ensam markerar ingenting.
    act(() => first.focus());
    await user.tab();
    expect(second).toHaveFocus();
    await flushWait();
    expect(isUnread(first)).toBe(true);
    expect(isUnread(second)).toBe(true);
    expect(news.server.readCalls).toEqual([]);

    // Enter och Space på raden med fokus: user-event gör som webbläsaren (Enter vid keydown, Space vid keyup blir ett click på knappen), och det är
    // samma väg som en skärmläsare som aktiverar utan att flytta fokus tar. Raden hanterar click, inte tangenterna själv.
    await user.tab({ shift: true });
    expect(first).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(isUnread(rowButton(/Karl reached level 25$/))).toBe(false));
    expect(isUnread(rowButton(/Karl reached level 20$/))).toBe(true);
    await user.tab();
    await user.keyboard(' ');
    await waitFor(() => expect(isUnread(rowButton(/Karl reached level 20$/))).toBe(false));
    // Att båda blev lästa är det som gäller här; hur de buntas (ett eller flera anrop beroende på takten) provas i useNewsQueries.test.tsx.
    await waitFor(() => expect(news.server.readCalls.flat().sort()).toEqual([4, 5]), { timeout: READ_FLUSH_MS * 4 });
  });

  it('touch (tap) på en oläst rad markerar den läst, och pointerenter med touch gör inget', async () => {
    await renderFeed();
    settle();
    const row = rowButton(/Karl reached level 25$/);

    // Fingret landar: pointerenter/pointerdown med touch markerar inte (en scroll börjar likadant).
    fireEvent.pointerEnter(row, { pointerType: 'touch' });
    fireEvent.pointerDown(row, { pointerType: 'touch' });
    await rendered();
    expect(isUnread(row)).toBe(true);

    // Tap = pointerup utan rörelse, vilket webbläsaren avslutar med ett click.
    fireEvent.pointerUp(row, { pointerType: 'touch' });
    fireEvent.click(row);
    await waitFor(() => expect(isUnread(rowButton(/Karl reached level 25$/))).toBe(false));
    await waitFor(() => expect(news.server.readCalls).toEqual([[5]]), { timeout: READ_FLUSH_MS * 4 });
  });

  it('en scroll med touch över listan markerar inga rader läst', async () => {
    await renderFeed();
    settle();

    // Scroll: pointerdown på en rad, fingret drar (pointermove) och webbläsaren tar över med pointercancel. Inget click följer.
    for (const text of [/Karl reached level 25$/, /Karl reached level 20$/, /Karl reached level 15$/]) {
      const row = rowButton(text);
      fireEvent.pointerEnter(row, { pointerType: 'touch' });
      fireEvent.pointerDown(row, { pointerType: 'touch' });
      fireEvent.pointerMove(row, { pointerType: 'touch', clientY: 40 });
      fireEvent.pointerCancel(row, { pointerType: 'touch' });
    }
    await flushWait();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
    expect(news.server.readCalls).toEqual([]);
  });

  it('raden är en knapp med ett tydligt namn, inte ett li med tabindex', async () => {
    await renderFeed();
    const list = screen.getAllByRole('list')[0];
    const items = within(list).getAllByRole('listitem');

    expect(items.every((li) => !li.hasAttribute('tabindex'))).toBe(true);
    const unread = rowButton(/Karl reached level 25$/);
    expect(items[0]).toContainElement(unread);
    // Namnet bär typen, olästläget (inte bara färg), tiden och texten.
    expect(unread).toHaveAccessibleName(/Level up.*\(unread\).*Karl reached level 25/);
    expect(within(unread).queryByRole('link')).toBeNull();
    expect(within(unread).queryByRole('button')).toBeNull();

    // En läst rad är en knapp med samma form, och en rad som blir läst är kvar som samma element (fokus försvinner inte).
    const read = rowButton(/Karl reached level 5$/);
    expect(read).toHaveAttribute('type', 'button');
    expect(read).not.toHaveAccessibleName(/unread/);
    act(() => unread.focus());
    fireEvent.click(unread);
    await waitFor(() => expect(rowButton(/Karl reached level 25$/)).not.toHaveAccessibleName(/unread/));
    expect(rowButton(/Karl reached level 25$/)).toHaveFocus();
  });

  it('en redan läst, egen, avstängd eller backfill-rad ger inget nätverksanrop', async () => {
    const feed = [
      titleTaken(9, { occurred_at: at(1) }),
      levelUp(8, 30, { occurred_at: at(2) }),
      levelUp(7, 29, { actor: ME, occurred_at: at(3) }),
      levelUp(6, 5, { occurred_at: at(24 * 20), is_backfill: true }),
      levelUp(5, 4, { occurred_at: at(6) }),
      item('level_up', 1, { level: 3 }, { actor: KARL, occurred_at: at(7) }),
    ];
    setup(feed, 1);
    // Nivåhöjningar från andra är avstängda: raderna finns på /news men är inte olästa.
    news.server.settings = { 'notify.level_up_others': false };
    renderWithApp(<NewsScreen />, { entry: '/news' });
    await screen.findByRole('button', { name: /Karl took The Longest Run from you/ });
    settle();

    // 8 (avstängt slag), 7 (egen), 6 (backfill), 5 (avstängt slag) och 1 (under vattenmärket, läst).
    for (const text of [/Karl reached level 30$/, /You reached level 29$/, /Karl reached level 5$/, /Karl reached level 4$/, /Karl reached level 3$/]) {
      const row = rowButton(text);
      expect(isUnread(row)).toBe(false);
      fireEvent.pointerEnter(row, { pointerType: 'mouse' });
      fireEvent.pointerMove(row, { pointerType: 'mouse' });
      fireEvent.click(row);
    }
    await flushWait();
    expect(news.server.readCalls).toEqual([]);
    expect(screen.getByText('1 unread')).toBeInTheDocument();

    // Kontroll: den enda olästa raden ger ett anrop.
    fireEvent.pointerEnter(rowButton(/Karl took The Longest Run from you/), { pointerType: 'mouse' });
    await waitFor(() => expect(news.server.readCalls).toEqual([[9]]), { timeout: READ_FLUSH_MS * 4 });
  });

  it('en snabb svepning över flera rader markerar alla passerade (dokumenterat pris)', async () => {
    await renderFeed();
    settle();

    for (const text of [/Karl reached level 25$/, /Karl reached level 20$/, /Karl reached level 15$/]) {
      fireEvent.pointerEnter(rowButton(text), { pointerType: 'mouse' });
    }

    await waitFor(() => expect(screen.getByText('All caught up')).toBeInTheDocument());
    await waitFor(() => expect(news.server.readCalls).toEqual([[5, 4, 3]]), { timeout: READ_FLUSH_MS * 4 });
  });
});
