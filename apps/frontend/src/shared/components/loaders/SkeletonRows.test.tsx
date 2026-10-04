import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonRows } from "./SkeletonRows";

describe("SkeletonRows", () => {
  it("renders four rows by default inside a hairline grid", () => {
    render(<SkeletonRows />);
    const list = screen.getByRole("status", { name: "Loading" });

    expect(list).toHaveClass("rq-hairgrid");
    expect(list.children).toHaveLength(4);
  });

  it("renders the requested number of rows", () => {
    render(<SkeletonRows rows={7} label="Loading the pack" />);

    expect(screen.getByRole("status", { name: "Loading the pack" }).children).toHaveLength(7);
  });

  it("staggers the blink by 0.15 s per row", () => {
    render(<SkeletonRows rows={3} />);
    const rows = Array.from(screen.getByRole("status").children);
    const delays = rows.map((row) => (row.querySelector("div") as HTMLElement).style.animationDelay);

    expect(delays).toEqual(["0s", "0.15s", "0.3s"]);
  });

  it("varies the name width and cycles the pattern past four rows", () => {
    render(<SkeletonRows rows={5} />);
    const rows = Array.from(screen.getByRole("status").children);
    const widths = rows.map((row) => (row.children[1].firstElementChild as HTMLElement).style.width);

    expect(widths).toEqual(["62%", "48%", "70%", "40%", "62%"]);
  });

  it("hides the placeholder rows from assistive tech", () => {
    render(<SkeletonRows rows={2} />);

    for (const row of Array.from(screen.getByRole("status").children)) {
      expect(row).toHaveAttribute("aria-hidden", "true");
    }
  });
});
