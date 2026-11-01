import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { token } from '../duels.fixture';
import { buildTokenGroups } from '../duelsModel';
import type { SendBlocker, SendPreselection } from '../sendModel';
import { TokensPanel } from './SidePanels';

const ALL_TIERS = [
  token({ id: 't-minor-km', tier: 'minor', metric: 'km', duration_days: 7 }),
  token({ id: 't-minor-runs', tier: 'minor', metric: 'runs', duration_days: 5 }),
  token({ id: 't-minor-xp', tier: 'minor', metric: 'total_xp', duration_days: 3 }),
  token({ id: 't-major', tier: 'major', metric: 'km', duration_days: 10 }),
  token({ id: 't-legendary', tier: 'legendary', metric: 'total_xp', duration_days: 21 }),
];
const NO_MAJOR = ALL_TIERS.filter((entry) => entry.tier !== 'major');
const ONLY_LEGENDARY = ALL_TIERS.filter((entry) => entry.tier === 'legendary');

interface PanelOptions {
  blocker?: SendBlocker | null;
  onSend?: (preselection: SendPreselection) => void;
}

function renderPanel(tokens = ALL_TIERS, { blocker = null, onSend = vi.fn() }: PanelOptions = {}) {
  render(<TokensPanel groups={buildTokenGroups(tokens)} blocker={blocker} onSend={onSend} />);
  return { panel: screen.getByRole('region', { name: 'Your tokens' }), onSend };
}

const chipRow = (panel: HTMLElement) => within(panel).getByRole('group', { name: 'Token tier' });
const cards = (panel: HTMLElement) => within(panel).queryAllByRole('listitem');
const cardTitles = (panel: HTMLElement) => cards(panel).map((card) => card.querySelector('.rq-duels-token__what')?.textContent);
const cardStakes = (panel: HTMLElement) => cards(panel).map((card) => card.querySelector('.rq-duels-token__stake')?.textContent);

