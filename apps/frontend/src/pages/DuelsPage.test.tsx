import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import DuelsPage from './DuelsPage';
import { TOUR_DUELS_V2 } from '@/features/onboarding/featureTourSteps';
import { ADAM, DAN, KARL, ME, NAMES, NICK, challenge, historyItem, stat, token } from '@/features/challenges/duels.fixture';
import type { MyChallenges } from '@/features/challenges/duelsModel';
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// Karl och Dan möts i en pågående legendary-duell; Adam och Nicklas i en major. Jag är ledig.
const KARL_DAN = challenge({ id: 'c-kd', challenger_id: KARL, opponent_id: DAN, tier: 'legendary', metric: 'total_xp', duration_days: 14, status: 'active', start_date: day(-5), end_date: day(9) });
const ADAM_NICK = challenge({ id: 'c-an', challenger_id: ADAM, opponent_id: NICK, tier: 'major', metric: 'runs', duration_days: 7, status: 'active', start_date: day(-6), end_date: day(1) });
const MINE = challenge({ id: 'c-me', challenger_id: ME, opponent_id: ADAM, tier: 'major', metric: 'runs', duration_days: 7, status: 'active', start_date: day(-2), end_date: day(5) });
const FROM_NICK = challenge({ id: 'c-in', challenger_id: NICK, opponent_id: ME, tier: 'major', metric: 'km', duration_days: 7, status: 'pending' });
const LEGENDARY_FROM_KARL = challenge({ id: 'c-leg', challenger_id: KARL, opponent_id: ME, tier: 'legendary', metric: 'total_xp', duration_days: 21, status: 'pending', legendary_sent_at: new Date().toISOString() });
const TO_DAN = challenge({ id: 'c-out', challenger_id: ME, opponent_id: DAN, tier: 'minor', metric: 'runs', duration_days: 5, status: 'pending' });

const TOKENS = [
  token({ id: 't-minor-km-a', tier: 'minor', metric: 'km', duration_days: 7 }),
  token({ id: 't-minor-km-b', tier: 'minor', metric: 'km', duration_days: 7 }),
  token({ id: 't-minor-runs', tier: 'minor', metric: 'runs', duration_days: 5 }),
  token({ id: 't-major', tier: 'major', metric: 'km', duration_days: 10 }),
  token({ id: 't-legendary', tier: 'legendary', metric: 'total_xp', duration_days: 21 }),
];

const STATS = [
  stat(ME, { wins: 2, losses: 1, challenge_active: false }),
  stat(KARL, { wins: 2, challenge_active: true }),
  stat(ADAM, { wins: 0, losses: 2, challenge_active: true }),
  stat(NICK, { wins: 1, draws: 1, challenge_active: true }),
  stat(DAN, { challenge_active: true }),
];

const my = (over: Partial<MyChallenges> = {}): MyChallenges => ({
  tokens: TOKENS, sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [KARL_DAN, ADAM_NICK], ...over,
});

interface Scenario {
  my?: Partial<MyChallenges>;
  stats?: ReturnType<typeof stat>[];
}

function setup({ my: mine, stats = STATS }: Scenario = {}) {
  handlers.getMyChallenges = () => ({ success: true, data: my(mine) });
  handlers.getChallengeGroupStats = () => ({ success: true, data: stats });
  handlers.getChallengeProgress = (id: unknown) => ({
    success: true,
    data: {
      progress:
        id === 'c-kd' ? [{ user_id: KARL, value: 61.2 }, { user_id: DAN, value: 48 }]
        : id === 'c-an' ? [{ user_id: ADAM, value: 4 }, { user_id: NICK, value: 5 }]
        : [{ user_id: ME, value: 3 }, { user_id: ADAM, value: 2 }],
    },
  });
}

function renderDuels(entry = '/duels', width = MOBILE) {
  return renderWithApp(
    <Routes>
      <Route path="/duels" element={<DuelsPage />} />
      <Route path="/runner/:id" element={<div>runner</div>} />
    </Routes>,
    { entry, width },
  );
}

const primaryButtons = (container: HTMLElement) => [...container.querySelectorAll('.rq-btn--primary')].map((button) => button.textContent);

beforeEach(() => {
  resetFakeBackend();
  setup();
  handlers.getUsersWithRuns = () => ({
    success: true,
    data: Object.entries(NAMES).map(([id, name], index) => ({
      id, name, total_xp: 9000 - index * 1000, current_level: 20, total_km: 0, current_streak: 0, longest_streak: 0, runs: [],
    })),
  });
});

