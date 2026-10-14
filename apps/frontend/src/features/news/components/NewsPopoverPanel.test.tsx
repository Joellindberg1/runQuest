import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { BADGE_SERIES, TIER_NAMES, type NewsItem } from '@runquest/shared';
import { POINTER_SETTLE_MS, READ_FLUSH_MS } from '../newsModel';
import { KARL, ME, NOW_ISO, at, badgeEarned, levelUp, newsServer, releasePublished, streakBroken, titleTaken } from '../news.fixture';
import { NotificationsPopover } from '@/app-shell/NotificationsPopover';
import { useUserSettings } from '@/features/settings/hooks/useUserSettings';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import '@/test/pointerEvent';
import { NewsPopoverPanel } from './NewsPopoverPanel';
import { NewsScreen } from './NewsScreen';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
// Turen startar driver.js efter en timer och hör inte till det som provas här.
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));

// Klock-popoverns badge_earned-rader (RUN-128, spec F7 högra panelen): sm-emblem (aria-hidden, Council 23) i stället för pricken. Övriga rader är oförändrade.

const milestoner = BADGE_SERIES[0];

let news: ReturnType<typeof newsServer>;

function setup(feed: NewsItem[], lastSeen: number | null = null) {
  news = newsServer(feed, lastSeen);
  handlers.getNews = (...args: unknown[]) => news.getNews(...(args as [never]));
  handlers.getSettings = () => news.getSettings();
  handlers.putSettings = (...args: unknown[]) => news.putSettings(...(args as [never]));
  handlers.markNewsRead = (...args: unknown[]) => news.markNewsRead(...(args as [never]));
  handlers.markNewsSeen = (...args: unknown[]) => news.markNewsSeen(...(args as [never]));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  resetFakeBackend();
});
afterEach(() => vi.useRealTimers());

const rows = () => within(screen.getByRole('list', { name: 'Latest news' })).getAllByRole('listitem');

