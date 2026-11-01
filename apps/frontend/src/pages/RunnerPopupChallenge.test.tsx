import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import type { HeadToHeadResponse, MyChallengesData } from '@runquest/shared';
import { AppRoutes } from '@/routes';
import { challenge, stat, token } from '@/features/challenges/duels.fixture';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { warmRunnerPopup } from '@/test/warmLazy';
import type { SendOriginState } from '@/shared/hooks/useOpenRunner';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// Challenge i profil-popupen (ADR 006 punkt 5): länken som stänger popupen och öppnar send-flödet, och den avstängda knappen med synligt skäl.

beforeAll(warmRunnerPopup);

const DESKTOP = 1280;
const MOBILE = 390;
const KARL = OTHER.id;
const BACKGROUND = { pathname: '/board', search: '?view=week', hash: '', state: null, key: 'bg' };
const fromBoard = ['/board?view=week', { pathname: `/runner/${KARL}`, state: { background: BACKGROUND } }];

const mine = (over: Partial<MyChallengesData> = {}): MyChallengesData => ({
  tokens: [token({ id: 't1' })], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [], ...over,
});
const free = () => [stat(ME.id), stat(KARL)];

const H2H: HeadToHeadResponse = {
  opponent: { id: KARL, name: OTHER.name, profile_picture: null },
  record: { wins: 2, draws: 0, losses: 1, total: 3 },
  history: [],
  active: null,
};

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({ success: true, data: H2H });
  handlers.getMyChallenges = () => ({ success: true, data: mine() });
  handlers.getChallengeGroupStats = () => ({ success: true, data: free() });
});

const location = () => screen.getByTestId('location').textContent;

/** Skriver ut router-state för aktuell plats och ger en Back-knapp: provet läser det som Challenge skickade med och trycker på webbläsarens Back. */
function Probes() {
  const { state } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="state">{JSON.stringify(state)}</output>
      <button type="button" onClick={() => void navigate(-1)}>Browser back</button>
    </>
  );
}

async function openPopup(entry: typeof fromBoard = fromBoard) {
  renderWithApp(<><AppRoutes /><Probes /></>, { entry, width: DESKTOP });
  const dialog = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });
  await within(dialog).findByRole('heading', { level: 1, name: 'Karl Persson' });
  return dialog;
}

const challengeLink = (dialog: HTMLElement) => within(dialog).findByRole('link', { name: 'Challenge' });
const challengeButton = (dialog: HTMLElement) => within(dialog).findByRole('button', { name: 'Challenge' });

