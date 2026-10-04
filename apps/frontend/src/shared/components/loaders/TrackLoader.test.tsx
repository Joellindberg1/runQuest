import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackLoader } from "./TrackLoader";
import { ovalPath, trackLaneCount } from "./track-geometry";

function renderTrack(size: number) {
  render(<TrackLoader size={size} />);
  const root = screen.getByRole("status");
  return {
    root,
    lanes: root.querySelectorAll("svg path"),
    // Löparprickarna är rotens div-barn; banorna ligger i SVG:n.
    runners: root.querySelectorAll(":scope > div"),
  };
}

describe("TrackLoader lane ladder", () => {
  it.each([
    [26, 1],
    [33, 1],
    [34, 2],
    [48, 2],
    [63, 2],
    [64, 3],
    [88, 3],
  ])("size %i px draws %i lane(s) and the same number of runners", (size, expected) => {
    const { lanes, runners } = renderTrack(size);

    expect(lanes).toHaveLength(expected);
    expect(runners).toHaveLength(expected);
  });

  it("exposes the ladder as a pure function with the same thresholds", () => {
    expect(trackLaneCount(33.9)).toBe(1);
    expect(trackLaneCount(34)).toBe(2);
    expect(trackLaneCount(63.9)).toBe(2);
    expect(trackLaneCount(64)).toBe(3);
  });
});

describe("TrackLoader", () => {
  it("is announced as a status with a default and a custom label", () => {
    const { rerender } = render(<TrackLoader />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    rerender(<TrackLoader label="Logging run" />);
    expect(screen.getByRole("status", { name: "Logging run" })).toBeInTheDocument();
  });

  it("sizes the box as width x width*0.62 and applies the tilt (default -16deg)", () => {
    const { root } = renderTrack(88);

    expect(root).toHaveStyle({ width: "88px", height: `${88 * 0.62}px` });
    expect(root.style.transform).toBe("rotate(-16deg)");
  });

  it("accepts a custom tilt", () => {
    render(<TrackLoader size={48} tilt={0} />);

    expect(screen.getByRole("status").style.transform).toBe("rotate(0deg)");
  });

  it("colours lanes with the gold token by default and accepts a custom colour", () => {
    const { lanes } = renderTrack(48);
    expect(lanes[0]).toHaveAttribute("stroke", "var(--rq-gold)");

    render(<TrackLoader size={48} color="var(--rq-on-gold)" />);
    const custom = screen.getAllByRole("status")[1].querySelector("svg path");
    expect(custom).toHaveAttribute("stroke", "var(--rq-on-gold)");
  });

  it("thins the lane stroke at button size", () => {
    expect(renderTrack(26).lanes[0]).toHaveAttribute("stroke-width", "1.4");
  });
});

describe("ovalPath", () => {
  it("draws the outer lane in viewBox units", () => {
    expect(ovalPath(0)).toBe("M26 7 H74 A24 24 0 0 1 74 55 H26 A24 24 0 0 1 26 7 Z");
  });

  it("scales every coordinate for the pixel path the runners follow", () => {
    expect(ovalPath(0, 2)).toBe("M52 14 H148 A48 48 0 0 1 148 110 H52 A48 48 0 0 1 52 14 Z");
  });

  it("pulls inner lanes in horizontally by 0.4x and vertically by the inset", () => {
    expect(ovalPath(10)).toBe("M30 17 H70 A14 14 0 0 1 70 45 H30 A14 14 0 0 1 30 17 Z");
  });
});
