import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryCache } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { MyChallengesData } from '@runquest/shared';
import { AppRoutes } from '@/routes';
import { challenge, stat, token } from '@/features/challenges/duels.fixture';
import { historyIdx } from '@/shared/utils/historyIdx';
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

afterEach(() => {
  resetHistoryIdx();
  vi.restoreAllMocks();
});

const location = () => screen.getByTestId('location').textContent;
const sheet = () => screen.getByRole('dialog', { name: 'Send a challenge' });
const karlRow = () => {
  const row = document.querySelector<HTMLElement>(`main [data-runner-id="${KARL}"]`);
  if (!row) throw new Error('no runner row for Karl in the page');
  return row;
};

/** Ger en Back-knapp (webbläsarens Back är ett steg bakåt i historiken) och en knapp som går vidare till en annan sida som också listar löparen. */
function BackButton() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void navigate(-1)}>Browser back</button>
      <button type="button" onClick={() => void navigate('/duels?view=standings')}>Go to standings</button>
      <button type="button" onClick={() => void navigate('/titles')}>Go to titles</button>
    </>
  );
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
    await waitFor(() => expect(karlRow()).toHaveFocus());
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

/** Räknar fokusanrop på löparens rader, och släpper igenom dem. */
function countRowFocusCalls() {
  const original = HTMLElement.prototype.focus;
  let calls = 0;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function focus(this: HTMLElement, options?: FocusOptions) {
    if (this.getAttribute('data-runner-id') === KARL) calls += 1;
    return original.call(this, options);
  });
  return () => calls;
}

/** Gruppens löpare som provet släpper när det vill: sidan under popupen har då ingen rad när Back kommer, och sökningen efter raden är igång. */
function heldUsers() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  handlers.getUsersWithRuns = async () => { await gate; return { success: true, data: [ME, OTHER] }; };
  return release;
}

describe('the focus after a refused send', () => {
  it('a refused send followed by Cancel gives the runner row exactly one focus', async () => {
    const rowFocusCalls = countRowFocusCalls();
    const held = await sendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);
    await held.answer({ success: false, error: REFUSED });
    expect(await within(sheet()).findByText(REFUSED)).toBeInTheDocument();

    await userEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(location()).toBe(BOARD));
    await waitFor(() => expect(karlRow()).toHaveFocus());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(rowFocusCalls()).toBe(1);
  });
});

describe('the search for the runner row after Back is dropped when the user moves on', () => {
  it('Back under a send and then straight on to another page that lists the runner does not move the focus there', async () => {
    const held = await sendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);
    heldUsers();
    browserBack();
    await waitFor(() => expect(location()).toBe(BOARD));
    expect(document.querySelector(`main [data-runner-id="${KARL}"]`)).toBeNull();

    fireEvent.click(screen.getByText('Go to standings'));
    await waitFor(() => expect(location()).toBe('/duels?view=standings'));
    await waitFor(() => expect(karlRow()).toBeInTheDocument());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)); });

    expect(karlRow()).not.toHaveFocus();
    expect(held.calls, 'one send').toHaveLength(1);
  });

  it('Back under a send and then a focus move by the user: the row is not given the focus when it turns up', async () => {
    await sendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);
    const releaseUsers = heldUsers();
    browserBack();
    await waitFor(() => expect(location()).toBe(BOARD));
    const elsewhere = screen.getByText('Go to standings');
    act(() => elsewhere.focus());

    releaseUsers();
    await waitFor(() => expect(karlRow()).toBeInTheDocument());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

    expect(karlRow()).not.toHaveFocus();
    expect(elsewhere).toHaveFocus();
  });
});

// Back när inget skick pågår (arket är vilande, ett skick har avvisats eller tidsgränsen har gått): Cancel, ✕, Esc och skrim går genom avbrytvägen, men Back gör det inte. Arket
// avmonteras utan att `onClose` körs, och skalet vet inget om löparen: fokus ska ändå hamna där Cancel hade lagt det.
const POPUP_ENTRY = () => ['/titles', ...popupOver('/board', '?view=week')];
/** Platsen på bakgrundssidan i historiken: popupen och send-arket ersätter varandra, så Back och Cancel landar på samma post. */
const BOARD_IDX = 1;