describe('Challenge in the profile popup', () => {
  it('challenge from the popup opens the send flow with the runner selected', async () => {
    const dialog = await openPopup();

    fireEvent.click(await challengeLink(dialog));

    const sheet = await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(location()).toBe(`/duels?send=1&opponent=${KARL}`);
    expect(within(sheet).getByRole('radio', { name: /Karl Persson/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('dialog', { name: 'Runner card: Karl Persson' })).toBeNull();
  });

  it('Back from the send flow goes to the page under the popup, not to a popup that opens again', async () => {
    const dialog = await openPopup();
    fireEvent.click(await challengeLink(dialog));
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    fireEvent.click(screen.getByText('Browser back'));

    await waitFor(() => expect(location()).toBe('/board?view=week'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends the page under the popup and the runner along as route state', async () => {
    const dialog = await openPopup();

    fireEvent.click(await challengeLink(dialog));

    await waitFor(() => expect(location()).toBe(`/duels?send=1&opponent=${KARL}`));
    const expected: { sendOrigin: SendOriginState } = { sendOrigin: { returnTo: '/board?view=week', runnerId: KARL } };
    expect(JSON.parse(screen.getByTestId('state').textContent ?? 'null')).toEqual(expected);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['middle', { button: 1 }],
  ])('a %s-click leaves the link to the browser: no navigation here, the popup stays', async (_name, init) => {
    const dialog = await openPopup();
    const link = await challengeLink(dialog);
    let leftToBrowser = false;
    // Webbläsaren öppnar länken själv bara om routern lät klicket vara; jsdom kan inte navigera, så klicket stoppas efter att det mätts.
    const observe = (event: Event) => { leftToBrowser = !event.defaultPrevented; event.preventDefault(); };
    document.addEventListener('click', observe);

    fireEvent.click(link, init);
    document.removeEventListener('click', observe);

    expect(leftToBrowser).toBe(true);
    expect(location()).toBe(`/runner/${KARL}`);
    expect(screen.getByRole('dialog', { name: 'Runner card: Karl Persson' })).toBe(dialog);
    expect(link).toHaveAttribute('href', `/duels?send=1&opponent=${KARL}`);
  });

  it('a plain click is handled by the router, not left to the browser', async () => {
    const dialog = await openPopup();
    const link = await challengeLink(dialog);
    let leftToBrowser = true;
    const observe = (event: Event) => { leftToBrowser = !event.defaultPrevented; };
    document.addEventListener('click', observe);

    fireEvent.click(link);
    document.removeEventListener('click', observe);

    expect(leftToBrowser).toBe(false);
  });
});

describe('Challenge in the profile popup when it cannot be used', () => {
  const NO_TOKENS = 'You have no tokens to send. You earn them by levelling up.';
  const LIVE = 'You are in a live duel. You can send another one once it is settled.';
  const SENT = 'Your challenge to Adam is waiting for an answer. Withdraw it or wait for the reply before sending another.';
  const INCOMING = 'A challenge is waiting on you. Answer it before you send one of your own.';
  const ADAM = 'u-adam';

  const cases: Array<[string, () => void, string]> = [
    ['I have no tokens', () => { handlers.getMyChallenges = () => ({ success: true, data: mine({ tokens: [] }) }); }, NO_TOKENS],
    [
      'I am in a live duel',
      () => { handlers.getMyChallenges = () => ({ success: true, data: mine({ group_active: [challenge({ id: 'a', challenger_id: ME.id, opponent_id: ADAM, status: 'active' })] }) }); },
      LIVE,
    ],
    [
      'a challenge I sent waits for an answer',
      () => {
        handlers.getMyChallenges = () => ({ success: true, data: mine({ sent_challenge: challenge({ id: 's', challenger_id: ME.id, opponent_id: ADAM, opponent_name: 'Adam Einstein' }) }) });
        handlers.getChallengeGroupStats = () => ({ success: true, data: [...free(), stat(ADAM)] });
      },
      SENT,
    ],
    [
      'a challenge waits on me',
      () => { handlers.getMyChallenges = () => ({ success: true, data: mine({ received_challenges: [challenge({ id: 'i', challenger_id: ADAM, opponent_id: ME.id })] }) }); },
      INCOMING,
    ],
    ['the runner is in a live duel', () => { handlers.getChallengeGroupStats = () => ({ success: true, data: [stat(ME.id), stat(KARL, { challenge_active: true })] }); }, 'Karl is in a live duel right now.'],
    [
      'the runner waits on a reply',
      () => { handlers.getChallengeGroupStats = () => ({ success: true, data: [stat(ME.id), stat(KARL, { has_pending_challenge: true })] }); },
      'Karl is waiting on a reply to a challenge.',
    ],
  ];

  it.each(cases)('when %s: a focusable aria-disabled button with the reason as visible text, described by it, that does nothing', async (_name, arrange, reason) => {
    arrange();
    const user = userEvent.setup();
    const dialog = await openPopup();

    const button = await challengeButton(dialog);
    expect(within(dialog).queryByRole('link', { name: 'Challenge' })).toBeNull();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(within(dialog).getByText(reason)).toBeVisible();
    expect(button).toHaveAccessibleDescription(reason);

    button.focus();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(location()).toBe(`/runner/${KARL}`);
    expect(screen.getByRole('dialog', { name: 'Runner card: Karl Persson' })).toBe(dialog);
  });

  it('while my challenges load the button is off and says nothing', async () => {
    handlers.getMyChallenges = () => new Promise(() => {});
    const dialog = await openPopup();

    const button = await challengeButton(dialog);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).toHaveAccessibleDescription('');
    expect(within(dialog).queryByRole('link', { name: 'Challenge' })).toBeNull();
    expect(within(dialog).queryByText(/tokens|duel|waiting|answer/i)).toBeNull();
  });

  it('while the group loads the button is off and says nothing', async () => {
    handlers.getChallengeGroupStats = () => new Promise(() => {});
    const dialog = await openPopup();

    const button = await challengeButton(dialog);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('');
  });

  it('when my challenges cannot be loaded the button is on, because the server validates the send', async () => {
    handlers.getMyChallenges = () => ({ success: false, error: 'boom' });
    const dialog = await openPopup();

    const link = await within(dialog).findByRole('link', { name: 'Challenge' }, { timeout: 4000 });
    expect(link).toHaveAttribute('href', `/duels?send=1&opponent=${KARL}`);
    expect(within(dialog).queryByRole('button', { name: 'Challenge' })).toBeNull();
  });

  it('a challenge already between the two shows the status chip, also when I could not send anyway', async () => {
    handlers.getMyChallenges = () => ({ success: true, data: mine({ tokens: [] }) });
    handlers.getHeadToHead = () => ({ success: true, data: { ...H2H, active: { id: 'x', status: 'pending', challenger_id: ME.id } } });
    const dialog = await openPopup();

    expect(await within(dialog).findByText('Challenge pending')).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: 'Challenge' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Challenge' })).toBeNull();
    expect(within(dialog).queryByText(NO_TOKENS)).toBeNull();
  });
});

describe('Challenge on the runner page of a phone', () => {
  it('is unchanged: a plain link even without tokens, and Back returns to the runner page', async () => {
    handlers.getMyChallenges = () => ({ success: true, data: mine({ tokens: [] }) });
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: ['/board', `/runner/${KARL}`], width: MOBILE });

    const link = await screen.findByRole('link', { name: 'Challenge' });
    expect(screen.queryByRole('button', { name: 'Challenge' })).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(location()).toBe(`/duels?send=1&opponent=${KARL}`));
    expect(screen.getByTestId('state')).toHaveTextContent('null');

    fireEvent.click(screen.getByText('Browser back'));
    await waitFor(() => expect(location()).toBe(`/runner/${KARL}`));
  });
});
