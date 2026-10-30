import { describe, expect, it } from 'vitest';
import {
  ALL_WAYPOINTS, JOURNEY_END_KM, MIN_LABEL_PX, getViewport, journeyPercent, lastCheckpoint, layoutWaypoints,
  nextCheckpointInfo, pctInView, nextZoom, journeyProgressLabel, journeyValueText, journeyPercentWhole } from './frodoModel';

describe('waypoints', () => {
  it('är sorterade stigande och börjar i The Shire, slutar i Mount Doom', () => {
    const kms = ALL_WAYPOINTS.map((w) => w.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    expect(ALL_WAYPOINTS[0]).toMatchObject({ name: 'The Shire', km: 0 });
    expect(ALL_WAYPOINTS[ALL_WAYPOINTS.length - 1]).toMatchObject({ name: 'Mount Doom', km: JOURNEY_END_KM });
  });
});

describe('lastCheckpoint / nextCheckpointInfo', () => {
  it('Doors of Durin vid 988 km (designens facit för Karl)', () => {
    expect(lastCheckpoint(988.4).name).toBe('Doors of Durin');
    expect(nextCheckpointInfo(988.4)).toEqual({ name: "Balin's Tomb", km: 1037, remaining: 49 });
  });

  it('exakt på en punkt räknas den som passerad', () => {
    expect(lastCheckpoint(457).name).toBe('Rivendell');
  });

  it('0 km → The Shire; framme → ingen nästa punkt', () => {
    expect(lastCheckpoint(0).name).toBe('The Shire');
    expect(nextCheckpointInfo(JOURNEY_END_KM)).toBeNull();
    expect(nextCheckpointInfo(JOURNEY_END_KM + 50)).toBeNull();
  });
});

describe('journeyPercent', () => {
  it('andel av 3 266 km, klampad till 0–100', () => {
    expect(journeyPercent(988.4)).toBeCloseTo(30.26, 1);
    expect(journeyPercent(0)).toBe(0);
    expect(journeyPercent(5000)).toBe(100);
    expect(journeyPercent(-3)).toBe(0);
  });
});

describe('getViewport', () => {
  it('overview visar hela vägen', () => {
    expect(getViewport(0, 988)).toEqual({ start: 0, end: JOURNEY_END_KM });
  });

  it('zoom centrerar på positionen med ±600 / ±200 km', () => {
    expect(getViewport(1, 1500)).toEqual({ start: 900, end: 2100 });
    expect(getViewport(2, 1500)).toEqual({ start: 1300, end: 1700 });
  });

  it('klampas så att fönstret aldrig lämnar vägen', () => {
    expect(getViewport(1, 50)).toEqual({ start: 0, end: 1200 });
    expect(getViewport(2, 3250)).toEqual({ start: JOURNEY_END_KM - 400, end: JOURNEY_END_KM });
  });
});

describe('pctInView', () => {
  it('läget i fönstret i procent', () => {
    expect(pctInView(1633, 0, JOURNEY_END_KM)).toBeCloseTo(50, 1);
    expect(pctInView(900, 900, 2100)).toBe(0);
  });
});

describe('layoutWaypoints', () => {
  const wide = 800;

  it('overview: bara tier 1, utan start och mål, alternerande rader', () => {
    const placed = layoutWaypoints(0, getViewport(0, 0), wide);
    expect(placed.map((p) => p.name)).toEqual(['Bree', 'Rivendell', 'Moria', 'Rauros', 'The Black Gate']);
    expect(placed.map((p) => p.row)).toEqual([0, 1, 0, 1, 0]);
    expect(placed.every((p) => p.showLabel)).toBe(true);
  });

  it('zoom: tier 2 med, men bara punkter inne i fönstret', () => {
    const viewport = getViewport(2, 988);
    const placed = layoutWaypoints(2, viewport, wide);
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(p.km).toBeGreaterThan(viewport.start);
      expect(p.km).toBeLessThan(viewport.end);
      expect(p.pct).toBeGreaterThan(0);
      expect(p.pct).toBeLessThan(100);
    }
    expect(placed.map((p) => p.name)).toContain('Doors of Durin');
  });

  it('tier 2 släcks när närmaste visade etikett i samma rad ligger närmare än MIN_LABEL_PX', () => {
    // Smal stapel: ±600 km på 200 px → 1 km ≈ 0.17 px, så granne-i-samma-rad (två steg bort) krockar.
    const narrow = layoutWaypoints(1, getViewport(1, 988), 200);
    const hidden = narrow.filter((p) => !p.showLabel);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((p) => p.tier === 2)).toBe(true);

    // Varje släckt etikett har en synlig etikett i samma rad som ligger närmare än MIN_LABEL_PX före den.
    for (const gone of hidden) {
      const px = (gone.pct / 100) * 200;
      const blockers = narrow.filter(
        (p) => p.row === gone.row && p.showLabel && p.km < gone.km && px - (p.pct / 100) * 200 < MIN_LABEL_PX,
      );
      expect({ name: gone.name, blocked: blockers.length > 0 }).toEqual({ name: gone.name, blocked: true });
    }
  });

  it('tier 1 behåller alltid sin etikett, även på en smal stapel', () => {
    const narrow = layoutWaypoints(0, getViewport(0, 0), 120);
    expect(narrow.filter((p) => p.tier === 1).every((p) => p.showLabel)).toBe(true);
  });
});

