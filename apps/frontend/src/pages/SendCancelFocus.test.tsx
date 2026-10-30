import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import type { MyChallengesData } from '@runquest/shared';
import { AppRoutes } from '@/routes';
import { challenge, stat, token } from '@/features/challenges/duels.fixture';
import { ME, OTHER, handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);
vi.mock('@/features/onboarding/components/FeatureTour', () => ({ FeatureTour: () => null }));
vi.mock('@/features/badges/api', () => ({
  badgesApi: {
    getUserBadges: async () => ({ items: [], showcase: [] }),
    getGroupBadges: async () => ({ members: [], holders: {}, member_count: 0 }),
  },
}));

// Avbryt i send-flödet som öppnades från löparens popup (ADR 006 punkt 5): tillbaka till sidan under popupen, med fokus på löparens rad.

const DESKTOP = 1280;
const KARL = OTHER.id;
const BOARD = '/board?view=week';
const DUELS_STANDINGS = '/duels?view=standings';
const background = (pathname: string, search: string) => ({ pathname, search, hash: '', state: null, key: 'bg' });
const popupOver = (pathname: string, search: string) => [`${pathname}${search}`, { pathname: `/runner/${KARL}`, state: { background: background(pathname, search) } }];

const mine = (over: Partial<MyChallengesData> = {}): MyChallengesData => ({
  tokens: [token({ id: 't1' })], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [], ...over,
});

beforeEach(() => {
  resetFakeBackend();
  handlers.getUsersWithRuns = () => ({ success: true, data: [ME, OTHER] });
  handlers.getUserTitles = () => ({ success: true, data: [] });
  handlers.getTitleLeaderboard = () => ({ success: true, data: [] });
  handlers.getHeadToHead = () => ({
    success: true,
    data: { opponent: { id: KARL, name: OTHER.name, profile_picture: null }, record: { wins: 0, draws: 0, losses: 0, total: 0 }, history: [], active: null },
  });
  handlers.getMyChallenges = () => ({ success: true, data: mine() });
  handlers.getChallengeGroupStats = () => ({ success: true, data: [stat(ME.id), stat(KARL)] });
});

const location = () => screen.getByTestId('location').textContent;
const sheet = () => screen.getByRole('dialog', { name: 'Send a challenge' });

/** Skriver ut router-state för aktuell plats och ger en Back-knapp. */
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

/** Öppnar popupen över bakgrundssidan och följer Challenge in i send-arket. */
async function openSendFromPopup(entry: unknown[]) {
  renderWithApp(<><AppRoutes /><Probes /></>, { entry: entry as never, width: DESKTOP });
  const dialog = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });
  fireEvent.click(await within(dialog).findByRole('link', { name: 'Challenge' }));
  await screen.findByRole('dialog', { name: 'Send a challenge' });
}

const karlRow = () => {
  const row = document.querySelector<HTMLElement>(`main [data-runner-id="${KARL}"]`);
  if (!row) throw new Error('no runner row for Karl in the page');
  return row;
};

const closers: Array<[string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]> = [
  ['Cancel', (user) => user.click(within(sheet()).getByRole('button', { name: 'Cancel' }))],
  ['the close button', (user) => user.click(within(sheet()).getByRole('button', { name: 'Close' }))],
  ['Escape', (user) => user.keyboard('{Escape}')],
  ['a click on the scrim', (user) => user.click(document.querySelector<HTMLElement>('.rq-scrim')!)],
];

describe('cancelling the send flow that the profile popup opened', () => {
  describe.each([
    ['the board', BOARD, 'The standings'],
    ['the duels page', DUELS_STANDINGS, 'Challenges'],
  ])('with %s under the popup', (_name, entryUrl, heading) => {
    const [pathname, search] = entryUrl.split(/(?=\?)/);

    it.each(closers)('cancel returns to the background page and focuses the runner row, closing with %s', async (_how, close) => {
      const user = userEvent.setup();
      await openSendFromPopup(popupOver(pathname, search));
      expect(location()).toBe(`/duels?send=1&opponent=${KARL}`);

      await close(user);

      await waitFor(() => expect(location()).toBe(entryUrl));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      await waitFor(() => expect(karlRow()).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    });

    it('the focus request is gone from the route state once the row has the focus', async () => {
      const user = userEvent.setup();
      await openSendFromPopup(popupOver(pathname, search));

      await closeWith(user, 'Cancel');

      await waitFor(() => expect(karlRow()).toHaveFocus());
      await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'));
      expect(location()).toBe(entryUrl);
    });
  });

  it('a blocked sheet counts as cancelled when it is closed: Close goes back and focuses the row', async () => {
    const user = userEvent.setup();
    handlers.getMyChallenges = () => ({ success: true, data: mine({ tokens: [] }) });
    const sheetEntry = { pathname: '/duels', search: `?send=1&opponent=${KARL}`, state: { sendOrigin: { returnTo: BOARD, runnerId: KARL } } };
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: [BOARD, sheetEntry] as never, width: DESKTOP });
    expect(await screen.findByText('You have no tokens to send. You earn them by levelling up.')).toBeInTheDocument();

    // ✕ och knappen i fotraden heter båda Close; fotradens är den sista.
    await user.click(within(sheet()).getAllByRole('button', { name: 'Close' }).at(-1)!);

    await waitFor(() => expect(location()).toBe(BOARD));
    await waitFor(() => expect(karlRow()).toHaveFocus());
  });

  it('the row is gone after the navigation: the main heading gets the focus and nothing throws', async () => {
    const user = userEvent.setup();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener('error', onError);
    await openSendFromPopup(popupOver('/board', '?view=week'));
    // Löparen finns inte längre i bakgrundssidans lista när arket stängs.
    handlers.getUsersWithRuns = () => ({ success: true, data: [ME] });

    await closeWith(user, 'Cancel');

    await waitFor(() => expect(location()).toBe(BOARD));
    const heading = await screen.findByRole('heading', { level: 1, name: 'The standings' });
    await waitFor(() => expect(heading).toHaveFocus());
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });

  it('a sent challenge stays on duels', async () => {
    const user = userEvent.setup();
    handlers.sendChallenge = () => ({ success: true, data: { challenge_id: 'new' } });
    await openSendFromPopup(popupOver('/board', '?view=week'));

    await user.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));

    const confirmation = await screen.findByText(/Challenge sent to Karl/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(confirmation).toHaveFocus());
    expect(location()).toBe('/duels');
    expect(screen.queryByRole('heading', { level: 1, name: 'The standings' })).toBeNull();
  });

  it('the send origin is gone from the route state after a send, so a later Cancel stays on duels', async () => {
    const user = userEvent.setup();
    handlers.sendChallenge = () => ({ success: true, data: { challenge_id: 'new' } });
    await openSendFromPopup(popupOver('/board', '?view=week'));
    await user.click(within(sheet()).getByRole('button', { name: 'Send challenge' }));
    await screen.findByText(/Challenge sent to Karl/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('state')).not.toHaveTextContent('sendOrigin');

    // Ett nytt försök från rubrikens Send: utan ursprung, så Cancel stannar på /duels.
    handlers.getMyChallenges = () => ({ success: true, data: mine() });
    await user.click(await screen.findByRole('button', { name: 'Send a challenge' }));
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(screen.getByTestId('state')).not.toHaveTextContent('sendOrigin');
    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels');
    expect(screen.queryByRole('heading', { level: 1, name: 'The standings' })).toBeNull();
  });
});