/** Popupen över Board och Challenge in i send-arket, utan att något har skickats. */
async function openSheetFromPopup() {
  const held = heldSend();
  renderWithApp(<><AppRoutes /><BackButton /></>, { entry: POPUP_ENTRY() as never, width: DESKTOP, history: true });
  const dialog = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });
  fireEvent.click(await within(dialog).findByRole('link', { name: 'Challenge' }));
  await screen.findByRole('dialog', { name: 'Send a challenge' });
  return held;
}

async function landOnBoardAfterBack() {
  browserBack();
  await waitFor(() => expect(location()).toBe(BOARD));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(karlRow()).toHaveFocus());
  expect(document.body).not.toHaveFocus();
  expect(lockLeft()).toEqual(NO_LOCK);
  expect(historyIdx()).toBe(BOARD_IDX);
}

describe('Back from the send sheet opened by the runner popup when no send is in flight', () => {
  it('an idle sheet: Back gives the runner row the focus, with the same history as Cancel', async () => {
    await openSheetFromPopup();
    await landOnBoardAfterBack();
  });

  it('after a refused send: Back gives the runner row the focus', async () => {
    const held = await openSheetFromPopup();
    fireEvent.click(await within(sheet()).findByRole('button', { name: 'Send challenge' }));
    await held.answer({ success: false, error: REFUSED });
    expect(await within(sheet()).findByText(REFUSED)).toBeInTheDocument();

    await landOnBoardAfterBack();
  });

  it('after the time limit: Back gives the runner row the focus', async () => {
    const held = await openSheetFromPopup();
    fireEvent.click(await within(sheet()).findByRole('button', { name: 'Send challenge' }));
    await held.answer({ success: false, error: 'Request timed out', reason: 'timeout' });
    expect(await within(sheet()).findByText(UNCONFIRMED)).toBeInTheDocument();

    await landOnBoardAfterBack();
  });

  it('Back from an idle sheet and then straight on to another page that lists the runner does not move the focus there', async () => {
    await openSheetFromPopup();
    heldUsers();
    browserBack();
    await waitFor(() => expect(location()).toBe(BOARD));
    expect(document.querySelector(`main [data-runner-id="${KARL}"]`)).toBeNull();

    fireEvent.click(screen.getByText('Go to standings'));
    await waitFor(() => expect(location()).toBe('/duels?view=standings'));
    await waitFor(() => expect(karlRow()).toBeInTheDocument());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)); });

    expect(karlRow()).not.toHaveFocus();
  });
});

describe('Back from the send sheet when the entry has no origin', () => {
  it('the header Send opens it: Back keeps the user on duels with the focus on that button', async () => {
    renderWithApp(<><AppRoutes /><BackButton /></>, { entry: [DUELS_LIVE], width: DESKTOP, history: true });
    const user = userEvent.setup();
    const headerSend = await screen.findByRole('button', { name: 'Send a challenge' });
    await user.click(headerSend);
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    browserBack();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(headerSend).toHaveFocus());
    expect(lockLeft()).toEqual(NO_LOCK);
  });

  it('an entry that came from another page (a deep link, the New sheet): Back lands on that page with the focus on its heading, not on the body', async () => {
    renderWithApp(<><AppRoutes /><BackButton /></>, { entry: ['/titles', `/duels?send=1&opponent=${KARL}`], width: DESKTOP, history: true });
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    browserBack();

    await waitFor(() => expect(location()).toBe('/titles'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const heading = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(lockLeft()).toEqual(NO_LOCK);
  });
});

// Kortet i tokens-panelen som öppnade arket försvinner när ett sent svar hämtar om tokens (tokenet är förbrukat), och fokus, som Back lämnade på kortets Send, faller då till <body>.
const CARD_SEND = { name: 'Send a minor challenge: Most km, 7 days' };
/** Vad "mina utmaningar" visar när servern har skapat utmaningen: tokenet är borta och utmaningen väntar på svar. */
const afterServerCreated = () => mine({ tokens: [], sent_challenge: challenge({ id: 'c-new', challenger_id: ME.id, opponent_id: KARL }) });

/**
 * Räknar de levande `focusin`-lyssnarna på dokumentet (de som lagts till och inte tagits bort). Bevakningen av fokus (`useFocusRescue`) lägger en lyssnare per skick, och den ska vara borta
 * när skicket är avgjort, arket tog hand om fokus själv eller skärmen försvann. Måste installeras före renderingen.
 */
function trackFocusinListeners(): () => number {
  const live: Array<{ listener: unknown; capture: boolean }> = [];
  const isCapture = (options: unknown) => options === true || (typeof options === 'object' && options !== null && (options as { capture?: boolean }).capture === true);
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'focusin') live.push({ listener, capture: isCapture(options) });
    add(type, listener, options);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'focusin') {
      const index = live.findIndex((entry) => entry.listener === listener && entry.capture === isCapture(options));
      if (index >= 0) live.splice(index, 1);
    }
    remove(type, listener, options);
  });
  // Prenumerationerna på frågecachen räknas med: bevakningen tar en när svaret landat, och den ska släppas lika noga.
  const subscribe = QueryCache.prototype.subscribe;
  vi.spyOn(QueryCache.prototype, 'subscribe').mockImplementation(function subscribeTracked(this: QueryCache, listener) {
    const entry = { listener: null, capture: false };
    live.push(entry);
    const unsubscribe = subscribe.call(this, listener);
    return () => {
      const index = live.indexOf(entry);
      if (index >= 0) live.splice(index, 1);
      unsubscribe();
    };
  });
  return () => live.length;
}

