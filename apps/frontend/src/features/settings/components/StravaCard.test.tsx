import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STRAVA_CONSENT_KEY_POINTS, getDataPolicySection } from '@runquest/shared';
import { renderWithApp } from '@/test/renderApp';
import { buildStravaCard, type StravaStatusInput } from '../settingsModel';
import { StravaCard } from './StravaCard';

const NOW = new Date('2026-10-14T12:00:00Z');
const NOT_CONNECTED: StravaStatusInput = { connected: false, expired: false };
const EXPIRED: StravaStatusInput = { connected: true, expired: true };
const CONNECTED: StravaStatusInput = { connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z' };

const STRAVA_SECTION = getDataPolicySection('strava')!;
const CONSENT_REGION = 'What happens to your Strava data';
const AGREE_LABEL = "I've read this and agree that RunQuest imports my Strava runs as described";

function renderCard(status: StravaStatusInput, props: { canSyncNow?: boolean; onConnect?: (agreed: boolean) => void } = {}) {
  return renderWithApp(
    <StravaCard
      view={buildStravaCard(status, undefined, NOW)}
      canSyncNow={props.canSyncNow ?? false}
      syncing={false}
      status={null}
      error={null}
      onConnect={props.onConnect ?? vi.fn()}
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
          <StravaCard view={buildStravaCard(status, undefined, NOW)} canSyncNow={false} syncing={false} status={null} error={null} onConnect={vi.fn()} onSync={vi.fn()} />
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