describe('cancelling a send flow that has no origin', () => {
  it.each(closers)('send a challenge without origin stays on duels, closing with %s', async (_how, close) => {
    const user = userEvent.setup();
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: ['/board', '/duels?send=1'], width: DESKTOP });
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    await close(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels');
    expect(screen.getByRole('button', { name: 'Send a challenge' })).toHaveFocus();
  });

  it('send a challenge without origin stays on duels also when it was opened from the header', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: ['/duels?view=standings'], width: DESKTOP });
    const send = await screen.findByRole('button', { name: 'Send a challenge' });
    await user.click(send);
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe(DUELS_STANDINGS);
    expect(screen.getByRole('button', { name: 'Send a challenge' })).toHaveFocus();
  });
});

describe('a return address that is not an internal one is ignored', () => {
  it.each([
    ['a protocol-relative address', '//evil.com'],
    ['a backslash address', '/\\evil.com'],
    ['an absolute address', 'https://evil.com'],
    ['a tab after the slash', '/\ttx'],
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
  ])('with %s as returnTo the cancel behaves as without a send origin', async (_name, returnTo) => {
    const user = userEvent.setup();
    const entry = [{ pathname: '/duels', search: `?send=1&opponent=${KARL}`, state: { sendOrigin: { returnTo, runnerId: KARL } } }];
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: entry as never, width: DESKTOP });
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels');
    expect(screen.getByRole('button', { name: 'Send a challenge' })).toHaveFocus();
  });

  it('a send origin without a runner id is ignored the same way', async () => {
    const user = userEvent.setup();
    const entry = [{ pathname: '/duels', search: '?send=1', state: { sendOrigin: { returnTo: '/board', runnerId: '' } } }];
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: entry as never, width: DESKTOP });
    await screen.findByRole('dialog', { name: 'Send a challenge' });

    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels');
  });
});

describe('keeping the duels tab through the send flow', () => {
  it('the empty Live state sends to the sheet with the tab in the address, and Cancel stays on Live', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: ['/duels?view=live'], width: DESKTOP });

    await user.click(await screen.findByRole('link', { name: 'Send a challenge' }));
    await screen.findByRole('dialog', { name: 'Send a challenge' });
    expect(location()).toBe('/duels?send=1&view=live');
    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/duels?view=live');
  });

  it('the popup over a duels tab sends the tab along, so a send that ends in no origin lands on the same tab', async () => {
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: popupOver('/duels', '?view=standings') as never, width: DESKTOP });
    const dialog = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });

    const link = await within(dialog).findByRole('link', { name: 'Challenge' });

    expect(link).toHaveAttribute('href', `/duels?send=1&opponent=${KARL}&view=standings`);
  });

  it('the popup over the board adds no tab to the address', async () => {
    renderWithApp(<><AppRoutes /><Probes /></>, { entry: popupOver('/board', '?view=week') as never, width: DESKTOP });
    const dialog = await screen.findByRole('dialog', { name: 'Runner card: Karl Persson' });

    expect(await within(dialog).findByRole('link', { name: 'Challenge' })).toHaveAttribute('href', `/duels?send=1&opponent=${KARL}`);
  });
});

describe('the history of the send flow', () => {
  it('a cancel replaces the entry: Back afterwards never returns into the send sheet', async () => {
    const user = userEvent.setup();
    await openSendFromPopup(['/titles', ...popupOver('/board', '?view=week')]);
    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(location()).toBe(BOARD));

    fireEvent.click(screen.getByText('Browser back'));

    await waitFor(() => expect(location()).toBe(BOARD));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Browser back'));
    await waitFor(() => expect(location()).toBe('/titles'));
  });
});

// Hjälpare i slutet så att scenariona ovan läses uppifrån och ned.
async function closeWith(user: ReturnType<typeof userEvent.setup>, how: string) {
  const closer = closers.find(([name]) => name === how);
  if (!closer) throw new Error(`no closer named ${how}`);
  await closer[1](user);
}
