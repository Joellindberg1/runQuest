import { describe, expect, it } from 'vitest';
import { TOUR_NEWS_V2, TOUR_PROFILE_V2 } from './featureTourSteps';

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

describe('TOUR_NEWS_V2: stegen', () => {
  it('TOUR_NEWS_V2 har fem steg i rätt ordning, nämner inställningarna och läs-gesten och säger aldrig att fokus markerar läst', () => {
    expect(TOUR_NEWS_V2.map((step) => step.element)).toEqual([
      '[data-tour="news-feed"]',
      '[data-tour="news-filter"]',
      '[data-tour="news-settings"]',
      '[data-tour="news-mark-read"]',
      undefined,
    ]);

    const [feed, , settings] = TOUR_NEWS_V2;
    // Läs-gesten: mus (efter rörelse), tryck och tangentbord via Enter. Samma steg förklarar den gyllene pricken.
    expect(feed.description).toMatch(/gold dot/i);
    expect(feed.description).toMatch(/mouse over it/i);
    expect(feed.description).toMatch(/tap it/i);
    expect(feed.description).toMatch(/press Enter/i);
    expect(settings.title).toMatch(/settings/i);
    expect(settings.description).toMatch(/bell/i);

    // Fokus är ingen läs-gest (ägarbeslut 2): ordet får inte förekomma någonstans i turen.
    for (const step of TOUR_NEWS_V2) expect(`${step.title} ${step.description}`, step.title).not.toMatch(/\bfocus(es|ed|ing)?\b/i);
  });

  it('filtersteget nämner alla sju slag, Ranks och Involves me', () => {
    const filter = TOUR_NEWS_V2.find((step) => step.element === '[data-tour="news-filter"]');
    expect(filter?.description).toContain('titles, challenges, ranks, events, levels, badges or streaks');
    expect(filter?.description).toMatch(/Involves me/);
  });

  it('sista steget säger att sidan alltid visar hela gruppen', () => {
    const last = TOUR_NEWS_V2[TOUR_NEWS_V2.length - 1];
    expect(last.description).toMatch(/page always shows the whole pack/i);
  });
});