/** Duels (vyn `entry`), kortets Send, motståndaren Karl och Send; skicket hålls. Back lämnar fokus på kortets Send. `baseline` är antalet `focusin`-lyssnare innan skicket gick iväg. */
async function sendFromTokenCardThenBack(entry = DUELS_LIVE) {
  const focusinCount = trackFocusinListeners();
  const held = heldSend();
  renderWithApp(<><AppRoutes /><BackButton /></>, { entry: [entry], width: DESKTOP, history: true });
  const user = userEvent.setup();
  const cardSend = await screen.findByRole('button', CARD_SEND);
  const baseline = focusinCount();
  await user.click(cardSend);
  await screen.findByRole('dialog', { name: 'Send a challenge' });
  await user.click(await within(sheet()).findByRole('radio', { name: /Karl Persson/ }));
  await user.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));
  expect(await within(sheet()).findByRole('button', { name: 'Sending…' })).toBeDisabled();
  await waitFor(() => expect(held.calls).toHaveLength(1));

  browserBack();

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(cardSend).toHaveFocus());
  return { held, cardSend, focusinCount, baseline };
}

describe('Back during a send from a token card, then the answer', () => {
  it('a late 201 removes the card that had the focus: the focus goes to the confirmation, not to the body', async () => {
    const { held, cardSend } = await sendFromTokenCardThenBack();
    handlers.getMyChallenges = () => ({ success: true, data: afterServerCreated() });

    await held.answer({ success: true, data: { challenge_id: 'c-new' } });

    const confirmation = await screen.findByText(SENT);
    await waitFor(() => expect(cardSend).not.toBeInTheDocument());
    await waitFor(() => expect(confirmation).toHaveFocus());
    expect(screen.getAllByText(SENT)).toHaveLength(1);
  });

  it('the time limit lands first and the refetch that removes the card comes after it: the focus goes to the honest text, not to the body', async () => {
    const { held, cardSend } = await sendFromTokenCardThenBack();
    let releaseTokens: () => void = () => {};
    const tokensHeld = new Promise<void>((resolve) => { releaseTokens = resolve; });
    handlers.getMyChallenges = async () => { await tokensHeld; return { success: true, data: afterServerCreated() }; };

    await held.answer({ success: false, error: 'Request timed out', reason: 'timeout' });
    const notice = await screen.findByText(UNCONFIRMED);
    expect(cardSend).toBeInTheDocument();
    expect(cardSend).toHaveFocus();

    releaseTokens();

    await waitFor(() => expect(cardSend).not.toBeInTheDocument());
    await waitFor(() => expect(notice).toHaveFocus());
  });

  it('a 400 leaves the card where it is and the focus on it: the answer does not take the focus', async () => {
    const { held, cardSend } = await sendFromTokenCardThenBack();

    await held.answer({ success: false, error: REFUSED });

    const notice = await screen.findByText(REFUSED);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(cardSend).toBeInTheDocument();
    expect(cardSend).toHaveFocus();
    expect(notice).not.toHaveFocus();
  });

  it('a late 201 when the user has moved the focus elsewhere does not take it', async () => {
    const { held } = await sendFromTokenCardThenBack();
    const elsewhere = screen.getByText('Go to standings');
    act(() => elsewhere.focus());
    handlers.getMyChallenges = () => ({ success: true, data: afterServerCreated() });

    await held.answer({ success: true, data: { challenge_id: 'c-new' } });

    const confirmation = await screen.findByText(SENT);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(elsewhere).toHaveFocus();
    expect(confirmation).not.toHaveFocus();
  });

  it('a late answer while the runner popup is open and the element that had the focus is still there does not move the focus', async () => {
    const { held } = await sendFromTokenCardThenBack('/duels?view=standings');
    fireEvent.click(karlRow());
    const popup = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });
    await waitFor(() => expect(popup).toContainElement(document.activeElement as HTMLElement));
    handlers.getMyChallenges = () => ({ success: true, data: afterServerCreated() });

    await held.answer({ success: true, data: { challenge_id: 'c-new' } });

    const confirmation = await screen.findByText(SENT);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(popup).toContainElement(document.activeElement as HTMLElement);
    expect(confirmation).not.toHaveFocus();
  });
});