describe('nextZoom', () => {
  it('stegar Overview → Zoomed → Close-up → Overview', () => {
    expect([0, 1, 2].map((zoom) => nextZoom(zoom as 0 | 1 | 2))).toEqual([1, 2, 0]);
  });
});

describe('journeyProgressLabel / journeyValueText', () => {
  // formatInt skriver tusental med hårt mellanslag (U+00A0).
  const ALL = '3\u00a0266';

  it('the progress line is "percent · km / 3 266 km", with km rounded to whole numbers', () => {
    expect(journeyProgressLabel(988.4)).toBe(`30.3% · 988 / ${ALL} km`);
    expect(journeyProgressLabel(0)).toBe(`0.0% · 0 / ${ALL} km`);
  });

  it('never shows more than the whole way', () => {
    expect(journeyProgressLabel(JOURNEY_END_KM)).toBe(`100.0% · ${ALL} / ${ALL} km`);
    expect(journeyProgressLabel(JOURNEY_END_KM + 50)).toBe(`100.0% · ${ALL} / ${ALL} km`);
  });

  it.each([1180.6, 1180.99])('never claims a milestone that is not reached: %s km is still 1 180 km, before Moria at 1 181', (km) => {
    expect(journeyProgressLabel(km)).toMatch(new RegExp(`· 1\\u00a0180 / ${ALL} km$`));
    expect(journeyValueText(km)).toBe(`${journeyProgressLabel(km).split(' ·')[0]} of the way to Mount Doom, 1\u00a0180 of ${ALL} km, last checkpoint Balin's Tomb`);
    expect(journeyProgressLabel(1181)).toMatch(/· 1\u00a0181 \//);
  });

  it.each([3265.7, 3265.99])('never reads 100 before the end: %s km is 99.9% and 3 265 km', (km) => {
    expect(journeyProgressLabel(km)).toBe(`99.9% · 3\u00a0265 / ${ALL} km`);
    expect(journeyValueText(km)).toBe(`99.9% of the way to Mount Doom, 3\u00a0265 of ${ALL} km, last checkpoint Sammath Naur`);
    expect(journeyPercentWhole(km)).toBe(99);
  });

  it('the whole percent for the bar rounds to nearest, is 100 only at the end, and is never negative', () => {
    expect(journeyPercentWhole(988.4)).toBe(30);
    expect(journeyPercentWhole(1700)).toBe(52);
    expect(journeyPercentWhole(JOURNEY_END_KM)).toBe(100);
    expect(journeyPercentWhole(JOURNEY_END_KM + 50)).toBe(100);
    expect(journeyPercentWhole(0)).toBe(0);
  });

  it('the spoken value names the percent, the km and the last checkpoint', () => {
    expect(journeyValueText(988.4)).toBe(`30.3% of the way to Mount Doom, 988 of ${ALL} km, last checkpoint Doors of Durin`);
    expect(journeyValueText(0)).toBe(`0.0% of the way to Mount Doom, 0 of ${ALL} km, last checkpoint The Shire`);
  });

  it('says that Mount Doom is reached from the last kilometre on', () => {
    expect(journeyValueText(JOURNEY_END_KM)).toBe('Mount Doom reached');
    expect(journeyValueText(JOURNEY_END_KM + 50)).toBe('Mount Doom reached');
  });
});
