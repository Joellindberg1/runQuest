import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RQLogo } from "./index";

describe("RQLogo", () => {
  it("renders the wordmark and tagline, labelled for assistive tech", () => {
    render(<RQLogo />);

    expect(screen.getByRole("img", { name: "RunQuest" })).toBeInTheDocument();
    expect(screen.getByText("RUNQUEST")).toBeInTheDocument();
    expect(screen.getByText("RUN - RANK - REIGN")).toBeInTheDocument();
  });

  it("colours the tagline with the gold token by default", () => {
    render(<RQLogo />);

    expect(screen.getByText("RUN - RANK - REIGN")).toHaveAttribute("fill", "var(--rq-gold)");
  });

  it("applies a custom taglineFill", () => {
    render(<RQLogo taglineFill="var(--rq-text-3)" />);

    expect(screen.getByText("RUN - RANK - REIGN")).toHaveAttribute("fill", "var(--rq-text-3)");
  });

  it("drops the tagline when taglineFill is null", () => {
    render(<RQLogo taglineFill={null} />);

    expect(screen.getByText("RUNQUEST")).toBeInTheDocument();
    expect(screen.queryByText("RUN - RANK - REIGN")).not.toBeInTheDocument();
  });

  it("uses the logo font role, the source viewBox and the default size", () => {
    render(<RQLogo />);
    const svg = screen.getByRole("img", { name: "RunQuest" });

    expect(svg).toHaveClass("font-logo");
    expect(svg).toHaveAttribute("viewBox", "0 0 165 40");
    expect(svg).toHaveAttribute("width", "148");
    expect(svg).toHaveAttribute("height", "36");
  });
});
