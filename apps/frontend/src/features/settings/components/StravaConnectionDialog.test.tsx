import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DISCONNECT_WARNING } from '../stravaConnectionCopy';
import { StravaConnectionDialog, type ConnectionStep } from './StravaConnectionDialog';

type Props = Parameters<typeof StravaConnectionDialog>[0];

function renderDialog(step: ConnectionStep, props: Partial<Props> = {}) {
  const handlers = {
    onPause: vi.fn(), onChooseDisconnect: vi.fn(), onConfirmDisconnect: vi.fn(), onCancel: vi.fn(), onCloseAutoFocus: vi.fn(),
  };
  render(<StravaConnectionDialog step={step} stravaRuns={128} busy={null} error={null} {...handlers} {...props} />);
  return handlers;
}

describe('StravaConnectionDialog choice step', () => {
  it('is a labelled dialog with the two choices as separate groups', () => {
    renderDialog('choose');
    const dialog = screen.getByRole('dialog', { name: 'Pause or disconnect' });

    expect(within(dialog).getByRole('region', { name: 'Pause sync' })).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Disconnect' })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('Two ways to stop new runs from Strava coming in.');
  });

  it('Pause sync, Disconnect… and Cancel each call their own handler', async () => {
    const user = userEvent.setup();
    const handlers = renderDialog('choose');

    await user.click(screen.getByRole('button', { name: 'Pause sync' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(handlers.onPause).toHaveBeenCalledTimes(1);
    expect(handlers.onChooseDisconnect).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirmDisconnect).not.toHaveBeenCalled();
  });

  it('locks every action while a request runs, says what is running and ignores Escape', async () => {
    const user = userEvent.setup();
    const handlers = renderDialog('choose', { busy: 'pause' });

    // aria-disabled, inte disabled: en disabled knapp som har fokus tappar det i webbläsaren.
    const locked = ['Pausing…', 'Disconnect…', 'Cancel', 'Close'].map((name) => screen.getByRole('button', { name }));
    for (const button of locked) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
    }
    for (const button of locked) await user.click(button);
    expect(handlers.onPause).not.toHaveBeenCalled();
    expect(handlers.onChooseDisconnect).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('closes on a click outside, but not while a request runs', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const idle = renderDialog('choose');
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement);
    expect(idle.onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores a click outside while a request runs', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const handlers = renderDialog('choose', { busy: 'pause' });

    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement);

    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a failure in its own alert region inside the dialog', () => {
    renderDialog('choose', { error: "Couldn't pause sync. Try again." });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert', { name: 'Strava connection error' })).toHaveTextContent("Couldn't pause sync. Try again.");
  });

  it('has the alert region in the dialog before any error exists', () => {
    renderDialog('choose');

    expect(within(screen.getByRole('dialog')).getByRole('alert', { name: 'Strava connection error' })).toBeEmptyDOMElement();
  });
});

describe('StravaConnectionDialog confirmation step', () => {
  it('the confirmation is an alertdialog with initial focus on Keep my connection', () => {
    renderDialog('confirm');

    const dialog = screen.getByRole('alertdialog', { name: 'Disconnect Strava?' });
    expect(within(dialog).getByRole('button', { name: 'Keep my connection' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Pause or disconnect' })).not.toBeInTheDocument();
  });

  it('is described by what happens and what stays, so the explanation is read with the title', () => {
    renderDialog('confirm', { stravaRuns: 3 });

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleDescription(/RunQuest asks Strava to revoke its access/);
    expect(dialog).toHaveAccessibleDescription(/All 3 runs that came from Strava are deleted/);
    expect(dialog).toHaveAccessibleDescription(/Runs you logged by hand/);
  });

  it('the confirmation step states that it cannot be undone and that history does not come back', () => {
    renderDialog('confirm');

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(DISCONNECT_WARNING)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/cannot be undone/);
    expect(dialog).toHaveTextContent(/not fetched back and syncing starts from that day/);
  });

  it('keeps the explanation and the cannot-be-undone warning out of the choice step', () => {
    renderDialog('choose');

    expect(screen.getByRole('dialog')).not.toHaveTextContent(/undone|not fetched back|from that day|revoke/i);
  });

  it('asks for the destructive action only with the explicit button', async () => {
    const user = userEvent.setup();
    const handlers = renderDialog('confirm');

    await user.click(screen.getByRole('button', { name: 'Disconnect and delete 128 runs' }));

    expect(handlers.onConfirmDisconnect).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).not.toHaveBeenCalled();
  });

  it('writes no number when the runs are not known, and never zero', () => {
    renderDialog('confirm', { stravaRuns: null });

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Disconnect and delete all Strava runs' })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/\b0\b/);
  });

  it('is not dismissed by a click outside it, only by an explicit choice or Escape', async () => {
    // Radix stänger av pekhändelser utanför dialogen; klicket skickas ändå, som en användare som trycker på mörkläggningen.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const handlers = renderDialog('confirm');

    // Mörkläggningen ligger närmast före dialogen i portalen.
    await user.click(screen.getByRole('alertdialog').previousElementSibling as HTMLElement);
    expect(handlers.onCancel).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a failure in its own alert region and stays open', () => {
    renderDialog('confirm', { error: "Couldn't disconnect. Try again." });

    expect(within(screen.getByRole('alertdialog')).getByRole('alert', { name: 'Strava connection error' })).toHaveTextContent("Couldn't disconnect. Try again.");
  });

  it('says Disconnecting while the request runs and locks both buttons, without ever disabling the focused one', async () => {
    const user = userEvent.setup();
    const handlers = renderDialog('confirm', { busy: 'disconnect' });

    expect(screen.getByRole('button', { name: 'Disconnecting…' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Keep my connection' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Keep my connection' }));
    await user.click(screen.getByRole('button', { name: 'Disconnecting…' }));
    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(handlers.onConfirmDisconnect).not.toHaveBeenCalled();
  });

  it('ignores Escape and a click outside while the disconnect request runs', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const handlers = renderDialog('confirm', { busy: 'disconnect' });

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('alertdialog').previousElementSibling as HTMLElement);

    expect(handlers.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('StravaConnectionDialog focus and keyboard', () => {
  it('the dialog traps focus and closes on Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <>
        <button type="button">Before the dialog</button>
        <StravaConnectionDialog step="confirm" stravaRuns={128} busy={null} error={null} onPause={vi.fn()} onChooseDisconnect={vi.fn()} onConfirmDisconnect={vi.fn()} onCancel={onCancel} onCloseAutoFocus={vi.fn()} />
        <button type="button">After the dialog</button>
      </>,
    );
    const dialog = screen.getByRole('alertdialog');
    const before = screen.getByRole('button', { name: 'Before the dialog', hidden: true });
    const after = screen.getByRole('button', { name: 'After the dialog', hidden: true });

    // Bakgrunden är inert för hjälpmedel (Radix döljer allt utanför dialogen) och fokus kan aldrig lämna dialogen, framåt som bakåt.
    expect(screen.queryByRole('button', { name: 'Before the dialog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'After the dialog' })).not.toBeInTheDocument();
    for (let presses = 0; presses < 8; presses += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect([before, after]).not.toContain(document.activeElement);
    }
    for (let presses = 0; presses < 8; presses += 1) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect([before, after]).not.toContain(document.activeElement);
    }

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes the choice step on Escape too', async () => {
    const user = userEvent.setup();
    const handlers = renderDialog('choose');

    await user.keyboard('{Escape}');

    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    renderDialog(null);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
