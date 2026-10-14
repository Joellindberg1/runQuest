/**
 * Integritetstexten säger vad Strava-importen sparar. Den här vakten kör importens radbyggare med en fullständig aktivitet och fäller
 * om raden får ett fält som texten (STRAVA_IMPORTED_FIELDS i packages/shared/src/legal/dataPolicy.ts) inte nämner. Ändras importen
 * ska fältlistan, texten och DATA_POLICY_VERSION ändras samtidigt.
 */
import { describe, it, expect } from 'vitest';
import { STRAVA_IMPORTED_FIELDS, getDataPolicySection } from '@runquest/shared';
import { buildStravaRunRow, extractExtendedFields, STRAVA_XP_PLACEHOLDERS } from '../services/stravaImport.js';
import { stravaActivity } from '../test-utils/fakeStrava.js';

/** Nycklar som är bokföring, inte importerad data: ägare, källa, XP-platshållare och skrivtidpunkt. */
const INTERNAL_KEYS = new Set(['user_id', 'source', 'created_at', ...Object.keys(STRAVA_XP_PLACEHOLDERS)]);

describe('dataPolicy strava fields', () => {
  it('every field extractExtendedFields imports is named in the strava section', () => {
    // Fullständig aktivitet: ett fält som bara sparas när Strava skickar det syns ändå som nyckel (null i övrigt).
    const activity = stravaActivity({ average_heartrate: 150, max_heartrate: 180, suffer_score: 42 });
    const extended = Object.keys(extractExtendedFields(activity));
    const imported = Object.keys(buildStravaRunRow('user-1', activity, activity)).filter((key) => !INTERNAL_KEYS.has(key));

    // Vakten måste se fälten för att vara något värd: en tom eller ofullständig rad ska fälla.
    expect(imported).toEqual(expect.arrayContaining(['start_time', 'suffer_score', 'is_treadmill', 'date', 'distance', 'external_id']));
    expect(imported).toEqual(expect.arrayContaining(extended));

    const listed = STRAVA_IMPORTED_FIELDS.map((field) => field.key);
    expect([...imported].sort()).toEqual([...listed].sort());

    const stravaText = getDataPolicySection('strava')!.paragraphs.join('\n');
    for (const key of imported) {
      const field = STRAVA_IMPORTED_FIELDS.find((candidate) => candidate.key === key);
      expect(field, `${key} saknas i STRAVA_IMPORTED_FIELDS`).toBeDefined();
      expect(stravaText, `${key}: etiketten "${field!.label}" står i Strava-avsnittet`).toContain(field!.label);
    }
  });
});
