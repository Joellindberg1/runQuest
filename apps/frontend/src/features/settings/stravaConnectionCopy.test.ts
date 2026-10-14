import { describe, expect, it } from 'vitest';
import { getDataPolicySection } from '@runquest/shared';
import {
  DELETED_EVEN_IF_NO_ANSWER_SENTENCE,
  DISCONNECT_WARNING,
  PAUSE_CHOICE,
  STILL_REMOVED_SENTENCE,
  buildDisconnectConfirmation,
} from './stravaConnectionCopy';

const STRAVA_POLICY = getDataPolicySection('strava')!.paragraphs.join('\n');
const confirmationText = (runs: number | null) => {
  const { happens, stays, warning } = buildDisconnectConfirmation(runs);
  return [...happens, ...stays, warning].join(' ');
};

describe('the disconnect confirmation copy', () => {
  it('builds the button text from the count, in singular and plural', () => {
    expect(buildDisconnectConfirmation(128).action).toBe('Disconnect and delete 128 runs');
    expect(buildDisconnectConfirmation(1).action).toBe('Disconnect and delete 1 run');
    expect(buildDisconnectConfirmation(128).happens).toContain('All 128 runs that came from Strava are deleted, together with your stored Strava tokens.');
  });

  it('never states a number it does not know: unloaded runs give a button without a count, not zero', () => {
    const unknown = buildDisconnectConfirmation(null);
    expect(unknown.action).toBe('Disconnect and delete all Strava runs');
    expect(`${unknown.action} ${unknown.happens.join(' ')}`).not.toMatch(/\d/);
  });

  it('with no strava runs it does not offer to delete zero runs', () => {
    const none = buildDisconnectConfirmation(0);
    expect(none.action).toBe('Disconnect');
    expect(none.happens.join(' ')).not.toMatch(/recalculated/);
  });

  it('asks Strava to revoke access and never promises that access is revoked', () => {
    for (const runs of [null, 0, 1, 128]) {
      const text = confirmationText(runs);
      expect(text).toMatch(/asks Strava to revoke its access/);
      expect(text).not.toMatch(/\b(we|RunQuest) revokes?\b|\bis revoked\b|\bwas revoked\b/i);
    }
    expect(STRAVA_POLICY).toMatch(/asks Strava to revoke RunQuest's access/);
  });

  it('says that hand-logged runs and event XP stay', () => {
    expect(buildDisconnectConfirmation(3).stays).toEqual(['Runs you logged by hand.', 'The XP you earned from events.']);
  });

  it('takes the cannot-be-undone warning word for word from the shared consent text', () => {
    expect(buildDisconnectConfirmation(3).warning).toBe(DISCONNECT_WARNING);
    expect(DISCONNECT_WARNING).toMatch(/cannot be undone/);
    expect(DISCONNECT_WARNING).toMatch(/not fetched back and syncing starts from that day/);
    expect(STRAVA_POLICY).toContain(DISCONNECT_WARNING);
  });

  it('sentences the privacy text also says stand word for word in the privacy text', () => {
    // I texten står den som första ledet i en längre mening ("…are still removed here, and revoking access on Strava still works.").
    expect(STRAVA_POLICY).toContain(STILL_REMOVED_SENTENCE.replace(/\.$/, ''));
    expect(STRAVA_POLICY).toContain(DELETED_EVEN_IF_NO_ANSWER_SENTENCE);
  });
});

describe('the choice step copy', () => {
  it('the pause choice says that runs removed or made private on Strava are still removed here, as the privacy text does', () => {
    expect(PAUSE_CHOICE.text).toContain('runs you delete or make private on Strava are still removed here');
    expect(STRAVA_POLICY.toLowerCase()).toContain('runs you delete or make private on strava are still removed here');
  });
});
