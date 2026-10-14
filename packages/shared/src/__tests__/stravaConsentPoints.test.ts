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

  it('each point states what the consent has to say', () => {
    const [imported, removed, disconnect, pause] = STRAVA_CONSENT_KEY_POINTS.map((point) => text(point.sentences));
    expect(imported).toMatch(/running activities are imported/i);
    expect(imported).toMatch(/RunQuest stores/i);
    expect(removed).toMatch(/delete/i);
    expect(removed).toMatch(/private/i);
    expect(removed).toMatch(/no longer a run/i);
    expect(removed).toMatch(/within 48 ?(hours|h)\b/i);
    expect(removed).toMatch(/recalculates/i);
    expect(disconnect).toMatch(/"Disconnect"/);
    expect(disconnect).toMatch(/deletes all runs that were imported from Strava/i);
    expect(disconnect).toMatch(/cannot be undone/i);
    expect(disconnect).toMatch(/not fetched back/i);
    expect(pause).toMatch(/"Pause sync"/i);
    expect(pause).toMatch(/no new runs are fetched/i);
  });
});
