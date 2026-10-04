import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonRows } from "./SkeletonRows";

function renderRows(props: Parameters<typeof SkeletonRows>[0] = {}) {
  render(<SkeletonRows {...props} />);
  const status = screen.getByRole("status");
  const grid = status.querySelector(".rq-hairgrid") as HTMLElement;
  return { status, grid, rows: Array.from(grid.children) as HTMLElement[] };
}

describe("SkeletonRows", () => {
  it("renders four rows by default inside a hairline grid", () => {
    const { grid, rows } = renderRows();

    expect(grid).toHaveClass("rq-hairgrid");
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveClass("rq-skel-row");
  });

  it("renders the requested number of rows", () => {
    expect(renderRows({ rows: 7 }).rows).toHaveLength(7);
  });

  it("announces its label as screen-reader-only text, not as an aria-label", () => {
    const { status } = renderRows({ label: "Loading the pack" });

    expect(status).toHaveTextContent("Loading the pack");
    expect(status.querySelector(".sr-only")).toHaveTextContent("Loading the pack");
    expect(status).not.toHaveAttribute("aria-label");
  });

  it("says Loading by default", () => {
    expect(renderRows().status).toHaveTextContent("Loading");
  });

  it("staggers the blink by 0.15 s per row", () => {
    const delays = renderRows({ rows: 3 }).rows.map(
      (row) => (row.querySelector(".rq-skel-block") as HTMLElement).style.animationDelay,
    );

    expect(delays).toEqual(["0s", "0.15s", "0.3s"]);
  });

  it("varies the name width and cycles the pattern past four rows", () => {
    const widths = renderRows({ rows: 5 }).rows.map(
      (row) => (row.children[1].firstElementChild as HTMLElement).style.width,
    );

    expect(widths).toEqual(["62%", "48%", "70%", "40%", "62%"]);
  });

  it("hides the placeholder grid from assistive tech", () => {
    expect(renderRows({ rows: 2 }).grid).toHaveAttribute("aria-hidden", "true");
  });

  it("takes its sizes from the skeleton tokens, never raw px", () => {
    const { rows } = renderRows({ rows: 1 });
    const heights = Array.from(rows[0].querySelectorAll(".rq-skel-block")).map((el) => el.className);

    expect(heights.join(" ")).toContain("h-[var(--rq-skel-h-1)]");
    expect(heights.join(" ")).toContain("h-[var(--rq-skel-h-2)]");
    expect(heights.join(" ")).toContain("h-[var(--rq-skel-h-3)]");
    expect(heights.join(" ")).toContain("h-[var(--rq-skel-h-4)]");
  });
});
