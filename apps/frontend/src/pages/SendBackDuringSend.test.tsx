import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNavigate } from 'react-router-dom';
import type { MyChallengesData } from '@runquest/shared';
import { AppRoutes } from '@/routes';
import { stat, token } from '@/features/challenges/duels.fixture';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { resetHistoryIdx } from '@/test/resetHistoryIdx';
import { renderWithApp } from '@/test/renderApp';
import { warmRunnerPopup } from '@/test/warmLazy';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// Webbläsarens Back medan ett skick pågår: send-arket låser Cancel, ✕, Esc och skrimman under skicket, men Back avmonterar det ändå. Då ska fokus hamna rätt, inget lås ligga kvar,
// och utfallet synas där användaren står: skicket får inte flytta hen, och svaret ska inte bli en dubbel bekräftelse.

beforeAll(warmRunnerPopup);

const DESKTOP = 1280;
const KARL = OTHER.id;
const BOARD = '/board?view=week';
const DUELS_LIVE = '/duels?view=live';
const background = (pathname: string, search: string) => ({ pathname, search, hash: '', state: null, key: 'bg' });
const popupOver = (pathname: string, search: string) => [`${pathname}${search}`, { pathname: `/runner/${KARL}`, state: { background: background(pathname, search) } }];

const REFUSED = 'Opponent already has a pending challenge';
const UNCONFIRMED = /couldn.t confirm that your challenge was sent/i;
const SENT = /Challenge sent to Karl/;

const mine = (over: Partial<MyChallengesData> = {}): MyChallengesData => ({
  tokens: [token({ id: 't1' })], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [], ...over,
});

type SendReply = { success: true; data: { challenge_id: string } } | { success: false; error: string; reason?: 'timeout' | 'network' };
/** Svaret på skicket, som provet släpper när det vill: Back kommer medan svaret är på väg. */
function heldSend() {
  let release: (reply: SendReply) => void = () => {};
  const reply = new Promise<SendReply>((resolve) => { release = resolve; });
  const calls: unknown[][] = [];
  handlers.sendChallenge = (...args: unknown[]) => { calls.push(args); return reply; };
  return { calls, answer: (value: SendReply) => act(async () => { release(value); await reply; }) };
}

let myFetches = 0;

beforeEach(() => {
  resetFakeBackend();
  myFetches = 0;
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({
    success: true,
    data: { opponent: { id: KARL, name: OTHER.name, profile_picture: null }, record: { wins: 0, draws: 0, losses: 0, total: 0 }, history: [], active: null },
  });
  handlers.getMyChallenges = () => { myFetches += 1; return { success: true, data: mine() }; };
  handlers.getChallengeGroupStats = () => ({ success: true, data: [stat(ME.id), stat(KARL)] });
});

afterEach(() => { resetHistoryIdx(); });

const location = () => screen.getByTestId('location').textContent;
const sheet = () => screen.getByRole('dialog', { name: 'Send a challenge' });
const karlRow = () => {
  const row = document.querySelector<HTMLElement>(`main [data-runner-id="${KARL}"]`);
  if (!row) throw new Error('no runner row for Karl in the page');
  return row;
};

/** Ger en Back-knapp: webbläsarens Back är ett steg bakåt i historiken. */
function BackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => void navigate(-1)}>Browser back</button>;
}
const browserBack = () => fireEvent.click(screen.getByText('Browser back'));

/** Allt en dialog lämnar efter sig på sidan när den stängs: skrollås, `aria-hidden` och `inert` på appen, och en body som inte tar emot tryck. */
const lockLeft = () => ({
  scrollLocked: document.body.hasAttribute('data-scroll-locked'),
  pointerEvents: document.body.style.pointerEvents,
  inert: document.querySelectorAll('[inert]').length,
  hiddenBodyChildren: Array.from(document.body.children).filter((child) => child.getAttribute('aria-hidden') === 'true').length,
});
const NO_LOCK = { scrollLocked: false, pointerEvents: '', inert: 0, hiddenBodyChildren: 0 };

/** Popupen över bakgrundssidan, Challenge in i send-arket och Send; skicket hålls. */
async function sendFromPopup(entry: unknown[]) {
  const held = heldSend();
  renderWithApp(<><AppRoutes /><BackButton /></>, { entry: entry as never, width: DESKTOP, history: true });
  const dialog = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });
  fireEvent.click(await within(dialog).findByRole('link', { name: 'Challenge' }));
  await screen.findByRole('dialog', { name: 'Send a challenge' });
  fireEvent.click(await within(sheet()).findByRole('button', { name: 'Send challenge' }));
  expect(await within(sheet()).findByRole('button', { name: 'Sending…' })).toBeDisabled();
  await waitFor(() => expect(held.calls).toHaveLength(1));
  return held;
}