describe('Duels — rubrik och Live (mobil)', () => {
  it('rubrik "Challenges", räknarraden (live · tokens) och Live som förvald flik', async () => {
    renderDuels();
    expect(await screen.findByRole('heading', { name: 'Challenges', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('2 live · 5 tokens')).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Duels view' })).getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['Standings', 'false'], ['Live', 'true'], ['Rules', 'false'], ['History', 'false'],
    ]);
  });

  it('live-korten: ledaren till vänster, mått, längd, insats och vem som leder', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    const list = screen.getByRole('list', { name: 'Live duels' });
    const [first, second] = within(list).getAllByRole('listitem');

    // Slutar snart först: Adam–Nicklas (major, 7 d) före Karl–Daniel (legendary, 14 d)
    expect(within(first).getByText('Most runs')).toBeInTheDocument();
    expect(within(first).getByText('· 7 d')).toBeInTheDocument();
    expect(within(first).getAllByRole('button').map((button) => button.textContent)).toEqual(['Nicklas', 'Adam']);
    expect(within(first).getByText('+0.25× / 10 d')).toBeInTheDocument();
    expect(within(first).getByText('−0.12× / 10 d')).toBeInTheDocument();

    expect(within(second).getAllByRole('button').map((button) => button.textContent)).toEqual(['Karl', 'Daniel']);
    expect(within(second).getByText('61')).toBeInTheDocument();
    expect(within(second).getByText('+0.5× / 14 d')).toBeInTheDocument();
    expect(second).toHaveAttribute('data-tier', 'legendary');
  });

  it('min duell ligger först och mitt värde är markerat', async () => {
    setup({ my: { group_active: [KARL_DAN, MINE] } });
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    const [first] = within(screen.getByRole('list', { name: 'Live duels' })).getAllByRole('listitem');
    expect(first).toHaveAttribute('data-mine', 'true');
    expect(first.querySelector('.rq-duels-side[data-tone="mine"]')).not.toBeNull();
  });

  it('namnet öppnar Runner card', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Nicklas' }));
    expect(location()).toBe('/runner/u-nick');
  });

  it('inga live-dueller: streckat tomt läge med väg till send-sheeten', async () => {
    setup({ my: { group_active: [] } });
    renderDuels();
    expect(await screen.findByRole('heading', { name: 'No duels are live', level: 2 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Send a challenge' }));
    expect(location()).toBe('/duels?send=1');
  });

  it('tokens-panelen: en rad per nivå med sköld-antal och insats', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    const panel = screen.getByRole('region', { name: 'Your tokens' });
    const rows = within(panel).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      '3Minor+0.15× win · −0.07× lossSend',
      '1Major+0.25× win · −0.12× lossSend',
      '1Legendary+0.5× win · −0.25× lossSend',
    ]);
  });

  it('inga tokens: panelen säger hur man får dem', async () => {
    setup({ my: { tokens: [] } });
    renderDuels();
    await screen.findByText('2 live · 0 tokens');
    expect(within(screen.getByRole('region', { name: 'Your tokens' })).getByText('No tokens to send. You earn them by levelling up.')).toBeInTheDocument();
  });
});

describe('Duels — EN guldknapp per vy (designspråkets regel 3)', () => {
  it('ledig utan inkommande: Send är den enda guldknappen', async () => {
    const view = renderDuels();
    await screen.findByText('2 live · 5 tokens');
    expect(primaryButtons(view.container)).toEqual(['Send']);
  });

  it('en inkommande utmaning: Accept tar guldet och Send blir sekundär', async () => {
    setup({ my: { received_challenges: [FROM_NICK] } });
    const view = renderDuels();
    await screen.findByText('Waiting on you');
    expect(primaryButtons(view.container)).toEqual(['Accept']);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('rq-btn--secondary');
  });

  it('flera inkommande: bara den första Accept är guld', async () => {
    setup({ my: { received_challenges: [FROM_NICK, LEGENDARY_FROM_KARL] } });
    const view = renderDuels();
    await screen.findAllByText('Waiting on you');
    expect(primaryButtons(view.container)).toEqual(['Accept']);
  });

  it('i ett live-duell eller med en skickad väntande: ingen guldknapp alls (det finns inget att göra)', async () => {
    for (const scenario of [{ my: { group_active: [KARL_DAN, MINE] } }, { my: { sent_challenge: TO_DAN } }]) {
      setup(scenario);
      const view = renderDuels();
      await screen.findByRole('heading', { name: 'Challenges', level: 1 });
      expect(primaryButtons(view.container)).toEqual([]);
      view.unmount();
    }
  });
});