// Bevakningen av fokus lägger en `focusin`-lyssnare per skick. Den ska vara borta när skicket är avgjort, när arket tar hand om fokus själv och när skärmen försvinner: annars sitter den kvar
// och flyttar fokus vid en senare omritning.
describe('the focus watch leaves no listener behind', () => {
  it('while the send is pending after Back there is one more, and it is gone when a 400 has landed and the card is still there', async () => {
    const { held, focusinCount, baseline } = await sendFromTokenCardThenBack();
    expect(focusinCount()).toBe(baseline + 1);

    await held.answer({ success: false, error: REFUSED });
    await screen.findByText(REFUSED);

    await waitFor(() => expect(focusinCount()).toBe(baseline));
  });

  it('a time limit whose refetch changes nothing (the challenge was never created) leaves none behind', async () => {
    const { held, cardSend, focusinCount, baseline } = await sendFromTokenCardThenBack();
    // Omhämtningen pågår när tidsgränsen landar (som mot ett riktigt nät) och svarar sedan med samma data: ingen ritning följer på den, så inget annat än bevakningen själv kan städa.
    let releaseTokens: () => void = () => {};
    const tokensHeld = new Promise<void>((resolve) => { releaseTokens = resolve; });
    handlers.getMyChallenges = async () => { await tokensHeld; return { success: true, data: mine() }; };

    await held.answer({ success: false, error: 'Request timed out', reason: 'timeout' });
    await screen.findByText(UNCONFIRMED);
    // Lyssnaren på fokus och prenumerationen på frågecachen, som väntar på att omhämtningen ska bli klar.
    expect(focusinCount()).toBe(baseline + 2);
    releaseTokens();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });

    expect(focusinCount()).toBe(baseline);
    expect(cardSend).toHaveFocus();
  });

  it('a time limit whose refetch removes the card leaves none behind either', async () => {
    const { held, focusinCount, baseline } = await sendFromTokenCardThenBack();
    handlers.getMyChallenges = () => ({ success: true, data: afterServerCreated() });

    await held.answer({ success: false, error: 'Request timed out', reason: 'timeout' });
    const notice = await screen.findByText(UNCONFIRMED);
    await waitFor(() => expect(notice).toHaveFocus());

    expect(focusinCount()).toBe(baseline);
  });

  it('an answer that comes while the sheet is still open leaves none behind: the sheet takes care of the focus', async () => {
    const focusinCount = trackFocusinListeners();
    const held = heldSend();
    renderWithApp(<><AppRoutes /><BackButton /></>, { entry: [DUELS_LIVE], width: DESKTOP, history: true });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', CARD_SEND));
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    await user.click(await within(sheet()).findByRole('radio', { name: /Karl Persson/ }));
    const baseline = focusinCount();
    await user.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));
    await waitFor(() => expect(held.calls).toHaveLength(1));
    expect(focusinCount()).toBe(baseline + 1);

    await held.answer({ success: false, error: REFUSED });
    expect(await within(sheet()).findByText(REFUSED)).toBeInTheDocument();

    expect(focusinCount()).toBe(baseline);
  });

  it('leaving the screen while the send is pending removes it, and the answer afterwards adds none', async () => {
    const { held, focusinCount, baseline } = await sendFromTokenCardThenBack();
    fireEvent.click(screen.getByText('Go to titles'));
    await waitFor(() => expect(location()).toBe('/titles'));

    await waitFor(() => expect(focusinCount()).toBe(baseline));
    await held.answer({ success: true, data: { challenge_id: 'c-new' } });

    expect(focusinCount()).toBe(baseline);
  });
});
