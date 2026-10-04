import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RQIcon, RQ_ICON_NAMES, RQ_ICON_PATHS, type RQIconName } from "./index";

function renderIcon(name: string, props: Partial<Parameters<typeof RQIcon>[0]> = {}) {
  const { container } = render(<RQIcon name={name as RQIconName} {...props} />);
  return container.querySelector("svg")!;
}

describe("RQIcon", () => {
  it("renders one <path> per path string for a pure-path icon", () => {
    const svg = renderIcon("flame");

    expect(svg.querySelectorAll("path")).toHaveLength(RQ_ICON_PATHS.flame.length);
    expect(svg.querySelectorAll("circle")).toHaveLength(0);
    expect(svg.querySelector("path")).toHaveAttribute("d", RQ_ICON_PATHS.flame[0]);
  });

  it("renders '@cx cy r' entries as circles with the parsed geometry", () => {
    const svg = renderIcon("target");
    const circles = svg.querySelectorAll("circle");

    expect(circles).toHaveLength(3);
    expect(svg.querySelectorAll("path")).toHaveLength(0);
    expect(circles[1]).toHaveAttribute("cx", "12");
    expect(circles[1]).toHaveAttribute("cy", "12");
    expect(circles[1]).toHaveAttribute("r", "6");
  });

  it("renders icons that mix paths and circles", () => {
    const svg = renderIcon("user");

    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(svg.querySelector("circle")).toHaveAttribute("r", "4");
  });

  it("falls back to the trophy for an unknown name", () => {
    const unknown = renderIcon("does-not-exist");
    const trophy = renderIcon("trophy");

    expect(unknown.innerHTML).toBe(trophy.innerHTML);
    expect(unknown.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("uses the icon grammar: 24x24 viewBox, stroke 1.9, round caps, no fill", () => {
    const svg = renderIcon("bell");

    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("stroke-width", "1.9");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("fill", "none");
  });

  it("defaults to 16 px and currentColor, and accepts size and color", () => {
    const byDefault = renderIcon("clock");
    expect(byDefault).toHaveAttribute("width", "16");
    expect(byDefault).toHaveAttribute("height", "16");
    expect(byDefault).toHaveAttribute("stroke", "currentColor");

    const custom = renderIcon("clock", { size: 21, color: "var(--rq-gold)" });
    expect(custom).toHaveAttribute("width", "21");
    expect(custom).toHaveAttribute("height", "21");
    expect(custom).toHaveAttribute("stroke", "var(--rq-gold)");
  });

  it("is decorative by default but can be exposed to assistive tech", () => {
    expect(renderIcon("flag")).toHaveAttribute("aria-hidden", "true");

    const labelled = renderIcon("flag", { "aria-hidden": false, "aria-label": "Finish" });
    expect(labelled).toHaveAttribute("aria-label", "Finish");
    expect(labelled).toHaveAttribute("aria-hidden", "false");
  });

  it("does not shrink inside flex rows and merges a custom className", () => {
    const svg = renderIcon("zap", { className: "text-foreground" });

    expect(svg).toHaveClass("shrink-0");
    expect(svg).toHaveClass("text-foreground");
  });

  it("exports every name from the source set and each one renders all its shapes", () => {
    expect(RQ_ICON_NAMES).toHaveLength(28);
    expect(new Set(RQ_ICON_NAMES)).toEqual(new Set(Object.keys(RQ_ICON_PATHS)));

    for (const name of RQ_ICON_NAMES) {
      const svg = renderIcon(name);
      expect(svg.querySelectorAll("path, circle")).toHaveLength(RQ_ICON_PATHS[name].length);
    }
  });
});