describe('Your tokens', () => {
  it('always shows three tier chips, and starts on the first tier that has tokens', () => {
    const { panel } = renderPanel(ONLY_LEGENDARY);
    const chips = within(chipRow(panel)).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['Minor ×0', 'Major ×0', 'Legendary ×1']);
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(cardTitles(panel)).toEqual(['Most XP · 21 days']);
  });

  it('choosing a tier chip filters the token list', async () => {
    const user = userEvent.setup();
    const { panel } = renderPanel();
    expect(cardTitles(panel)).toEqual(['Most km · 7 days', 'Most runs · 5 days', 'Most XP · 3 days']);

    await user.click(within(panel).getByRole('button', { name: 'Legendary ×1' }));
    expect(within(panel).getByRole('button', { name: 'Legendary ×1' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('button', { name: 'Minor ×3' })).toHaveAttribute('aria-pressed', 'false');
    expect(cardTitles(panel)).toEqual(['Most XP · 21 days']);

    await user.click(within(panel).getByRole('button', { name: 'Major ×1' }));
    expect(cardTitles(panel)).toEqual(['Most km · 10 days']);
  });

  it('every card shows its own stake, and a legendary card shows its penalty', async () => {
    const user = userEvent.setup();
    // Två tokens på samma nivå med olika insats (dag- och rundboost), och en legendary utan straff: ett kort som läser ett annat korts insats fäller testet.
    const mixed = [
      token({ id: 'a', tier: 'minor', metric: 'km', duration_days: 7 }),
      token({ id: 'b', tier: 'minor', metric: 'runs', duration_days: 5, winner_delta: 0.2, winner_duration: 3, winner_type: 'multiplier_runs', loser_delta: -0.1, loser_duration: 1, loser_type: 'multiplier_runs' }),
      token({ id: 'c', tier: 'major', metric: 'km', duration_days: 10 }),
      token({ id: 'd', tier: 'legendary', metric: 'total_xp', duration_days: 30, loser_delta: 0, loser_duration: 0 }),
    ];
    const { panel } = renderPanel(mixed);
    expect(cardStakes(panel)).toEqual(['+0.15× for 5 days · −0.07× for 5 days', '+0.2× for 3 runs · −0.1× for 1 run']);

    await user.click(within(panel).getByRole('button', { name: 'Major ×1' }));
    expect(cardStakes(panel)).toEqual(['+0.25× for 10 days · −0.12× for 10 days']);

    await user.click(within(panel).getByRole('button', { name: 'Legendary ×1' }));
    expect(cardStakes(panel)).toEqual(['+0.5× for 14 days · No penalty']);
  });

  it('a legendary card shows its penalty when it has one', async () => {
    const user = userEvent.setup();
    const { panel } = renderPanel();
    await user.click(within(panel).getByRole('button', { name: 'Legendary ×1' }));
    expect(cardStakes(panel)).toEqual(['+0.5× for 14 days · −0.25× for 14 days']);
  });

  it('an empty tier chip is aria-disabled, shows ×0 and explains itself', async () => {
    const user = userEvent.setup();
    const { panel } = renderPanel(NO_MAJOR);
    const major = within(panel).getByRole('button', { name: 'Major ×0' });
    expect(major).toHaveAttribute('aria-disabled', 'true');
    expect(major).not.toBeDisabled();
    expect(within(panel).getByRole('status')).toBeEmptyDOMElement();

    await user.click(major);
    expect(within(panel).getByRole('status')).toHaveTextContent('No Major tokens right now');
    // Den tomma nivån blir aldrig vald: listan visar fortfarande nivån som var vald.
    expect(major).toHaveAttribute('aria-pressed', 'false');
    expect(cardTitles(panel)).toEqual(['Most km · 7 days', 'Most runs · 5 days', 'Most XP · 3 days']);

    // Förklaringen försvinner när en nivå med tokens väljs, och nås även med tangentbordet.
    await user.click(within(panel).getByRole('button', { name: 'Legendary ×1' }));
    expect(within(panel).getByRole('status')).toBeEmptyDOMElement();
    major.focus();
    await user.keyboard('{Enter}');
    expect(within(panel).getByRole('status')).toHaveTextContent('No Major tokens right now');
  });

  it('without any tokens the panel keeps the three chips and says how to get tokens', () => {
    const { panel } = renderPanel([]);
    expect(within(chipRow(panel)).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['Minor ×0', 'Major ×0', 'Legendary ×0']);
    expect(within(panel).queryAllByRole('button', { pressed: true })).toEqual([]);
    expect(within(panel).getByText('No tokens to send. You earn them by levelling up.')).toBeInTheDocument();
    expect(cards(panel)).toEqual([]);
  });

  it('the panel has no "One token, one challenge" help text', () => {
    renderPanel();
    expect(screen.queryByText(/One token, one challenge/)).toBeNull();
  });

  it('Send on a card hands that tier and that token on to the send flow', async () => {
    const user = userEvent.setup();
    const { panel, onSend } = renderPanel();
    await user.click(within(panel).getByRole('button', { name: 'Send a minor challenge: Most runs, 5 days' }));
    expect(onSend).toHaveBeenLastCalledWith({ tier: 'minor', tokenKey: 't-minor-runs' });

    await user.click(within(panel).getByRole('button', { name: 'Major ×1' }));
    await user.click(within(panel).getByRole('button', { name: 'Send a major challenge: Most km, 10 days' }));
    expect(onSend).toHaveBeenLastCalledWith({ tier: 'major', tokenKey: 't-major' });
  });

  it('the Send button names the tier, the metric and the length', () => {
    const { panel } = renderPanel();
    const sends = within(panel).getAllByRole('button', { name: /^Send/ });
    expect(sends.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Send a minor challenge: Most km, 7 days',
      'Send a minor challenge: Most runs, 5 days',
      'Send a minor challenge: Most XP, 3 days',
    ]);
    expect(sends.map((button) => button.textContent)).toEqual(['Send', 'Send', 'Send']);
  });

  it('two identical tokens give two cards and two Send buttons, and the second sends its own id', async () => {
    const user = userEvent.setup();
    const twins = [
      token({ id: 'twin-1', tier: 'minor', metric: 'km', duration_days: 7 }),
      token({ id: 'twin-2', tier: 'minor', metric: 'km', duration_days: 7 }),
    ];
    const { panel, onSend } = renderPanel(twins);
    expect(cards(panel)).toHaveLength(2);
    const buttons = within(panel).getAllByRole('button', { name: 'Send a minor challenge: Most km, 7 days' });
    expect(buttons).toHaveLength(2);

    await user.click(buttons[1]);
    expect(onSend).toHaveBeenLastCalledWith({ tier: 'minor', tokenKey: 'twin-2' });
    await user.click(buttons[0]);
    expect(onSend).toHaveBeenLastCalledWith({ tier: 'minor', tokenKey: 'twin-1' });
  });

  it('while sending is blocked the Send buttons are locked and the reason stands under the list', async () => {
    const user = userEvent.setup();
    const blocker: SendBlocker = { reason: 'live', message: 'You are in a live duel. You can send another one once it is settled.' };
    const { panel, onSend } = renderPanel(ONLY_LEGENDARY, { blocker });
    const send = within(panel).getByRole('button', { name: 'Send a legendary challenge: Most XP, 21 days' });
    expect(send).toBeDisabled();
    await user.click(send);
    expect(onSend).not.toHaveBeenCalled();
    expect(within(panel).getByText(blocker.message)).toBeInTheDocument();
    // Filtret fungerar ändå: bara Send är låst.
    expect(within(panel).getByRole('button', { name: 'Legendary ×1' })).toBeEnabled();
  });

  it('a tier that runs out of tokens hands the list over to the first tier that still has some', () => {
    const view = render(<TokensPanel groups={buildTokenGroups(ALL_TIERS)} blocker={null} onSend={() => {}} />);
    view.rerender(<TokensPanel groups={buildTokenGroups(ONLY_LEGENDARY)} blocker={null} onSend={() => {}} />);
    const panel = screen.getByRole('region', { name: 'Your tokens' });
    expect(within(panel).getByRole('button', { name: 'Legendary ×1' })).toHaveAttribute('aria-pressed', 'true');
    expect(cardTitles(panel)).toEqual(['Most XP · 21 days']);
  });
});
