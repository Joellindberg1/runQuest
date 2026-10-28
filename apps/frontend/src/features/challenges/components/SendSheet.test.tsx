import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LEGENDARY_AUTO_START_DAYS, type MyChallengeToken } from '@runquest/shared';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { renderWithApp } from '@/test/renderApp';
import { ADAM, DAN, KARL, ME, NICK, stat, token } from '../duels.fixture';
import { stakeOf } from '../duelsFormat';
import { buildTokenGroups } from '../duelsModel';
import { startRuleText, type SendPreselection } from '../sendModel';
import { SendSheet } from './SendSheet';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

// Tre minor (två av dem identiska), en major och en legendary utan straff: allt send-flödets steg 1-2 behöver.
const MINOR_KM_A = token({ id: 'a', tier: 'minor', metric: 'km', duration_days: 7 });
const MINOR_KM_B = token({ id: 'b', tier: 'minor', metric: 'km', duration_days: 7 });
const MINOR_RUNS = token({
  id: 'r', tier: 'minor', metric: 'runs', duration_days: 5,
  winner_delta: 0.2, winner_duration: 3, winner_type: 'multiplier_runs', loser_delta: -0.1, loser_duration: 1, loser_type: 'multiplier_runs',
});
const MAJOR = token({ id: 'm', tier: 'major', metric: 'km', duration_days: 10 });
const LEGENDARY_NO_PENALTY = token({ id: 'l', tier: 'legendary', metric: 'total_xp', duration_days: 30, loser_delta: 0, loser_duration: 0 });

const ALL_TIERS = [MINOR_KM_A, MINOR_KM_B, MINOR_RUNS, MAJOR, LEGENDARY_NO_PENALTY];
const NO_MAJOR = ALL_TIERS.filter((entry) => entry.tier !== 'major');
const LONE_CARDS = [MINOR_KM_A, MAJOR, LEGENDARY_NO_PENALTY];

type Records = Record<string, { wins: number; draws: number; losses: number; total: number }>;

interface SheetOptions {
  tokens?: MyChallengeToken[];
  preselection?: SendPreselection | null;
  members?: ReturnType<typeof stat>[];
  initialOpponent?: string | null;
  records?: Records;
  onSend?: (tokenKey: string, opponentId: string) => Promise<void>;
  onClose?: () => void;
}

// Jag, två lediga medlemmar, en i en duell och en som väntar på mitt svar.
const PACK = [stat(ME), stat(KARL), stat(DAN), stat(ADAM, { challenge_active: true }), stat(NICK, { has_pending_challenge: true })];

function renderSheet({ tokens = ALL_TIERS, preselection = null, members = [stat(ME), stat(KARL)], initialOpponent = null, records, onSend = async () => {}, onClose = () => {} }: SheetOptions = {}) {
  resetFakeBackend();
  handlers.getHeadToHead = records
    ? (id: unknown) => ({ success: true, data: { opponent: { id, name: '', profile_picture: null }, record: records[id as string], history: [], active: null } })
    : () => ({ success: false, error: 'not needed' });
  const view = renderWithApp(
    <SendSheet
      groups={buildTokenGroups(tokens)}
      blocker={null}
      members={members}
      users={undefined}
      meId={ME}
      preselection={preselection}
      initialOpponent={initialOpponent}
      onClose={onClose}
      onSend={onSend}
    />,
  );
  return view;
}

const sheet = () => screen.getByRole('dialog', { name: 'Send a challenge' });
const tierRow = () => within(sheet()).getByRole('group', { name: '1 · Pick a tier' });
const chips = () => within(tierRow()).getAllByRole('button');
const chip = (name: string) => within(tierRow()).getByRole('button', { name });
const cardGroup = () => within(sheet()).getByRole('radiogroup', { name: /^2 · Pick a challenge/ });
const radios = () => within(cardGroup()).getAllByRole('radio');
const checked = () => radios().map((radio) => radio.getAttribute('aria-checked') === 'true');
const lines = (radio: HTMLElement) => Array.from(radio.querySelectorAll('.rq-duels-token__text > *')).map((line) => line.textContent);