/** Duels, rubrikens Send och Send; skicket hålls. Posten före är samma sida, så Back stannar på Duels. */
async function sendFromDuels() {
  const held = heldSend();
  renderWithApp(<><AppRoutes /><BackButton /></>, { entry: [DUELS_LIVE], width: DESKTOP, history: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Send a challenge' }));
  await screen.findByRole('dialog', { name: 'Send a challenge' });
  await user.click(await within(sheet()).findByRole('radio', { name: /Karl Persson/ }));
  await user.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));
  expect(await within(sheet()).findByRole('button', { name: 'Sending…' })).toBeDisabled();
  await waitFor(() => expect(held.calls).toHaveLength(1));
  return held;
}

describe('Back while a challenge is being sent from the runner popup', () => {
  it('lands on the page under the popup with the focus on the runner row and no lock left behind', async () => {
    await sendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);

    browserBack();

    await waitFor(() => expect(location()).toBe(BOARD));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(karlRow()).toHaveFocus());
    expect(document.body).not.toHaveFocus();
    expect(lockLeft()).toEqual(NO_LOCK);
  });

  it('an answer that comes after Back leaves the user on the page and does not take the focus', async () => {
    const held = await sendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);
    browserBack();
    await waitFor(() => expect(location()).toBe(BOARD));
    const fetchesBefore = myFetches;

    await held.answer({ success: true, data: { challenge_id: 'new' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

    expect(location()).toBe(BOARD);
    await waitFor(() => expect(karlRow()).toHaveFocus());
    // Utmaningen finns nu: skalets "mina utmaningar" hämtas om (mutationen invaliderar även när skärmen är borta), så att den syns utan omladdning.
    await waitFor(() => expect(myFetches).toBeGreaterThan(fetchesBefore));
    expect(screen.queryByText(SENT)).toBeNull();
    expect(held.calls, 'one send').toHaveLength(1);
  });

  it('a send that gets no answer in time leaves the user on the page too', async () => {
    const held = await sendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);
    browserBack();
    await waitFor(() => expect(location()).toBe(BOARD));

    await held.answer({ success: false, error: 'Request timed out', reason: 'timeout' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

    expect(location()).toBe(BOARD);
    expect(karlRow()).toHaveFocus();
    expect(lockLeft()).toEqual(NO_LOCK);
  });
});

describe('Back while a challenge is being sent on /duels', () => {
  it('keeps the user on duels with the focus on the page and shows the confirmation once when the answer comes', async () => {
    const held = await sendFromDuels();

    browserBack();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.body).not.toHaveFocus());
    expect(lockLeft()).toEqual(NO_LOCK);
    const fetchesBefore = myFetches;

    await held.answer({ success: true, data: { challenge_id: 'new' } });

    expect(await screen.findByText(SENT)).toBeInTheDocument();
    expect(screen.getAllByText(SENT)).toHaveLength(1);
    expect(location()).toBe(DUELS_LIVE);
    await waitFor(() => expect(myFetches).toBeGreaterThan(fetchesBefore));
    expect(held.calls, 'one send').toHaveLength(1);
  });

  it('shows the refusal as the notice on the page when the sheet is gone', async () => {
    const held = await sendFromDuels();
    browserBack();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await held.answer({ success: false, error: REFUSED });

    const notice = await screen.findByText(REFUSED);
    expect(notice).toHaveAttribute('data-tone', 'error');
    expect(location()).toBe(DUELS_LIVE);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the honest text as the notice and fetches the lists again when the send got no answer in time', async () => {
    const held = await sendFromDuels();
    browserBack();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const fetchesBefore = myFetches;

    await held.answer({ success: false, error: 'Request timed out', reason: 'timeout' });

    const notice = await screen.findByText(UNCONFIRMED);
    expect(notice).toHaveAttribute('data-tone', 'error');
    await waitFor(() => expect(myFetches).toBeGreaterThan(fetchesBefore));
    expect(location()).toBe(DUELS_LIVE);
  });

  it('an answer for a closed sheet is a notice, not a close or an error in a sheet that was opened afterwards', async () => {
    const held = await sendFromDuels();
    browserBack();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send a challenge' }));
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    await held.answer({ success: false, error: REFUSED });

    expect(await screen.findByText(REFUSED)).toHaveAttribute('data-tone', 'error');
    expect(within(sheet()).queryByRole('alert')).toHaveTextContent('');
    expect(sheet()).toBeInTheDocument();
  });
});
