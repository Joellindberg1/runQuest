import { describe, expect, it } from 'vitest';
import { TOUR_PROFILE_V2 } from './featureTourSteps';

// RUN-155: rundhistoriken i touren sa "Press Edit", men Strava-rundor kan inte redigeras (bara manuella).
describe('TOUR_PROFILE_V2: rundhistorik-steget', () => {
  const step = TOUR_PROFILE_V2.find((candidate) => candidate.element === '[data-tour="profile-history"]');

  it('säger att Strava-rundor inte kan redigeras, utan en ovillkorlig "Press Edit"', () => {
    expect(step).toBeDefined();
    expect(step?.description).toMatch(/Strava/);
    expect(step?.description).toMatch(/manual/i);
    expect(step?.description).not.toMatch(/Press Edit/);
  });

  it('behåller att streak och XP räknas om från den dagen', () => {
    expect(step?.description).toMatch(/streak and XP are recalculated/i);
  });
});
