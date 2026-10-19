import { describe, expect, it } from "vitest";
import {
  LANE_INSETS,
  LANE_SPEED_FACTORS,
  LANE_STROKE_OPACITY,
  RUNNER_OPACITY,
  laneStrokeWidth,
  ovalPath,
  runnerRadius,
  trackHeight,
} from "./track-geometry";

// Konstanterna är kopierade ur track() i docs/design/claude-design/RunQuest Loaders.dc.html.
// Ändras förlagan ska de här testerna falla så att ändringen blir ett medvetet beslut.
describe("track geometry constants (Loaders-förlagan)", () => {
  it("places the lanes at insets 0 / 7 / 14", () => {
    expect([...LANE_INSETS]).toEqual([0, 7, 14]);
  });

  it("fades runners 1 / .6 / .38 and lane strokes .32 / .22 / .15", () => {
    expect([...RUNNER_OPACITY]).toEqual([1, 0.6, 0.38]);
    expect([...LANE_STROKE_OPACITY]).toEqual([0.32, 0.22, 0.15]);
  });

  it("slows each inner lane by 1 / 1.35 / 1.75", () => {
    expect([...LANE_SPEED_FACTORS]).toEqual([1, 1.35, 1.75]);
  });

  it("is 0.62 as tall as it is wide", () => {
    expect(trackHeight(100)).toBeCloseTo(62);
    expect(trackHeight(88)).toBeCloseTo(54.56);
  });
});

describe("runnerRadius", () => {
  it("is size * 0.055 for larger tracks", () => {
    expect(runnerRadius(100)).toBeCloseTo(5.5);
    expect(runnerRadius(88)).toBeCloseTo(4.84);
  });

  it("never drops below 2 px so the dot stays visible at button size", () => {
    expect(runnerRadius(26)).toBe(2);
    expect(runnerRadius(10)).toBe(2);
  });
});

describe("laneStrokeWidth", () => {
  it("is 1.4 below 34 px and 2 from 34 px", () => {
    expect(laneStrokeWidth(33)).toBe(1.4);
    expect(laneStrokeWidth(34)).toBe(2);
  });

  it("keeps the design's 2 px up to the largest size the Loaders design draws (100 px)", () => {
    expect(laneStrokeWidth(64)).toBe(2);
    expect(laneStrokeWidth(88)).toBe(2);
    expect(laneStrokeWidth(100)).toBe(2);
  });

  it("grows steadily beyond the design's range, from 2 px at 100 px to 6 px at 192 px, with no jump at 101 px", () => {
    expect(laneStrokeWidth(101)).toBeCloseTo(2.04, 2);
    expect(laneStrokeWidth(128)).toBeCloseTo(3.22, 2);
    expect(laneStrokeWidth(192)).toBeCloseTo(6, 10);
  });
});

describe("ovalPath inner lanes", () => {
  it("draws lane 2 (inset 7)", () => {
    expect(ovalPath(7)).toBe("M28.8 14 H71.2 A17 17 0 0 1 71.2 48 H28.8 A17 17 0 0 1 28.8 14 Z");
  });

  it("draws lane 3 (inset 14)", () => {
    expect(ovalPath(14)).toBe("M31.6 21 H68.4 A10 10 0 0 1 68.4 41 H31.6 A10 10 0 0 1 31.6 21 Z");
  });
});
