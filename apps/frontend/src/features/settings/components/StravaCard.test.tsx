import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDataPolicySection } from '@runquest/shared';
import { renderWithApp } from '@/test/renderApp';
import { buildStravaCard, type StravaStatusInput } from '../settingsModel';
import { StravaCard } from './StravaCard';

const NOW = new Date('2026-10-14T12:00:00Z');
const NOT_CONNECTED: StravaStatusInput = { connected: false, expired: false };
const EXPIRED: StravaStatusInput = { connected: true, expired: true };
const CONNECTED: StravaStatusInput = { connected: true, expired: false, connection_date: '2026-08-25T09:31:00Z' };

const STRAVA_SECTION = getDataPolicySection('strava')!;
const CONSENT_REGION = 'What happens to your Strava data';

function renderCard(status: StravaStatusInput, props: { canSyncNow?: boolean; onConnect?: () => void } = {}) {
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
// Texten ligger i DOM:en också när "Read more" är hopfälld; kraven prövas mot det som renderas, med samma normalisering som dataPolicy.test.ts.
const straighten = (text: string) => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n/).map((sentence) => sentence.trim()).filter(Boolean);
const renderedText = () => straighten(within(consent()).getAllByText(/./, { selector: 'p' }).map((paragraph) => paragraph.textContent).join('\n'));

describe('StravaCard consent', () => {
  it('connect button is disabled until the consent checkbox is checked', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    renderCard(NOT_CONNECTED, { onConnect });
    const button = screen.getByRole('button', { name: 'Connect Strava' });
    const box = screen.getByRole('checkbox', { name: 'I understand and agree' });

    expect(box).not.toBeChecked();
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onConnect).not.toHaveBeenCalled();

    await user.click(box);
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onConnect).toHaveBeenCalledTimes(1);

    await user.click(box);
    expect(button).toBeDisabled();
  });

  it('asks for the same agreement before reconnecting an expired connection', async () => {
    const user = userEvent.setup();
    renderCard(EXPIRED);
    const button = screen.getByRole('button', { name: 'Reconnect Strava' });

    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I understand and agree' }));
    expect(button).toBeEnabled();
  });

  it('consent block renders the strava section from the shared policy source', () => {
    renderCard(NOT_CONNECTED);
    const block = within(consent());

    expect(STRAVA_SECTION.paragraphs.length).toBeGreaterThan(1);
    for (const paragraph of STRAVA_SECTION.paragraphs) expect(block.getByText(paragraph)).toBeInTheDocument();
    expect(block.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/legal#privacy');
  });

  it('consent text states what is imported, that removed or private activities are removed within 48 hours, that disconnecting deletes imported runs and that sync can be paused', () => {
    renderCard(NOT_CONNECTED);
    const sentences = sentencesOf(renderedText());
    const expectSentence = (...patterns: RegExp[]) =>
      expect(sentences.some((sentence) => patterns.every((pattern) => pattern.test(sentence))), `a sentence matching ${patterns.join(" and ")}`).toBe(true);

    expectSentence(/running activities/i, /imported/i);
    expectSentence(/delete/i, /private/i, /within 48 ?(hours|h)\b/i);
    expectSentence(/Disconnect/i, /delete/i, /imported from Strava/i);
    expectSentence(/cannot be undone/i);
    expectSentence(/not fetched back/i);
    expectSentence(/pause sync/i, /no new runs/i);
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

  it('folds the long text behind a Read more toggle, so the checkbox needs no scrolling through all of it', async () => {
    const user = userEvent.setup();
    renderCard(NOT_CONNECTED);
    const more = within(consent()).getByText(/^Read the full text/, { selector: 'summary' });
    const box = screen.getByRole('checkbox', { name: 'I understand and agree' });

    expect(more.closest('details')).not.toHaveAttribute('open');
    expect(box).toBeInTheDocument();
    await user.click(more);
    expect(more.closest('details')).toHaveAttribute('open');
  });
});