describe('Send flow step 1: tier chips', () => {
  it('shows the three tier chips with their counts, without a fixed stake or a penalty line', () => {
    renderSheet();
    expect(chips().map((entry) => entry.textContent)).toEqual(['Minor ×3', 'Major ×1', 'Legendary ×1']);
    const step = tierRow().closest('section') as HTMLElement;
    expect(step.textContent).not.toMatch(/penalty|\bfor \d/i);
  });

  it('the chosen tier is aria-pressed and choosing another tier moves it', async () => {
    const user = userEvent.setup();
    renderSheet({ preselection: { tier: 'major', tokenKey: null } });
    expect(chips().map((entry) => entry.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);

    await user.click(chip('Legendary ×1'));
    expect(chips().map((entry) => entry.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('an empty tier cannot be chosen: it is aria-disabled, explains itself and leaves the choice as it was', async () => {
    const user = userEvent.setup();
    renderSheet({ tokens: NO_MAJOR });
    expect(chip('Major ×0')).toHaveAttribute('aria-disabled', 'true');

    await user.click(chip('Major ×0'));
    expect(within(sheet()).getByRole('status')).toHaveTextContent('No Major tokens right now');
    expect(chip('Major ×0')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Minor ×3')).toHaveAttribute('aria-pressed', 'true');
    expect(radios()).toHaveLength(3);
  });

  it('the explanation sits between the tier step and the card step, and is never a blank surface', async () => {
    const user = userEvent.setup();
    renderSheet({ tokens: NO_MAJOR });
    await user.click(chip('Major ×0'));
    const status = within(sheet()).getByRole('status');
    expect(tierRow().compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.compareDocumentPosition(cardGroup()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(radios().length).toBeGreaterThan(0);
  });

  it('activating an empty tier again announces the reason again, and choosing a tier with tokens removes it', async () => {
    const user = userEvent.setup();
    renderSheet({ tokens: NO_MAJOR });
    await user.click(chip('Major ×0'));
    const first = within(sheet()).getByText('No Major tokens right now');

    await user.click(chip('Major ×0'));
    const second = within(sheet()).getByText('No Major tokens right now');
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);

    await user.click(chip('Legendary ×1'));
    expect(within(sheet()).queryByText('No Major tokens right now')).toBeNull();
    expect(within(sheet()).getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('Send flow step 2: one card per token', () => {
  it('shows one card per token on the chosen tier, and identical tokens are separate cards', () => {
    renderSheet();
    expect(radios()).toHaveLength(3);
    expect(lines(radios()[0])).toEqual(lines(radios()[1]));
    expect(radios()[0]).not.toBe(radios()[1]);
  });

  it('every card reads as two rows, length and stake on separate rows, and the bookmark carries no number', () => {
    renderSheet();
    expect(radios().map(lines)).toEqual([
      ['Most km · 7 days', '+0.15× for 5 days · −0.07× for 5 days'],
      ['Most km · 7 days', '+0.15× for 5 days · −0.07× for 5 days'],
      ['Most runs · 5 days', '+0.2× for 3 runs · −0.1× for 1 run'],
    ]);
    for (const radio of radios()) {
      const bookmark = radio.querySelector('svg');
      expect(bookmark).not.toBeNull();
      expect(bookmark?.querySelector('text')).toBeNull();
    }
  });

  it('a legendary card shows its penalty, or No penalty when it is 0', async () => {
    const user = userEvent.setup();
    const withPenalty = token({ id: 'lp', tier: 'legendary', metric: 'km', duration_days: 14 });
    renderSheet({ tokens: [withPenalty, LEGENDARY_NO_PENALTY], preselection: { tier: 'legendary', tokenKey: null } });
    expect(radios().map((radio) => lines(radio)[1])).toEqual(['+0.5× for 14 days · −0.25× for 14 days', '+0.5× for 14 days · No penalty']);
    expect(within(sheet()).queryByRole('button', { name: /penalty/i })).toBeNull();
    await user.click(radios()[1]);
    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('the stake on a card equals the stake of the chosen token', async () => {
    const user = userEvent.setup();
    renderSheet();
    for (const [index, source] of [MINOR_KM_A, MINOR_KM_B, MINOR_RUNS].entries()) {
      await user.click(radios()[index]);
      const stake = stakeOf(source);
      expect(lines(radios()[index])[1]).toBe(`${stake.winFor} · ${stake.loseFor}`);
      expect(within(sheet()).getByText(stake.winFor, { selector: '.rq-duels-bet__stakes dd' })).toBeInTheDocument();
    }
  });

  it('the cards are a radiogroup with aria-checked, and the chosen card shows a check and the text Selected', async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(radios()).toHaveLength(3);
    expect(checked()).toEqual([false, false, false]);
    expect(within(cardGroup()).queryByText(/Selected/)).toBeNull();

    await user.click(radios()[2]);
    expect(checked()).toEqual([false, false, true]);
    const marks = within(cardGroup()).getAllByText(/Selected/);
    expect(marks).toHaveLength(1);
    expect(radios()[2]).toContainElement(marks[0]);
    expect(marks[0]).toHaveTextContent('✓ Selected');
  });

  it('a card is named by its metric, length and stake, and the Selected text is not read a second time', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(radios()[2]);
    expect(within(cardGroup()).getByRole('radio', { name: /^Most runs · 5 days\s*\+0\.2× for 3 runs · −0\.1× for 1 run$/ })).toBeInTheDocument();
  });

  it('the cards are one tab stop: Tab enters the group once, on the first card, and leaves it again', async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(radios().map((radio) => radio.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    chips().at(-1)?.focus();
    await user.tab();
    expect(radios()[0]).toHaveFocus();
    await user.tab();
    expect(radios().some((radio) => radio === document.activeElement)).toBe(false);
    await user.tab({ shift: true });
    expect(radios()[0]).toHaveFocus();
  });

  it('the tab stop follows the chosen card', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(radios()[1]);
    expect(radios().map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('arrow keys move the choice and the focus together, and wrap around', async () => {
    const user = userEvent.setup();
    renderSheet();
    radios()[0].focus();

    await user.keyboard('{ArrowDown}');
    expect(radios()[1]).toHaveFocus();
    expect(checked()).toEqual([false, true, false]);

    await user.keyboard('{ArrowRight}');
    expect(checked()).toEqual([false, false, true]);

    await user.keyboard('{ArrowDown}');
    expect(radios()[0]).toHaveFocus();
    expect(checked()).toEqual([true, false, false]);

    await user.keyboard('{ArrowUp}');
    expect(radios()[2]).toHaveFocus();
    expect(checked()).toEqual([false, false, true]);

    await user.keyboard('{ArrowLeft}');
    expect(checked()).toEqual([false, true, false]);
  });

  it('Home and End jump to the first and the last card', async () => {
    const user = userEvent.setup();
    renderSheet();
    radios()[1].focus();
    await user.keyboard('{End}');
    expect(radios()[2]).toHaveFocus();
    expect(checked()).toEqual([false, false, true]);
    await user.keyboard('{Home}');
    expect(radios()[0]).toHaveFocus();
    expect(checked()).toEqual([true, false, false]);
  });

  it('Space and Enter choose the focused card', async () => {
    const user = userEvent.setup();
    renderSheet();
    radios()[1].focus();
    await user.keyboard(' ');
    expect(checked()).toEqual([false, true, false]);

    radios()[2].focus();
    await user.keyboard('{Enter}');
    expect(checked()).toEqual([false, false, true]);
  });
});

describe('Send flow: where it starts', () => {
  it('Send on a token card preselects its tier and that card', () => {
    renderSheet({ preselection: { tier: 'minor', tokenKey: 'b' } });
    expect(chip('Minor ×3')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([false, true, false]);
  });

  it('a tier chip preselects the tier only, unless the tier has a lone card', () => {
    const { unmount } = renderSheet({ preselection: { tier: 'minor', tokenKey: null } });
    expect(chip('Minor ×3')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([false, false, false]);
    unmount();

    renderSheet({ preselection: { tier: 'major', tokenKey: null } });
    expect(chip('Major ×1')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([true]);
  });

  it('no preselection starts at the first tier that has tokens, never at a chosen card', () => {
    const { unmount } = renderSheet();
    expect(chip('Minor ×3')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([false, false, false]);
    unmount();

    renderSheet({ tokens: [MAJOR] });
    expect(chip('Major ×1')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([true]);
  });

  it('a lone card is preselected', () => {
    renderSheet({ tokens: LONE_CARDS });
    expect(checked()).toEqual([true]);
    expect(within(cardGroup()).getByText(/Selected/)).toBeInTheDocument();
  });

  it('a preselection that is no longer valid falls back instead of selecting a card that is gone', () => {
    const { unmount } = renderSheet({ tokens: NO_MAJOR, preselection: { tier: 'major', tokenKey: null } });
    expect(chip('Minor ×3')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([false, false, false]);
    unmount();

    renderSheet({ preselection: { tier: 'minor', tokenKey: 'gone' } });
    expect(chip('Minor ×3')).toHaveAttribute('aria-pressed', 'true');
    expect(checked()).toEqual([false, false, false]);
  });

  it('without any tokens there is nothing to start at', () => {
    renderSheet({ tokens: [] });
    expect(within(sheet()).getByRole('status')).toHaveTextContent('You have no tokens to send');
    expect(within(sheet()).queryByRole('radiogroup')).toBeNull();
    expect(within(sheet()).queryByRole('group', { name: '1 · Pick a tier' })).toBeNull();
  });

  it('changing the tier clears the card choice, except a lone card', async () => {
    const user = userEvent.setup();
    renderSheet({ tokens: [MINOR_KM_A, MINOR_KM_B, MAJOR], preselection: { tier: 'minor', tokenKey: 'b' } });
    expect(checked()).toEqual([false, true]);

    await user.click(chip('Major ×1'));
    expect(checked()).toEqual([true]);

    await user.click(chip('Minor ×2'));
    expect(checked()).toEqual([false, false]);
  });

  it('choosing the tier that is already chosen keeps the chosen card', async () => {
    const user = userEvent.setup();
    renderSheet({ preselection: { tier: 'minor', tokenKey: 'b' } });
    await user.click(chip('Minor ×3'));
    expect(checked()).toEqual([false, true, false]);
  });

  it('the sheet never shows the previous choice: open, choose, close and open again', async () => {
    const user = userEvent.setup();
    const first = renderSheet();
    await user.click(radios()[2]);
    expect(checked()).toEqual([false, false, true]);
    first.unmount();

    renderSheet();
    expect(checked()).toEqual([false, false, false]);
  });
});

describe('Send flow: focus when there is no opener', () => {
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <h1 className="rq-duels__title" tabIndex={-1}>Challenges</h1>
        {open && (
          <SendSheet groups={buildTokenGroups(ALL_TIERS)} blocker={null} members={[stat(ME), stat(KARL)]} users={undefined} meId={ME} preselection={null} initialOpponent={null} onClose={() => setOpen(false)} onSend={async () => {}} />
        )}
      </>
    );
  }

  it('without an opener and without a header button, the focus goes to the page heading', async () => {
    const user = userEvent.setup();
    resetFakeBackend();
    renderWithApp(<Host />);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Challenges' })).toHaveFocus();
  });
});

const opponentGroup = () => within(sheet()).getByRole('radiogroup', { name: '3 · Pick an opponent' });
const opponents = () => within(opponentGroup()).getAllByRole('radio');
const opponent = (name: RegExp | string) => within(opponentGroup()).getByRole('radio', { name });
const chosenOpponents = () => opponents().map((radio) => radio.getAttribute('aria-checked') === 'true');
const bet = () => within(sheet()).getByRole('region', { name: 'The bet' });
const sendButton = () => within(sheet()).getByRole('button', { name: /^Send|^Sending/ });

describe('Send flow step 3: pick an opponent', () => {
  it('the opponents are a radiogroup with aria-checked, and none is chosen to begin with', () => {
    renderSheet({ members: PACK });
    expect(opponents().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false']);
    expect(within(opponentGroup()).queryAllByRole('radio', { checked: true })).toEqual([]);
    expect(within(sheet()).queryByRole('button', { name: /Karl Persson/ })).toBeNull();
  });

  it('you cannot challenge yourself: I am not in the list', () => {
    renderSheet({ members: PACK });
    expect(within(opponentGroup()).queryByRole('radio', { name: /Joel Lindberg/ })).toBeNull();
    expect(opponents()).toHaveLength(PACK.length - 1);
  });

  it('choosing an opponent moves the check, and choosing another moves it again', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    await user.click(opponent(/Karl Persson/));
    expect(chosenOpponents()).toEqual([false, true, false, false]);
    await user.click(opponent(/Daniel Lindblad/));
    expect(chosenOpponents()).toEqual([true, false, false, false]);
  });

  it('an opponent in a duel or waiting on a reply is disabled, shows why, and cannot be chosen', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    const inDuel = opponent(/Adam Einstein/);
    const waiting = opponent(/Nicklas von Elling/);
    for (const radio of [inDuel, waiting]) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
      expect(radio).toHaveAttribute('tabindex', '-1');
    }
    expect(within(inDuel).getByText('In a duel')).toBeVisible();
    expect(within(waiting).getByText('Waiting on a reply')).toBeVisible();
    expect(inDuel).toHaveAccessibleName(/In a duel/);
    expect(opponent(/Karl Persson/)).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(inDuel);
    await user.click(waiting);
    expect(chosenOpponents()).toEqual([false, false, false, false]);
  });

  it('?opponent= preselects an opponent who can be challenged, and nobody else', () => {
    const first = renderSheet({ members: PACK, initialOpponent: KARL });
    expect(chosenOpponents()).toEqual([false, true, false, false]);
    first.unmount();

    for (const unavailable of [ADAM, NICK, ME, 'u-not-in-the-pack']) {
      const view = renderSheet({ members: PACK, initialOpponent: unavailable });
      expect(chosenOpponents()).toEqual([false, false, false, false]);
      view.unmount();
    }
  });

  it('the head to head hint says to you, the name, drawn or never met, and a busy opponent keeps theirs next to the reason', async () => {
    renderSheet({
      members: PACK,
      records: {
        [KARL]: { wins: 2, draws: 0, losses: 0, total: 2 },
        [NICK]: { wins: 0, draws: 0, losses: 1, total: 1 },
        [DAN]: { wins: 0, draws: 1, losses: 0, total: 1 },
        [ADAM]: { wins: 0, draws: 0, losses: 0, total: 0 },
      },
    });
    expect(await within(opponentGroup()).findByText('2–0 to you')).toBeVisible();
    expect(within(opponent(/Nicklas von Elling/)).getByText('0–1 to Nicklas')).toBeVisible();
    expect(within(opponent(/Nicklas von Elling/)).getByText('Waiting on a reply')).toBeVisible();
    expect(within(opponent(/Daniel Lindblad/)).getByText('drawn 1')).toBeVisible();
    expect(within(opponent(/Adam Einstein/)).getByText('never met')).toBeVisible();
    expect(opponentGroup().textContent).not.toMatch(/\b(him|her)\b/i);
  });

  it('the opponents are one tab stop on the first one that can be chosen, and on the chosen one once there is one', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    expect(opponents().map((radio) => radio.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    await user.click(opponent(/Karl Persson/));
    expect(opponents().map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1']);
  });

  it('arrow keys move the choice and the focus together, skip the ones that cannot be chosen, and wrap around', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    const [daniel, karl] = opponents();
    daniel.focus();

    await user.keyboard('{ArrowDown}');
    expect(karl).toHaveFocus();
    expect(chosenOpponents()).toEqual([false, true, false, false]);

    await user.keyboard('{ArrowRight}');
    expect(daniel).toHaveFocus();
    expect(chosenOpponents()).toEqual([true, false, false, false]);

    await user.keyboard('{ArrowUp}');
    expect(karl).toHaveFocus();
    expect(chosenOpponents()).toEqual([false, true, false, false]);

    await user.keyboard('{ArrowLeft}');
    expect(daniel).toHaveFocus();
  });

  it('Home and End jump to the first and the last opponent that can be chosen, and Space and Enter choose the focused one', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    const [daniel, karl] = opponents();
    daniel.focus();
    await user.keyboard('{End}');
    expect(karl).toHaveFocus();
    expect(chosenOpponents()).toEqual([false, true, false, false]);
    await user.keyboard('{Home}');
    expect(daniel).toHaveFocus();
    expect(chosenOpponents()).toEqual([true, false, false, false]);

    karl.focus();
    await user.keyboard(' ');
    expect(chosenOpponents()).toEqual([false, true, false, false]);
    daniel.focus();
    await user.keyboard('{Enter}');
    expect(chosenOpponents()).toEqual([true, false, false, false]);
  });

  it('with nobody to challenge the list says so instead of staying empty', () => {
    renderSheet({ members: [stat(ME)] });
    expect(within(sheet()).queryByRole('radio', { name: /Joel/ })).toBeNull();
    expect(within(sheet()).getByText('Nobody else is in your group yet.')).toBeVisible();
  });
});

describe('the bet', () => {
  const winOf = () => within(bet()).getByText('If you win').nextElementSibling as HTMLElement;
  const loseOf = () => within(bet()).getByText('If you lose').nextElementSibling as HTMLElement;
  const startsOf = () => within(bet()).getByText('Starts').nextElementSibling as HTMLElement;

  it('the bet is a polite live region that is read as a whole', () => {
    renderSheet({ members: PACK });
    expect(bet()).toHaveAttribute('aria-live', 'polite');
    expect(bet()).toHaveAttribute('aria-atomic', 'true');
    expect(bet().querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(0);
  });

  it('the bet names the challenge and the opponent once both are chosen, and says what is missing before that', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    expect(within(bet()).getByText('Pick a challenge and an opponent')).toBeVisible();
    await user.click(opponent(/Karl Persson/));
    expect(within(bet()).getByText('Pick a challenge')).toBeVisible();
    await user.click(radios()[0]);
    expect(within(bet()).getByText('Most km vs Karl · 7 days')).toBeVisible();
    await user.click(radios()[2]);
    expect(within(bet()).getByText('Most runs vs Karl · 5 days')).toBeVisible();
  });

  it('the bet shows the stake of the chosen token, in the words of the cards', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK, tokens: [MINOR_KM_A, MINOR_RUNS, LEGENDARY_NO_PENALTY] });
    expect(winOf()).toHaveTextContent('—');
    expect(loseOf()).toHaveTextContent('—');

    for (const [index, source] of [MINOR_KM_A, MINOR_RUNS].entries()) {
      await user.click(radios()[index]);
      expect(winOf()).toHaveTextContent(stakeOf(source).winFor);
      expect(loseOf()).toHaveTextContent(stakeOf(source).loseFor);
    }
    await user.click(chip('Legendary ×1'));
    expect(winOf().textContent).toBe(stakeOf(LEGENDARY_NO_PENALTY).winFor);
    expect(loseOf().textContent).toBe('No penalty');
  });

  it('the bet shows the real start rule', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    // Minor och major: midnatten efter accepten. Aldrig prototypens "when accepted".
    expect(startsOf().textContent).toBe('Midnight after it is accepted');
    expect(startsOf().textContent).toBe(startRuleText('minor'));
    await user.click(chip('Major ×1'));
    expect(startsOf().textContent).toBe('Midnight after it is accepted');

    // Legendary startar också av sig själv efter schemaläggarens antal dagar, ur samma konstant, redan innan ett kort är valt.
    await user.click(chip('Legendary ×1'));
    expect(startsOf().textContent).toBe(`Midnight after it is accepted, or after ${LEGENDARY_AUTO_START_DAYS} d unanswered`);
    expect(startsOf().textContent).toBe(startRuleText('legendary'));
    expect(bet().textContent).not.toMatch(/when accepted/i);
  });

  it('the bet is announced once per change: a change of choice changes it once, anything else leaves it alone', async () => {
    const user = userEvent.setup();
    renderSheet({
      members: PACK,
      records: { [KARL]: { wins: 2, draws: 0, losses: 0, total: 2 }, [DAN]: { wins: 0, draws: 0, losses: 0, total: 0 } },
    });
    let changes = 0;
    const observer = new MutationObserver(() => { changes += 1; });
    observer.observe(bet(), { childList: true, characterData: true, subtree: true, attributes: true });

    // Head to head-tipsen kommer in i listan efter att arket öppnats: det rör inte kortet.
    await within(opponentGroup()).findByText('2–0 to you');
    await user.click(within(sheet()).getByRole('group', { name: '1 · Pick a tier' }));
    expect(changes).toBe(0);

    // Flera snabba val i rad: varje ändring ger exakt en uppdatering, och att välja det redan valda ger ingen.
    await user.click(radios()[0]);
    expect(changes).toBe(1);
    await user.click(radios()[0]);
    expect(changes).toBe(1);
    await user.click(opponent(/Karl Persson/));
    expect(changes).toBe(2);
    await user.click(opponent(/Daniel Lindblad/));
    await user.click(opponent(/Karl Persson/));
    await user.click(radios()[2]);
    expect(changes).toBe(5);
    // Ett identiskt kort (samma mått, längd och insats) ger samma text: ingen ny uppläsning.
    await user.click(radios()[2]);
    await user.keyboard('{Tab}');
    expect(changes).toBe(5);
    observer.disconnect();
    expect(within(bet()).getAllByText(/Most runs vs Karl/)).toHaveLength(1);
  });
});

describe('Send flow: sending and cancelling', () => {
  it('Send challenge is disabled until a tier, a token and an opponent are chosen', async () => {
    const user = userEvent.setup();
    renderSheet({ members: PACK });
    expect(sendButton()).toBeDisabled();
    await user.click(radios()[0]);
    expect(sendButton()).toBeDisabled();
    await user.click(opponent(/Karl Persson/));
    expect(sendButton()).toBeEnabled();
  });

  it('Cancel is there, closes the flow and sends nothing', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => {});
    const onClose = vi.fn();
    renderSheet({ members: PACK, initialOpponent: KARL, preselection: { tier: 'minor', tokenKey: 'a' }, onSend, onClose });
    expect(sendButton()).toBeEnabled();
    await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Sending… shows while the challenge is on its way, and the button cannot be pressed twice', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onSend = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderSheet({ members: PACK, initialOpponent: KARL, preselection: { tier: 'minor', tokenKey: 'a' }, onSend });
    await user.click(sendButton());
    expect(sendButton()).toHaveTextContent('Sending…');
    expect(sendButton()).toBeDisabled();
    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('a', KARL);
    finish();
  });

  it('a failed send keeps the sheet, shows the message in an alert, and lets me try again', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => { throw new Error('Opponent already has an active or pending challenge'); });
    renderSheet({ members: PACK, initialOpponent: KARL, preselection: { tier: 'minor', tokenKey: 'a' }, onSend });
    await user.click(sendButton());
    expect(await within(sheet()).findByRole('alert')).toHaveTextContent('Opponent already has an active or pending challenge');
    expect(sendButton()).toHaveTextContent('Send challenge');
    expect(sendButton()).toBeEnabled();
  });
});