describe('NewsPopoverPanel — badge_earned (F7)', () => {
  it('ritar ett sm-emblem i stället för pricken, aria-hidden, med den nya nivån', async () => {
    setup([badgeEarned(2, { actor: KARL, occurred_at: at(3) }, { series: milestoner.key, tier: 3, previous_tier: 2 }), badgeEarned(1, { actor: KARL, occurred_at: at(5) })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('list', { name: 'Latest news' });
    const [evolved, earned] = rows();

    const emblem = evolved.querySelector('.rq-news-pop__emblem .rq-badge');
    expect(emblem).toHaveClass('rq-badge--sm');
    expect(emblem).toHaveAttribute('data-tier', TIER_NAMES[2].toLowerCase());
    expect(emblem).toHaveAttribute('aria-hidden', 'true');
    expect(evolved.querySelector('.rq-news-pop__dot')).toBeNull();
    expect(evolved).toHaveAttribute('data-emblem');
    expect(within(evolved).getByText('Badge evolved')).toBeInTheDocument();
    expect(within(evolved).getByText(`Karl evolved ${milestoner.name} from ${TIER_NAMES[1]} to ${TIER_NAMES[2]}.`)).toBeInTheDocument();
    expect(earned.querySelector('.rq-news-pop__emblem .rq-badge')).toHaveAttribute('data-tier', TIER_NAMES[0].toLowerCase());
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('övriga rader och en okänd serie behåller pricken, utan emblem', async () => {
    setup([levelUp(2, 25, { occurred_at: at(2) }), badgeEarned(1, { occurred_at: at(3) }, { series: 'retired_series', tier: 2, previous_tier: null })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('list', { name: 'Latest news' });
    for (const row of rows()) {
      expect(row.querySelector('.rq-news-pop__dot')).not.toBeNull();
      expect(row.querySelector('.rq-badge')).toBeNull();
      expect(row).not.toHaveAttribute('data-emblem');
    }
  });
});

// Klockan följer inställningarna (ADR 011 beslut 3): avstängda slag och egna handlingar syns inte i popovern; /news visar allt.

/** Vad panelen i inställningarna gör: byter ett slag via samma hook (RUN-194:s komponent monteras inte här). */
function SettingsToggle({ kind }: { kind: string }) {
  const settings = useUserSettings();
  return <button type="button" onClick={() => settings.toggle(`notify.${kind}`)}>Toggle {kind}</button>;
}

describe('NewsPopoverPanel — följer inställningarna', () => {
  it('tomt fönster visar "Nothing new for you" och länken till /news', async () => {
    setup([levelUp(2, 7, { actor: ME, occurred_at: at(1) }), streakBroken(1, { occurred_at: at(2) })]);
    news.server.settings = { 'notify.streak_broken_others': false };
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);

    expect(await screen.findByRole('heading', { name: 'Nothing new for you' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Latest news' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See all pack news' })).toHaveAttribute('href', '/news');
    expect(screen.queryByText('No news yet — go make some.')).toBeNull();
  });

  it('helt tomt flöde visar "No news yet — go make some."', async () => {
    setup([]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);

    expect(await screen.findByText('No news yet — go make some.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing new for you')).toBeNull();
    expect(screen.getByRole('link', { name: 'See all pack news' })).toHaveAttribute('href', '/news');
  });

  it('visar inte det tomma fönstret medan flödet laddar', async () => {
    handlers.getNews = () => new Promise(() => {});
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    expect(await screen.findByText('Loading Pack News')).toBeInTheDocument();
    expect(screen.queryByText('Nothing new for you')).toBeNull();
  });

  it('en avstängd kategori försvinner ur popovern direkt efter växling i panelen', async () => {
    setup([levelUp(2, 25, { occurred_at: at(1) }), titleTaken(1, { occurred_at: at(2) })]);
    renderWithApp(<><SettingsToggle kind="level_up_others" /><NewsPopoverPanel onClose={() => {}} /></>);
    expect(await screen.findByText('Karl reached level 25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle level_up_others' }));

    await waitFor(() => expect(screen.queryByText('Karl reached level 25')).toBeNull());
    expect(screen.getByText('Karl took The Longest Run from you — 32.8 km')).toBeInTheDocument();
    await waitFor(() => expect(news.server.settingsCalls).toEqual([{ 'notify.level_up_others': false }]));
    // Raden är kvar borta när servern svarat: ingen omladdning behövdes.
    expect(screen.queryByText('Karl reached level 25')).toBeNull();
  });

  it('raden försvinner vid den optimistiska växlingen, innan servern har svarat', async () => {
    setup([levelUp(2, 25, { occurred_at: at(1) }), titleTaken(1, { occurred_at: at(2) })]);
    let respond: () => void = () => {};
    const gate = new Promise<void>((resolve) => { respond = resolve; });
    handlers.putSettings = async (...args: unknown[]) => {
      await gate;
      return news.putSettings(...(args as [never]));
    };
    renderWithApp(<><SettingsToggle kind="level_up_others" /><NewsPopoverPanel onClose={() => {}} /></>);
    expect(await screen.findByText('Karl reached level 25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle level_up_others' }));

    await waitFor(() => expect(screen.queryByText('Karl reached level 25')).toBeNull());
    // PUT:en hålls fortfarande: ändringen kom från den optimistiska cachen, inte från serverns svar.
    expect(news.server.settingsCalls).toEqual([]);
    respond();
    await waitFor(() => expect(news.server.settingsCalls).toHaveLength(1));
  });

  it('egna handlingar visas inte i popovern men finns på /news', async () => {
    setup([levelUp(2, 9, { actor: ME, occurred_at: at(1) }), levelUp(1, 25, { actor: KARL, occurred_at: at(2) })]);
    renderWithApp(<><NewsPopoverPanel onClose={() => {}} /><NewsScreen /></>, { entry: '/news' });

    const list = await screen.findByRole('list', { name: 'Latest news' });
    expect(within(list).getAllByRole('listitem').map((row) => row.querySelector('.rq-news-pop__text')?.textContent)).toEqual(['Karl reached level 25']);
    expect(await screen.findByText('You reached level 9')).toBeInTheDocument();
  });

  it('popoverns sidhuvud har ingen länk eller knapp till inställningarna', async () => {
    setup([levelUp(1, 25, { occurred_at: at(1) })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} showClose />);
    await screen.findByRole('list', { name: 'Latest news' });
    const header = screen.getByRole('heading', { name: 'The Pack News' }).closest('header') as HTMLElement;

    expect(within(header).queryByRole('link')).toBeNull();
    expect(within(header).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Mark all read', 'Close']);
  });

  it('det tomma fönstret leder bara till /news, inte till inställningarna', async () => {
    setup([levelUp(1, 9, { actor: ME })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('heading', { name: 'Nothing new for you' });
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/news']);
  });
});

describe('NewsPopoverPanel — release_published', () => {
  it('visar raden med "New version" och releasetexten, kategorin release och pricken (inget emblem)', async () => {
    setup([releasePublished(2, { occurred_at: at(1) }, { version: '0.6.1', title: 'News about releases' }), levelUp(1, 25, { occurred_at: at(3) })]);
    renderWithApp(<NewsPopoverPanel onClose={() => {}} />);
    await screen.findByRole('list', { name: 'Latest news' });
    const [release, level] = rows();
    expect(release).toHaveAttribute('data-category', 'release');
    expect(release).not.toHaveAttribute('data-emblem');
    expect(release.querySelector('.rq-news-pop__dot')).not.toBeNull();
    expect(within(release).getByText('New version')).toBeInTheDocument();
    expect(within(release).getByText('RunQuest v0.6.1 is out — News about releases')).toBeInTheDocument();
    expect(level).toHaveAttribute('data-category', 'level');
  });
});

// ─── Läs-gesterna i popovern (ADR 011 addendum 2026-10-14) ───────────────────────────────────────────────
// Samma gester som /news-raderna; rörelsevakten räknas från att popovern öppnas. Klockan (NotificationsPopover) är med så att räknaren går att läsa av.

// 5, 4 och 3 är olästa nivårader från Karl; 2 är min egen handling och syns inte i popovern.
const POPOVER_FEED = (): NewsItem[] => [
  levelUp(5, 25, { occurred_at: at(1) }),
  levelUp(4, 20, { occurred_at: at(2) }),
  levelUp(3, 15, { occurred_at: at(3) }),
  levelUp(2, 9, { actor: ME, occurred_at: at(4) }),
];

const BELL = /^Pack news/;
const settle = () => act(() => { vi.advanceTimersByTime(POINTER_SETTLE_MS); });
const isUnread = (button: HTMLElement) => /\(unread\)/.test(button.textContent ?? '');

async function openBell() {
  fireEvent.click(await screen.findByRole('button', { name: BELL }));
  return screen.findByRole('dialog', { name: 'Pack news' });
}
/** Ger cachen och React tid att rendera om, så att ett "inget hände" inte godkänns bara för att DOM:en inte hunnit ändras. */
const rendered = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const popoverRow = (popover: HTMLElement, text: RegExp) => within(popover).getByRole('button', { name: text });

describe('NewsPopoverPanel — läs-gester', () => {
  it('hover och Enter/Space markerar popoverns rad läst och räknaren på klockan minskar', async () => {
    setup(POPOVER_FEED(), 0);
    renderWithApp(<NotificationsPopover variant="desktop" />);
    const popover = await openBell();
    expect(await screen.findByRole('button', { name: 'Pack news, 3 unread' })).toBeInTheDocument();
    settle();

    // Fokus ensam markerar inte.
    act(() => popoverRow(popover, /Karl reached level 25$/).focus());
    await rendered();
    expect(isUnread(popoverRow(popover, /Karl reached level 25$/))).toBe(true);

    // Hover (efter rörelse): raden är läst och klockan räknar ner.
    fireEvent.pointerEnter(popoverRow(popover, /Karl reached level 20$/), { pointerType: 'mouse' });
    await waitFor(() => expect(isUnread(popoverRow(popover, /Karl reached level 20$/))).toBe(false));
    expect(await screen.findByRole('button', { name: 'Pack news, 2 unread' })).toBeInTheDocument();
    // Raden blir kvar i listan som läst.
    expect(within(popover).getAllByRole('listitem')).toHaveLength(3);

    // Enter/Space = knappens aktivering (click).
    fireEvent.click(popoverRow(popover, /Karl reached level 25$/));
    expect(await screen.findByRole('button', { name: 'Pack news, 1 unread' })).toBeInTheDocument();
    await waitFor(() => expect(news.server.readCalls).toEqual([[4, 5]]), { timeout: READ_FLUSH_MS * 4 });
  });

  it('rörelsevakten räknas från att popovern öppnas: en vilande pekare markerar inget, och varje öppning ger ett nytt fönster', async () => {
    setup(POPOVER_FEED(), 0);
    renderWithApp(<NotificationsPopover variant="desktop" />);
    let popover = await openBell();

    // Pekaren vilar över raden när popovern öppnas.
    fireEvent.pointerEnter(popoverRow(popover, /Karl reached level 25$/), { pointerType: 'mouse' });
    await rendered();
    expect(isUnread(popoverRow(popover, /Karl reached level 25$/))).toBe(true);
    settle();
    fireEvent.pointerMove(popoverRow(popover, /Karl reached level 25$/), { pointerType: 'mouse' });
    await waitFor(() => expect(isUnread(popoverRow(popover, /Karl reached level 25$/))).toBe(false));

    // Stäng och öppna igen: ett nytt fönster, så en pekare som nu vilar över nästa rad markerar den inte.
    fireEvent.keyDown(popover, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    popover = await openBell();
    fireEvent.pointerEnter(popoverRow(popover, /Karl reached level 20$/), { pointerType: 'mouse' });
    await rendered();
    expect(isUnread(popoverRow(popover, /Karl reached level 20$/))).toBe(true);
    settle();
    fireEvent.pointerEnter(popoverRow(popover, /Karl reached level 20$/), { pointerType: 'mouse' });
    await waitFor(() => expect(isUnread(popoverRow(popover, /Karl reached level 20$/))).toBe(false));
  });

  it('touch: en tap markerar raden, en scroll gör det inte', async () => {
    setup(POPOVER_FEED(), 0);
    renderWithApp(<NotificationsPopover variant="desktop" />);
    const popover = await openBell();
    settle();
    const row = () => popoverRow(popover, /Karl reached level 25$/);

    fireEvent.pointerEnter(row(), { pointerType: 'touch' });
    fireEvent.pointerDown(row(), { pointerType: 'touch' });
    fireEvent.pointerMove(row(), { pointerType: 'touch', clientY: 30 });
    fireEvent.pointerCancel(row(), { pointerType: 'touch' });
    await rendered();
    expect(isUnread(row())).toBe(true);

    fireEvent.pointerDown(row(), { pointerType: 'touch' });
    fireEvent.pointerUp(row(), { pointerType: 'touch' });
    fireEvent.click(row());
    await waitFor(() => expect(isUnread(row())).toBe(false));
  });

  it('Mark all read fungerar fortfarande', async () => {
    setup(POPOVER_FEED(), 0);
    renderWithApp(<NotificationsPopover variant="desktop" />);
    const popover = await openBell();
    settle();
    fireEvent.pointerEnter(popoverRow(popover, /Karl reached level 25$/), { pointerType: 'mouse' });
    await waitFor(() => expect(isUnread(popoverRow(popover, /Karl reached level 25$/))).toBe(false));

    fireEvent.click(within(popover).getByRole('button', { name: 'Mark all read' }));

    expect(await screen.findByRole('button', { name: 'Pack news' })).toBeInTheDocument();
    await waitFor(() => expect(news.server.seenCalls).toEqual([5]));
    await waitFor(() => expect(within(popover).getByRole('status')).toHaveTextContent('2 marked as read'));
    expect(within(popover).queryByRole('button', { name: 'Mark all read' })).toBeNull();
    for (const text of [/Karl reached level 25$/, /Karl reached level 20$/, /Karl reached level 15$/]) expect(isUnread(popoverRow(popover, text))).toBe(false);
  });
});
