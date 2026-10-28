import { describe, expect, it } from 'vitest';
import { STRAVA_CONSENT_KEY_POINTS, getDataPolicySection } from '../index.js';

const text = (sentences: readonly string[]): string => sentences.join(' ');

describe('STRAVA_CONSENT_KEY_POINTS', () => {
  it('has the four points in the order the consent shows them', () => {
    expect(STRAVA_CONSENT_KEY_POINTS.map((point) => point.id)).toEqual(['imported', 'removed', 'disconnect', 'pause']);
  });

  it('takes every sentence verbatim from the strava section, in the order they stand there', () => {
    const paragraphs = getDataPolicySection('strava')!.paragraphs;
    let paragraphIndex = 0;
    let offset = 0;
    for (const point of STRAVA_CONSENT_KEY_POINTS) {
      for (const sentence of point.sentences) {
        let at = -1;
        while (paragraphIndex < paragraphs.length && (at = paragraphs[paragraphIndex].indexOf(sentence, offset)) === -1) {
          paragraphIndex += 1;
          offset = 0;
        }
        expect(at, `"${sentence.slice(0, 50)}…" stands in the strava section after the previous point`).toBeGreaterThanOrEqual(0);
        offset = at + sentence.length;
      }
    }
  });

  // Samtyckets ordalydelse är fastnålad här, separat från snapshotvakten i dataPolicy.test.ts: en ändrad huvudpunkt kräver ett medvetet
  // testbyte (och en ny samtyckesversion), även om någon höjer versionen och uppdaterar snapshotpinnen.
  it('pins the wording of the four points verbatim', () => {
    expect(STRAVA_CONSENT_KEY_POINTS.map((point) => ({ id: point.id, sentences: point.sentences }))).toEqual([
      {
        id: 'imported',
        sentences: [
          'Only running activities are imported (Run, TrailRun and VirtualRun).',
          'From each run RunQuest stores: date, distance, Strava activity ID, start time (local clock), moving time, elevation gain, sport type, average heart rate, maximum heart rate, relative effort, start coordinates, pace variation and whether it was on a treadmill.',
          'The start coordinates are used only to look up the weather at the start from Open-Meteo (see the Weather section) and are not shown in the app.',
        ],
      },
      {
        id: 'removed',
        sentences: [
          'If you delete an activity on Strava, make it private or change it so that it is no longer a run, RunQuest removes it here within 48 hours and recalculates your XP, streaks, titles and badges without it, so they can go down.',
        ],
      },
      {
        id: 'disconnect',
        sentences: [
          `Choosing "Disconnect" in Settings asks Strava to revoke RunQuest's access and deletes all runs that were imported from Strava, together with your stored Strava tokens.`,
          'Disconnecting cannot be undone: if you connect Strava again, your earlier Strava runs are not fetched back and syncing starts from that day.',
          `If you revoke RunQuest's access on Strava instead, in your Strava settings, the result is the same: the runs imported from Strava and the tokens are deleted here.`,
        ],
      },
      {
        id: 'pause',
        sentences: ['In Settings you can choose "Pause sync": your Strava connection and your runs stay, but no new runs are fetched while sync is paused.'],
      },
    ]);
  });

  it('each point states what the consent has to say', () => {
    const [imported, removed, disconnect, pause] = STRAVA_CONSENT_KEY_POINTS.map((point) => text(point.sentences));
    expect(imported).toMatch(/running activities are imported/i);
    expect(imported).toMatch(/RunQuest stores/i);
    expect(imported).toMatch(/start coordinates are used only to look up the weather/i);
    expect(removed).toMatch(/delete/i);
    expect(removed).toMatch(/private/i);
    expect(removed).toMatch(/no longer a run/i);
    expect(removed).toMatch(/within 48 ?(hours|h)\b/i);
    expect(removed).toMatch(/recalculates/i);
    expect(disconnect).toMatch(/"Disconnect"/);
    expect(disconnect).toMatch(/deletes all runs that were imported from Strava/i);
    expect(disconnect).toMatch(/cannot be undone/i);
    expect(disconnect).toMatch(/not fetched back/i);
    expect(disconnect).toMatch(/revoke RunQuest's access on Strava instead[^]*runs imported from Strava and the tokens are deleted/i);
    expect(pause).toMatch(/"Pause sync"/i);
    expect(pause).toMatch(/no new runs are fetched/i);
  });
});