describe('Duels — EN guldknapp på desktop (samma regler som mobil)', () => {
  const scenarios: Array<[string, Scenario, string[]]> = [
    ['ledig: Send a challenge är guld', {}, ['Send a challenge']],
    ['inkommande: Accept är guld, Send a challenge sekundär', { my: { received_challenges: [FROM_NICK] } }, ['Accept']],
    ['flera inkommande: bara första Accept', { my: { received_challenges: [FROM_NICK, LEGENDARY_FROM_KARL] } }, ['Accept']],
    ['i ett live-duell: ingen', { my: { group_active: [KARL_DAN, MINE] } }, []],
    ['skickad väntande: ingen', { my: { sent_challenge: TO_DAN } }, []],
    ['inga tokens: ingen', { my: { tokens: [] } }, []],
    ['inga live-dueller (tomt läge): Send a challenge är guld', { my: { group_active: [] } }, ['Send a challenge']],
  ];

  it.each(scenarios)('desktop — %s', async (_name, scenario, expected) => {
    setup(scenario);
    const view = renderDuels('/duels', DESKTOP);
    await screen.findByText(/tokens unspent/);
    expect(primaryButtons(view.container)).toEqual(expected);
    const send = screen.getByRole('button', { name: 'Send a challenge' });
    expect(send.classList.contains('rq-btn--primary')).toBe(expected[0] === 'Send a challenge');
    if (expected[0] !== 'Send a challenge') expect(send).toHaveClass('rq-btn--secondary');
  });

  it.each([MOBILE, DESKTOP])('inga tokens och tomt läge på bredd %i: ingen guldknapp, Send sekundär', async (width) => {
    setup({ my: { tokens: [], group_active: [] } });
    const view = renderDuels('/duels', width);
    await screen.findByRole('heading', { name: 'No duels are live', level: 2 });
    expect(primaryButtons(view.container)).toEqual([]);
  });
});

describe('Duels — inkommande och skickad', () => {
  it('"Waiting on you": avsändare, mått och längd, insats, Accept och Decline', async () => {
    setup({ my: { received_challenges: [FROM_NICK] } });
    renderDuels();
    const card = (await screen.findByText('Waiting on you')).closest('li') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe('Nicklas · Most km · 7 d');
    expect(within(card).getByText('+0.25× / 10 d')).toBeInTheDocument();
    expect(within(card).getByText('−0.12× / 10 d')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^Accept challenge from/ })).toBeEnabled();
    expect(within(card).getByRole('button', { name: /^Decline challenge from/ })).toBeEnabled();
    expect(screen.getByText('2 live · 5 tokens')).toBeInTheDocument();
  });

  it('Accept skickar svaret, bekräftar på sidan och hämtar om', async () => {
    const calls: unknown[][] = [];
    setup({ my: { received_challenges: [FROM_NICK] } });
    handlers.respondToChallenge = (...args: unknown[]) => { calls.push(args); return { success: true }; };
    renderDuels();
    fireEvent.click(await screen.findByRole('button', { name: /^Accept challenge from/ }));
    expect(await screen.findByText('Challenge accepted. It starts tomorrow.')).toBeInTheDocument();
    // live-regionen är en permanent behållare som texten monteras i
    expect(screen.getByRole('status')).toHaveTextContent('Challenge accepted. It starts tomorrow.');
    expect(calls).toEqual([['c-in', 'accept']]);
  });

  it('Decline skickar "decline"', async () => {
    const calls: unknown[][] = [];
    setup({ my: { received_challenges: [FROM_NICK] } });
    handlers.respondToChallenge = (...args: unknown[]) => { calls.push(args); return { success: true }; };
    renderDuels();
    fireEvent.click(await screen.findByRole('button', { name: /^Decline challenge from/ }));
    expect(await screen.findByText('Challenge declined.')).toBeInTheDocument();
    expect(calls).toEqual([['c-in', 'decline']]);
  });

  it('ett serverfel visas som felmeddelande på sidan, med serverns text', async () => {
    setup({ my: { received_challenges: [FROM_NICK] } });
    handlers.respondToChallenge = () => ({ success: false, error: 'Challenge not found or already responded' });
    renderDuels();
    fireEvent.click(await screen.findByRole('button', { name: /^Accept challenge from/ }));
    expect(await screen.findByText('Challenge not found or already responded')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Challenge not found or already responded');
  });

  it('legendary kan inte avböjas: ingen Decline, och när den startar av sig själv står där', async () => {
    setup({ my: { received_challenges: [LEGENDARY_FROM_KARL] } });
    renderDuels();
    const card = (await screen.findByText('Waiting on you')).closest('li') as HTMLElement;
    expect(within(card).queryByRole('button', { name: /^Decline challenge from/ })).toBeNull();
    expect(within(card).getByText(/Auto-starts in 3 d \d+ h — it cannot be declined\./)).toBeInTheDocument();
  });

  it('i ett live-duell väntar Accept (spelet tillåter en utmaning i taget)', async () => {
    setup({ my: { group_active: [KARL_DAN, MINE], received_challenges: [FROM_NICK] } });
    renderDuels();
    const accept = await screen.findByRole('button', { name: /^Accept challenge from/ });
    expect(accept).toBeDisabled();
    expect(screen.getByText('Finish your live duel before you accept another.')).toBeInTheDocument();
  });

  it('min skickade utmaning: "Sent", vem som svarar, Withdraw dra tillbaka', async () => {
    const calls: unknown[][] = [];
    setup({ my: { sent_challenge: TO_DAN } });
    handlers.withdrawChallenge = (...args: unknown[]) => { calls.push(args); return { success: true }; };
    renderDuels();
    const card = (await screen.findByText('Sent')).closest('li') as HTMLElement;
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe('Daniel · Most runs · 5 d');
    expect(within(card).getByText('Waiting for Daniel to respond')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Challenge withdrawn. Your token is back.')).toBeInTheDocument();
    expect(calls).toEqual([['c-out']]);
  });

  it('en skickad legendary kan inte dras tillbaka', async () => {
    setup({ my: { sent_challenge: { ...TO_DAN, tier: 'legendary' } } });
    renderDuels();
    await screen.findByText('Sent');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(screen.getByText('A legendary challenge cannot be withdrawn.')).toBeInTheDocument();
  });
});

