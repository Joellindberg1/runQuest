import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STRAVA_CONSENT_KEY_POINTS, getDataPolicySection } from '@runquest/shared';
import { renderWithApp } from '@/test/renderApp';
import { buildStravaCard, type StravaStatusInput } from '../settingsModel';
import { PAUSE_CHOICE, STILL_REMOVED_SENTENCE } from '../stravaConnectionCopy';
import { StravaCard, type StravaConnectionControls } from './StravaCard';

const NOW = new Date('2026-10-14T12:00:00Z');
const NOT_CONNECTED: StravaStatusInput = { connected: false, expired: false };
const EXPIRED: StravaStatusInput = { connected: true, expired: true };
const CONNECTED: StravaStatusInput = { connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z' };

const STRAVA_SECTION = getDataPolicySection('strava')!;
const CONSENT_REGION = 'What happens to your Strava data';
const AGREE_LABEL = "I've read this and agree that RunQuest imports my Strava runs as described";

const PAUSED: StravaStatusInput = { ...CONNECTED, sync_paused: true, paused_at: '2026-10-12T08:30:00+00:00' };

/** Kortets åtgärder som den som monterar det ger dem; varje åtgärd lyckas om inget annat sägs. */
function controls(over: Partial<StravaConnectionControls> = {}): StravaConnectionControls {
  return {
    stravaRuns: 128, busy: null, error: null,
    onPause: vi.fn().mockResolvedValue(true), onResume: vi.fn().mockResolvedValue(true), onDisconnect: vi.fn().mockResolvedValue(true), onClearError: vi.fn(),
    ...over,
  };
}

function renderCard(status: StravaStatusInput, props: { canSyncNow?: boolean; onConnect?: (agreed: boolean) => void; connection?: StravaConnectionControls } = {}) {
  return renderWithApp(
    <StravaCard
      view={buildStravaCard(status, undefined, NOW)}
      canSyncNow={props.canSyncNow ?? false}
      syncing={false}
      status={null}
      error={null}
      onConnect={props.onConnect ?? vi.fn()}
      connection={props.connection ?? controls()}
      onSync={vi.fn()}
    />,
  );
}

const consent = () => screen.getByRole('region', { name: CONSENT_REGION });
const agreeBox = () => screen.getByRole('checkbox', { name: AGREE_LABEL });
const pointsList = () => within(consent()).getByRole('list', { name: 'The four things to know before you connect' });

describe('StravaCard consent', () => {
  it('connect button is disabled until the consent checkbox is checked', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    renderCard(NOT_CONNECTED, { onConnect });
    const button = screen.getByRole('button', { name: 'Connect Strava' });
    const box = agreeBox();

    expect(box).not.toBeChecked();
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onConnect).not.toHaveBeenCalled();

    await user.click(box);
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(true);

    await user.click(box);
    expect(button).toBeDisabled();
  });

  it('asks for the same agreement before reconnecting an expired connection', async () => {
    const user = userEvent.setup();
    renderCard(EXPIRED);
    const button = screen.getByRole('button', { name: 'Reconnect Strava' });

    expect(button).toBeDisabled();
    await user.click(agreeBox());
    expect(button).toBeEnabled();
  });

  it('consent block renders the strava section from the shared policy source', () => {
    renderCard(NOT_CONNECTED);
    const block = within(consent());

    expect(STRAVA_SECTION.paragraphs.length).toBeGreaterThan(1);
    for (const paragraph of STRAVA_SECTION.paragraphs) expect(block.getByText(paragraph)).toBeInTheDocument();
    expect(block.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/legal#privacy');
  });

  it('shows the four key points word for word from the shared source, as a list before the checkbox', () => {
    renderCard(NOT_CONNECTED);
    const items = within(pointsList()).getAllByRole('listitem');

    expect(items).toHaveLength(STRAVA_CONSENT_KEY_POINTS.length);
    STRAVA_CONSENT_KEY_POINTS.forEach((point, index) => {
      expect(items[index]).toHaveTextContent(point.sentences.join(' '), { normalizeWhitespace: true });
      expect(items[index]).toBeVisible();
    });
    expect(pointsList().compareDocumentPosition(agreeBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('consent text states what is imported, that removed or private activities are removed within 48 hours, that disconnecting deletes imported runs and that sync can be paused', () => {
    renderCard(NOT_CONNECTED);
    // Synliga före rutan: kraven prövas på de synliga punkterna, inte på texten som ligger hopfälld i DOM:en.
    const visibleItem = (pattern: RegExp) => expect(within(pointsList()).getByText(pattern, { selector: 'li' })).toBeVisible();

    visibleItem(/running activities are imported/i);
    visibleItem(/start coordinates are used only to look up the weather/i);
    visibleItem(/revoke RunQuest's access on Strava instead[^]*tokens are deleted here/i);
    visibleItem(/delete[^]*private[^]*no longer a run[^]*within 48 ?(hours|h)\b/i);
    visibleItem(/"Disconnect"[^]*deletes all runs that were imported from Strava/i);
    visibleItem(/cannot be undone[^]*not fetched back/i);
    visibleItem(/pause sync[^]*no new runs are fetched/i);
  });

  it('connected users see the consent text as information', () => {
    renderCard(CONNECTED);
    const block = within(consent());

    for (const paragraph of STRAVA_SECTION.paragraphs) expect(block.getByText(paragraph)).toBeInTheDocument();
    expect(block.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/legal#privacy');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Strava/ })).not.toBeInTheDocument();
  });

  it('connected users have the consent text collapsed and above the actions, so the actions can grow without moving it', async () => {
    const user = userEvent.setup();
    renderCard(CONNECTED, { canSyncNow: true });
    const toggle = within(consent()).getByText(CONSENT_REGION, { selector: 'summary' });

    expect(toggle.closest('details')).not.toHaveAttribute('open');
    await user.click(toggle);
    expect(toggle.closest('details')).toHaveAttribute('open');
    expect(consent().compareDocumentPosition(screen.getByRole('button', { name: 'Sync now' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('folds the full text behind a Read the full text toggle, so the checkbox needs no scrolling through all of it', async () => {
    const user = userEvent.setup();
    renderCard(NOT_CONNECTED);
    const more = within(consent()).getByText(/^Read the full text/, { selector: 'summary' });
    const lastParagraph = within(consent()).getByText(STRAVA_SECTION.paragraphs[STRAVA_SECTION.paragraphs.length - 1]);

    expect(lastParagraph).not.toBeVisible();
    await user.click(more);
    expect(lastParagraph).toBeVisible();
  });

  it('starts unticked again when the connection changes state, for example after a later disconnect', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [status, setStatus] = useState<StravaStatusInput>(NOT_CONNECTED);
      return (
        <>
          <button type="button" onClick={() => setStatus(CONNECTED)}>go connected</button>
          <button type="button" onClick={() => setStatus(NOT_CONNECTED)}>go disconnected</button>
          <StravaCard view={buildStravaCard(status, undefined, NOW)} canSyncNow={false} syncing={false} status={null} error={null} connection={controls()} onConnect={vi.fn()} onSync={vi.fn()} />
        </>
      );
    }
    renderWithApp(<Harness />);

    await user.click(agreeBox());
    expect(agreeBox()).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'go connected' }));
    await user.click(screen.getByRole('button', { name: 'go disconnected' }));

    expect(agreeBox()).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Connect Strava' })).toBeDisabled();
  });
});

const heading = () => screen.getByRole('heading', { level: 2, name: 'Strava' });
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

describe('StravaCard pause or disconnect while sync runs', () => {
  it('while sync runs the pause or disconnect button opens a dialog with both choices and one sentence per choice', async () => {
    const user = userEvent.setup();
    renderCard(CONNECTED, { canSyncNow: true });

    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));

    const dialog = screen.getByRole('dialog', { name: 'Pause or disconnect' });
    const pause = within(dialog).getByRole('region', { name: 'Pause sync' });
    const disconnect = within(dialog).getByRole('region', { name: 'Disconnect' });
    expect(within(pause).getByRole('button', { name: 'Pause sync' })).toBeInTheDocument();
    expect(within(disconnect).getByRole('button', { name: 'Disconnect…' })).toBeInTheDocument();
    for (const choice of [pause, disconnect]) {
      const text = choice.querySelector('p')?.textContent ?? '';
      expect(sentences(text)).toHaveLength(1);
    }
  });

  it('the pause choice or the paused card states that runs removed or made private on Strava are still removed here', async () => {
    const user = userEvent.setup();
    const running = renderCard(CONNECTED);
    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));
    expect(within(screen.getByRole('region', { name: 'Pause sync' })).getByText(PAUSE_CHOICE.text)).toHaveTextContent(/still removed here/);
    running.unmount();

    renderCard(PAUSED);
    expect(screen.getByRole('region', { name: 'Strava' })).toHaveTextContent(STILL_REMOVED_SENTENCE);
    expect(screen.getByRole('region', { name: 'Strava' })).toHaveTextContent('Paused since 12 October 2026.');
  });

  it('offers it to every connected user, not only the ones who can sync now', () => {
    renderCard(CONNECTED, { canSyncNow: false });

    expect(screen.getByRole('button', { name: 'Pause or disconnect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('has no pause or disconnect without a live connection', () => {
    for (const status of [NOT_CONNECTED, EXPIRED]) {
      const { unmount } = renderCard(status);
      expect(screen.queryByRole('button', { name: /pause|disconnect/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('pause sync asks the owner of the card to pause, then closes the dialog and moves focus to the card heading', async () => {
    const user = userEvent.setup();
    const connection = controls();
    renderCard(CONNECTED, { connection });
    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Pause sync' }));

    expect(connection.onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(heading()).toHaveFocus();
    expect(heading()).toHaveAttribute('tabindex', '-1');
  });

  it('a failed pause keeps the dialog open and leaves focus where it was', async () => {
    const user = userEvent.setup();
    renderCard(CONNECTED, { connection: controls({ onPause: vi.fn().mockResolvedValue(false), error: "Couldn't pause sync. Try again." }) });
    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Pause sync' }));

    expect(screen.getByRole('dialog', { name: 'Pause or disconnect' })).toBeInTheDocument();
    // Knappen är aldrig natively disabled (en disabled knapp som har fokus tappar det i webbläsaren), så fokus står kvar på den.
    expect(screen.getByRole('button', { name: 'Pause sync' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause sync' })).toHaveFocus();
    expect(within(screen.getByRole('dialog')).getByRole('alert', { name: 'Strava connection error' })).toHaveTextContent("Couldn't pause sync. Try again.");
  });

  it('moving from the choice to the confirmation puts focus on Keep my connection', async () => {
    const user = userEvent.setup();
    renderCard(CONNECTED);
    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));

    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));

    expect(screen.queryByRole('dialog', { name: 'Pause or disconnect' })).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: 'Disconnect Strava?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep my connection' })).toHaveFocus();
  });

  it('cancelling returns focus to the button that opened the dialog', async () => {
    const user = userEvent.setup();
    const connection = controls();
    renderCard(CONNECTED, { connection });
    const opener = screen.getByRole('button', { name: 'Pause or disconnect' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));
    await user.click(screen.getByRole('button', { name: 'Keep my connection' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(connection.onDisconnect).not.toHaveBeenCalled();
    expect(connection.onPause).not.toHaveBeenCalled();
  });

  it('a confirmed disconnect closes the dialog and moves focus to the card heading', async () => {
    const user = userEvent.setup();
    const connection = controls();
    renderCard(CONNECTED, { connection });
    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));

    await user.click(screen.getByRole('button', { name: 'Disconnect and delete 128 runs' }));

    expect(connection.onDisconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(heading()).toHaveFocus();
  });

  it('a failed disconnect keeps the confirmation open', async () => {
    const user = userEvent.setup();
    const connection = controls({ onDisconnect: vi.fn().mockResolvedValue(false), error: "Couldn't disconnect. Try again." });
    renderCard(CONNECTED, { connection });
    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));

    await user.click(screen.getByRole('button', { name: 'Disconnect and delete 128 runs' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(screen.getByRole('alertdialog')).getByRole('alert', { name: 'Strava connection error' })).toHaveTextContent("Couldn't disconnect. Try again.");
  });

  it('starts every opening without the previous error', async () => {
    const user = userEvent.setup();
    const connection = controls({ error: "Couldn't pause sync. Try again." });
    renderCard(CONNECTED, { connection });

    await user.click(screen.getByRole('button', { name: 'Pause or disconnect' }));

    expect(connection.onClearError).toHaveBeenCalled();
  });
});

describe('StravaCard when sync is paused', () => {
  it('a paused user sees a neutral Paused chip on the Strava card, not silver', () => {
    renderCard(PAUSED);

    const card = screen.getByRole('region', { name: 'Strava' });
    expect(within(card).getByText('Paused', { selector: 'p' })).toBeInTheDocument();
    // Tonen är en neutral bläcktoning; att den inte är silver (placering 2) vaktas av Stylelint (settings.css får inte läsa silvertokens).
    expect(card).toHaveAttribute('data-tone', 'paused');
    expect(within(card).queryByText('Connected', { selector: 'p' })).not.toBeInTheDocument();
    expect(within(card).getByText('Next sync').nextElementSibling).toHaveTextContent('Paused');
  });

  it('the paused card shows Turn sync back on and Disconnect and no Pause or disconnect button', () => {
    renderCard(PAUSED, { canSyncNow: true });

    const card = screen.getByRole('region', { name: 'Strava' });
    expect(within(card).getByRole('button', { name: 'Turn sync back on' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: 'Pause or disconnect' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('Disconnect on the paused card goes straight to the confirmation', async () => {
    const user = userEvent.setup();
    const connection = controls();
    renderCard(PAUSED, { connection });

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(screen.getByRole('alertdialog', { name: 'Disconnect Strava?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Pause or disconnect' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep my connection' })).toHaveFocus();
    expect(connection.onDisconnect).not.toHaveBeenCalled();
  });

  it('cancelling that confirmation returns focus to the Disconnect button on the card', async () => {
    const user = userEvent.setup();
    renderCard(PAUSED);
    const opener = screen.getByRole('button', { name: 'Disconnect' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Keep my connection' }));

    expect(opener).toHaveFocus();
  });

  it('Turn sync back on resumes and moves focus to the card heading, since the button is replaced', async () => {
    const user = userEvent.setup();
    const connection = controls();
    renderCard(PAUSED, { connection });

    await user.click(screen.getByRole('button', { name: 'Turn sync back on' }));

    expect(connection.onResume).toHaveBeenCalledTimes(1);
    expect(heading()).toHaveFocus();
  });

  it('a failed resume leaves focus on its button', async () => {
    const user = userEvent.setup();
    renderCard(PAUSED, { connection: controls({ onResume: vi.fn().mockResolvedValue(false) }) });
    const button = screen.getByRole('button', { name: 'Turn sync back on' });

    await user.click(button);

    expect(button).toHaveFocus();
  });

  it('says Turning sync on and locks the buttons while the resume request runs', async () => {
    renderCard(PAUSED, { connection: controls({ busy: 'resume' }) });

    const resume = screen.getByRole('button', { name: 'Turning sync on…' });
    const disconnect = screen.getByRole('button', { name: 'Disconnect' });
    // aria-disabled i stället för disabled: knappen som har fokus får inte tappa det när anropet startar.
    for (const button of [resume, disconnect]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
    }
    const user = userEvent.setup();
    const connection = controls({ busy: 'resume' });
    cleanup();
    renderCard(PAUSED, { connection });
    await user.click(screen.getByRole('button', { name: 'Turning sync on…' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(connection.onResume).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows a static dot on the Paused chip, while the Connected chip has the blinking live dot', () => {
    const paused = renderCard(PAUSED);
    expect(paused.container.querySelector('.rq-dot--live')).toBeNull();
    expect(paused.container.querySelector('.rq-chip .rq-dot')).not.toBeNull();
    paused.unmount();

    const running = renderCard(CONNECTED);
    expect(running.container.querySelector('.rq-chip .rq-dot--live')).not.toBeNull();
  });

  it('has no Connect or Reconnect button, and no consent checkbox, on the paused card', () => {
    renderCard(PAUSED);

    // Exakt de två knapparna, inga fler (en Connect-knapp utan etikett skulle annars slinka förbi en namnsökning).
    const card = screen.getByRole('region', { name: 'Strava' });
    expect(within(card).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Turn sync back on', 'Disconnect']);
    expect(screen.queryByRole('button', { name: /connect strava/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('an expired connection is expired even if the pause flag is still set', () => {
    renderCard({ ...EXPIRED, sync_paused: true });

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn sync back on' })).not.toBeInTheDocument();
  });

  it('shows the consent text as information on the paused card too, above the actions', () => {
    renderCard(PAUSED);

    const consent = screen.getByRole('region', { name: CONSENT_REGION });
    expect(consent.compareDocumentPosition(screen.getByRole('button', { name: 'Turn sync back on' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