describe('Duels — delvyer över ?view=', () => {
  it('Standings: sorterat på poäng, min rad markerad, rank 1–3 färgsatta; flik byter adress', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    fireEvent.click(screen.getByRole('tab', { name: 'Standings' }));
    expect(location()).toBe('/duels?view=standings');
    const table = screen.getByRole('table', { name: 'Challenge standings' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual([
      'Karl Persson', 'Nicklas von Elling', 'Joel Lindberg', 'Adam Einstein', 'Daniel Lindblad Lüthje',
    ]);
    expect(rows[2]).toHaveAttribute('data-mine', 'true');
    expect(rows.map((row) => row.getAttribute('data-rank'))).toEqual(['1', '2', '3', null, null]);
    expect(within(rows[4]).getAllByRole('cell')[5].textContent).toBe('—');
  });

  it('Standings: ett klick på raden öppnar Runner card', async () => {
    renderDuels('/duels?view=standings');
    const table = await screen.findByRole('table', { name: 'Challenge standings' });
    fireEvent.click(within(table).getByRole('button', { name: 'Adam Einstein' }));
    expect(location()).toBe('/runner/u-adam');
  });

  it('Rules: ett kort per nivå med insatsen ur verkliga tokens, och "How it works"', async () => {
    renderDuels('/duels?view=rules');
    const tiers = await screen.findByRole('list', { name: 'Challenge tiers' });
    const cards = within(tiers).getAllByRole('listitem');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 2 }).textContent)).toEqual(['Minor', 'Major', 'Legendary']);
    expect(within(cards[0]).getByText('+0.15× / 5 d')).toBeInTheDocument();
    expect(within(cards[2]).getByText('−0.25× / 14 d')).toBeInTheDocument();
    expect(within(cards[2]).getByText(/can't be declined/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
  });

  it('okänd ?view= faller tillbaka på Live', async () => {
    renderDuels('/duels?view=hopp');
    await screen.findByText('2 live · 5 tokens');
    expect(screen.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Duels — Match history (hela packet)', () => {
  const pageOf = (items: ReturnType<typeof historyItem>[], hasMore: boolean) => ({
    success: true, data: { items }, meta: { total: 0, limit: 20, offset: 0, has_more: hasMore },
  });
  const MINE_WON = historyItem({ id: 'h1' });
  const OTHERS = historyItem({
    id: 'h2', tier: 'minor', metric: 'total_xp', duration_days: 3, outcome: 'opponent_wins', winner_id: KARL,
    challenger: { id: NICK, name: NAMES[NICK], profile_picture: null, level: 23 },
    opponent: { id: KARL, name: NAMES[KARL], profile_picture: null, level: 24 },
    challenger_value: 171, opponent_value: 204, winner_boost: { type: 'multiplier_days', delta: 0.15, duration: 5 },
  });

  it('rader med båda sidorna, resultat och poäng; mina matcher har prick', async () => {
    handlers.getChallengeGroupHistory = () => pageOf([MINE_WON, OTHERS], false);
    renderDuels('/duels?view=history');
    const list = await screen.findByRole('list', { name: 'Matches' });
    const [mine, others] = within(list).getAllByRole('listitem');
    expect(mine.textContent).toContain('Joel Lindberg');
    expect(mine.textContent).toContain('Win');
    expect(within(mine).getByRole('img', { name: 'You' })).toBeInTheDocument();
    expect(others.textContent).toContain('204');
    expect(within(others).queryByRole('img', { name: 'You' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('"Whole pack" ↔ "My matches" filtrerar till mina', async () => {
    handlers.getChallengeGroupHistory = () => pageOf([MINE_WON, OTHERS], false);
    renderDuels('/duels?view=history');
    const toggle = await screen.findByRole('button', { name: 'Whole pack' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'My matches' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('"Show more" hämtar nästa sida (offset) och försvinner när det inte finns fler', async () => {
    const calls: unknown[][] = [];
    handlers.getChallengeGroupHistory = (...args: unknown[]) => {
      calls.push(args);
      return args[1] === 0 ? pageOf([MINE_WON], true) : pageOf([OTHERS], false);
    };
    renderDuels('/duels?view=history');
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('listitem')).toHaveLength(2));
    expect(calls).toEqual([[20, 0], [20, 1]]);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('tom historik: säger det', async () => {
    handlers.getChallengeGroupHistory = () => pageOf([], false);
    renderDuels('/duels?view=history');
    expect(await screen.findByText('No duels have been settled yet.')).toBeInTheDocument();
  });

  it('fel: felkort med Retry — inte "ingen historik" — och Retry hämtar om', async () => {
    let fail = true;
    handlers.getChallengeGroupHistory = () => (fail ? { success: false, error: 'down' } : pageOf([MINE_WON], false));
    renderDuels('/duels?view=history');
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText("Couldn't load the match history")).toBeInTheDocument();
    expect(screen.queryByText('No duels have been settled yet.')).toBeNull();

    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Joel Lindberg' })).toBeInTheDocument();
  });

  it('historiken hämtas först när fliken visas', async () => {
    const calls: unknown[][] = [];
    handlers.getChallengeGroupHistory = (...args: unknown[]) => { calls.push(args); return pageOf([], false); };
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    expect(calls).toEqual([]);
  });
});

describe('Duels — send-sheeten (?send=1&opponent=)', () => {
  const sheet = () => screen.getByRole('dialog', { name: 'Send a challenge' });
  const option = (name: string) => within(sheet()).getByRole('button', { name: new RegExp(name) });

  it('?send=1 öppnar sheeten med token- och motståndarval; utan förval är inget vald motståndare', async () => {
    renderDuels('/duels?send=1');
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    // Ett token per nivå/mått/längd, första raden förvald
    const tokenGroup = within(sheet()).getByRole('group', { name: '1 · Spend a token' });
    expect(within(tokenGroup).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '2Minor' + 'Most km · 7 days' + '+0.15× / 5 d' + '−0.07× / 5 d',
      '1Minor' + 'Most runs · 5 days' + '+0.15× / 5 d' + '−0.07× / 5 d',
      '1Major' + 'Most km · 10 days' + '+0.25× / 10 d' + '−0.12× / 10 d',
      '1Legendary' + 'Most XP · 21 days' + '+0.5× / 14 d' + '−0.25× / 14 d',
    ]);
    expect(within(tokenGroup).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet()).getByRole('button', { name: 'Send challenge' })).toBeDisabled();
  });

  it('opponent förväljs; upptagna medlemmar är avstängda med orsak', async () => {
    renderDuels(`/duels?send=1&opponent=${KARL}`);
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    // Karl är i ett live-duell i basscenariot → inte valbar; byt till en fri motståndare
    expect(option('Karl Persson')).toBeDisabled();
    expect(within(option('Karl Persson')).getByText('In a duel')).toBeInTheDocument();
    expect(within(sheet()).getByRole('button', { name: 'Send challenge' })).toBeDisabled();
  });

  it('en fri motståndare ur ?opponent= är vald; "The bet" sammanfattar mått, motståndare och längd', async () => {
    setup({ stats: STATS.map((s) => (s.user_id === DAN ? { ...s, challenge_active: false } : s)), my: { group_active: [ADAM_NICK] } });
    renderDuels(`/duels?send=1&opponent=${DAN}`);
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(option('Daniel Lindblad')).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet()).getByText('Most km vs Daniel · 7 days')).toBeInTheDocument();
    expect(within(sheet()).getByRole('button', { name: 'Send challenge' })).toBeEnabled();
  });

  it('ogiltig ?opponent= (jag själv, okänd) förväljer ingen', async () => {
    for (const bad of [ME, 'u-not-in-the-pack']) {
      const view = renderDuels(`/duels?send=1&opponent=${bad}`);
      await screen.findByRole('dialog', { name: 'Send a challenge' });
      expect(within(sheet()).getByRole('button', { name: 'Send challenge' })).toBeDisabled();
      expect(within(sheet()).queryAllByRole('button', { pressed: true })).toHaveLength(1); // bara tokenet
      view.unmount();
    }
  });

  it('head-to-head per motståndare ur mitt perspektiv', async () => {
    setup({ stats: STATS.map((s) => ({ ...s, challenge_active: false })), my: { group_active: [] } });
    const records: Record<string, { wins: number; draws: number; losses: number; total: number }> = {
      [KARL]: { wins: 2, draws: 0, losses: 0, total: 2 },
      [NICK]: { wins: 0, draws: 0, losses: 1, total: 1 },
      [DAN]: { wins: 0, draws: 1, losses: 0, total: 1 },
    };
    handlers.getHeadToHead = (id: unknown) => ({
      success: true,
      data: { opponent: { id, name: '', profile_picture: null }, record: records[id as string] ?? { wins: 0, draws: 0, losses: 0, total: 0 }, history: [], active: null },
    });
    renderDuels('/duels?send=1');
    expect(await within(await screen.findByRole('dialog')).findByText('2–0 to you')).toBeInTheDocument();
    expect(within(sheet()).getByText('0–1 to Nicklas')).toBeInTheDocument();
    expect(within(sheet()).getByText('drawn 1')).toBeInTheDocument();
    expect(within(sheet()).getByText('never met')).toBeInTheDocument();
  });

  it('skickar valt token och vald motståndare, bekräftar på sidan och stänger sheeten', async () => {
    const calls: unknown[][] = [];
    setup({ stats: STATS.map((s) => ({ ...s, challenge_active: false })), my: { group_active: [] } });
    handlers.sendChallenge = (...args: unknown[]) => { calls.push(args); return { success: true, data: { challenge_id: 'new' } }; };
    renderDuels('/duels?view=live&send=1');
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    fireEvent.click(within(sheet()).getByRole('button', { name: /Major/ }));
    fireEvent.click(option('Adam Einstein'));
    expect(within(sheet()).getByText('Most km vs Adam · 10 days')).toBeInTheDocument();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));

    expect(await screen.findByText('Challenge sent to Adam. It starts when they accept.')).toBeInTheDocument();
    expect(calls).toEqual([['t-major', ADAM]]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(location()).toBe('/duels?view=live');
  });

  it('serverfel (motståndaren upptagen) visas i sheeten, som stannar kvar', async () => {
    setup({ stats: STATS.map((s) => ({ ...s, challenge_active: false })), my: { group_active: [] } });
    handlers.sendChallenge = () => ({ success: false, error: 'Opponent already has an active or pending challenge' });
    renderDuels(`/duels?send=1&opponent=${ADAM}`);
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(within(sheet()).getByRole('alert')).toHaveTextContent('Opponent already has an active or pending challenge'));
    expect(within(sheet()).getByRole('button', { name: 'Send challenge' })).toBeEnabled();
  });

  it('Send på en nivå i tokens-panelen öppnar sheeten med nivån förvald', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    fireEvent.click(screen.getByRole('button', { name: 'Send a major challenge' }));
    expect(location()).toBe('/duels?send=1');
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(within(sheet()).getByRole('button', { name: /Major/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('✕ stänger och tar bort send/opponent ur adressen men behåller ?view=', async () => {
    renderDuels(`/duels?view=rules&send=1&opponent=${ADAM}`);
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels?view=rules');
  });

  it('header-knappen öppnar sheeten (med en ny historikpost)', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(location()).toBe('/duels?send=1');
    expect(await screen.findByRole('dialog', { name: 'Send a challenge' })).toBeInTheDocument();
  });

  it('kan inte skicka med en inkommande utmaning: sheeten förklarar varför och har ingen Send', async () => {
    setup({ my: { received_challenges: [FROM_NICK] } });
    renderDuels('/duels?send=1');
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(within(sheet()).getByRole('status')).toHaveTextContent('A challenge is waiting on you. Answer it before you send one of your own.');
    expect(within(sheet()).queryByRole('button', { name: 'Send challenge' })).toBeNull();
  });

  it('kan inte skicka i ett live-duell, med en skickad väntande eller utan tokens', async () => {
    const cases: Array<[Scenario, RegExp]> = [
      [{ my: { group_active: [MINE] } }, /You are in a live duel/],
      [{ my: { sent_challenge: TO_DAN } }, /Your challenge to Daniel is waiting for an answer/],
      [{ my: { tokens: [] } }, /You have no tokens to send/],
    ];
    for (const [scenario, message] of cases) {
      setup(scenario);
      const view = renderDuels('/duels?send=1');
      await screen.findByRole('dialog', { name: 'Send a challenge' });
      expect(within(sheet()).getByRole('status')).toHaveTextContent(message);
      view.unmount();
    }
  });

  it('tokens-panelens Send är låst medan det inte går att skicka, med orsaken under listan', async () => {
    setup({ my: { sent_challenge: TO_DAN } });
    renderDuels();
    await screen.findByText('Sent');
    const panel = screen.getByRole('region', { name: 'Your tokens' });
    for (const button of within(panel).getAllByRole('button')) expect(button).toBeDisabled();
    expect(within(panel).getByText(/Your challenge to Daniel is waiting for an answer/)).toBeInTheDocument();
  });

  it('Escape stänger sheeten, fokus ligger i dialogen medan den är öppen, och adressen städas', async () => {
    renderDuels(`/duels?view=rules&send=1&opponent=${ADAM}`);
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(sheet().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels?view=rules');
  });

  it('med sheeten öppen finns två guldknappar i DOM (sidans Send och sheetens Send challenge) — OK eftersom sheeten är modal', async () => {
    setup({ stats: STATS.map((s) => ({ ...s, challenge_active: false })), my: { group_active: [] } });
    const view = renderDuels('/duels?send=1');
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    // Modalen gör resten av sidan inert (aria-hidden): bara EN guldknapp är nåbar åt gången.
    expect(primaryButtons(view.container)).toEqual(['Send']);
    expect(within(sheet()).getAllByRole('button').filter((button) => button.classList.contains('rq-btn--primary')).map((b) => b.textContent)).toEqual(['Send challenge']);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull(); // sidans knapp är dold för hjälpmedel
  });

  it('en förvald nivå från tokens-panelen följer inte med in i ett senare ?send=1 (t.ex. djuplänk från Runner card)', async () => {
    renderWithApp(
      <Routes>
        <Route path="/duels" element={<><DuelsPage /><Link to="/duels?send=1">deep link</Link></>} />
      </Routes>,
      { entry: '/duels', width: MOBILE },
    );
    await screen.findByText('2 live · 5 tokens');
    fireEvent.click(screen.getByRole('button', { name: 'Send a major challenge' }));
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(within(sheet()).getByRole('button', { name: /Major/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('link', { name: 'deep link' }));
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(within(sheet()).getByRole('button', { name: /Minor.*Most km/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet()).getByRole('button', { name: /Major/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('desktop: samma sheet som en centrerad dialog med Cancel', async () => {
    renderDuels('/duels?send=1', DESKTOP);
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(within(sheet()).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

describe('Duels — boost och rekord', () => {
  it('"Boost active" med bakgrund ur min historik; straff läses "Penalty active"', async () => {
    setup({
      my: {
        history: [challenge({ id: 'c-old', challenger_id: ME, opponent_id: ADAM, metric: 'runs', duration_days: 5, status: 'completed' })],
        boosts: [
          { id: 'b1', user_id: ME, challenge_id: 'c-old', outcome: 'winner', type: 'multiplier_days', delta: 0.25, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3.5 * 86_400_000).toISOString() },
          { id: 'b2', user_id: ME, challenge_id: 'c-gone', outcome: 'loser', type: 'multiplier_days', delta: -0.07, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1.2 * 86_400_000).toISOString() },
        ],
      },
    });
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    const boosts = within(screen.getByRole('list', { name: 'Active boosts' })).getAllByRole('listitem');
    expect(boosts[0].textContent).toBe('Boost active+0.25× for 4 daysWon against Adam · most runs · 5 d');
    expect(boosts[1].textContent).toBe('Penalty active−0.07× for 2 days');
  });

  it('desktop: "Your record" i sidokolumnen (mobil har den inte)', async () => {
    const mobile = renderDuels();
    await screen.findByText('2 live · 5 tokens');
    expect(screen.queryByRole('region', { name: 'Your record' })).toBeNull();
    mobile.unmount();

    renderDuels('/duels', DESKTOP);
    const record = await screen.findByRole('region', { name: 'Your record' });
    expect(within(record).getAllByRole('term').map((term) => term.textContent)).toEqual(['won', 'drawn', 'lost', 'win rate']);
    expect(within(record).getByText('67%')).toBeInTheDocument();
  });
});

describe('Duels — desktop', () => {
  it('rubrik med desktop-räknaren, flikarna och "Send a challenge" i rubrikraden', async () => {
    renderDuels('/duels', DESKTOP);
    expect(await screen.findByText('2 live · 5 tokens unspent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a challenge' })).toHaveClass('rq-btn--primary');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('"waiting on you" i räknaren när något väntar', async () => {
    setup({ my: { received_challenges: [FROM_NICK] } });
    renderDuels('/duels', DESKTOP);
    expect(await screen.findByText('2 live · 1 waiting on you · 5 tokens unspent')).toBeInTheDocument();
  });

  it('Standings har titelraden "Challenge leaderboard · All time"', async () => {
    renderDuels('/duels?view=standings', DESKTOP);
    expect(await screen.findByRole('heading', { name: 'Challenge leaderboard', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('All time')).toBeInTheDocument();
  });

  it('exakt en guldknapp även på desktop', async () => {
    const view = renderDuels('/duels', DESKTOP);
    await screen.findByText(/tokens unspent/);
    expect(primaryButtons(view.container)).toEqual(['Send a challenge']);
  });
});

describe('Duels — laddning, fel och tur (regel 9)', () => {
  it('skeleton-rader medan utmaningarna hämtas, och ingen tur än', async () => {
    handlers.getMyChallenges = () => new Promise(() => {});
    renderDuels();
    expect(await screen.findByText('Loading duels')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-tour')).toBeNull();
  });

  it('fel: felkort med Retry — inte tomma listor — och Retry hämtar om', async () => {
    let fail = true;
    handlers.getMyChallenges = () => (fail ? { success: false, error: 'down' } : { success: true, data: my() });
    renderDuels();
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByText("Couldn't load the duels")).toBeInTheDocument();
    expect(screen.queryByText('No duels are live')).toBeNull();

    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('2 live · 5 tokens')).toBeInTheDocument();
  });

  it('turen är tour_duels_v2 och varje ankare finns i sidan', async () => {
    renderDuels();
    await screen.findByText('2 live · 5 tokens');
    expect(screen.getByTestId('feature-tour')).toHaveAttribute('data-slug', 'tour_duels_v2');
    const anchors = TOUR_DUELS_V2.flatMap((step) => (step.element ? [step.element] : []));
    expect(anchors).toHaveLength(3);
    for (const selector of anchors) expect(document.querySelector(selector), selector).not.toBeNull();
  });

  it('inga ankare tappas på desktop heller', async () => {
    renderDuels('/duels', DESKTOP);
    await screen.findByText(/tokens unspent/);
    for (const step of TOUR_DUELS_V2) if (step.element) expect(document.querySelector(step.element), step.element).not.toBeNull();
  });
});

describe('Duels — Match history: mobil och desktop läser metan olika', () => {
  const page = { success: true, data: { items: [historyItem({ id: 'h1' })] }, meta: { total: 1, limit: 20, offset: 0, has_more: false } };

  it('mobil: "Nivå · mått · längd" på en rad, ingen belöningsrad', async () => {
    handlers.getChallengeGroupHistory = () => page;
    renderDuels('/duels?view=history');
    const row = (await screen.findByRole('list', { name: 'Matches' })).querySelector('li') as HTMLElement;
    expect(within(row).getByText('Major · Most runs · 5 d')).toBeInTheDocument();
    expect(within(row).queryByText(/\+0\.25×/)).toBeNull();
    expect(within(row).getByText('21 Aug')).toBeInTheDocument();
  });

  it('desktop: vinnarens boost som andra raden ("5 d · +0.25× / 10 d")', async () => {
    handlers.getChallengeGroupHistory = () => page;
    renderDuels('/duels?view=history', DESKTOP);
    const row = (await screen.findByRole('list', { name: 'Matches' })).querySelector('li') as HTMLElement;
    expect(within(row).getByText('Major · Most runs')).toBeInTheDocument();
    expect(within(row).getByText('5 d · +0.25× / 10 d')).toBeInTheDocument();
  });
});
