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

  it("keeps the source geometry: wordmark, tagline and runner head", () => {
    const { container } = render(<RQLogo />);
    const word = screen.getByText("RUNQUEST");
    const tagline = screen.getByText("RUN - RANK - REIGN");
    const head = container.querySelector("circle");

    expect(word).toHaveAttribute("x", "40");
    expect(word).toHaveAttribute("y", "25");
    expect(word).toHaveAttribute("font-size", "28");
    expect(tagline).toHaveAttribute("x", "45");
    expect(tagline).toHaveAttribute("y", "40.1");
    expect(tagline).toHaveAttribute("font-size", "12");
    expect(head).toHaveAttribute("cx", "23");
    expect(head).toHaveAttribute("cy", "3.25");
    expect(head).toHaveAttribute("r", "3.5");
    expect(container.querySelectorAll("line")).toHaveLength(7);
    expect(container.querySelectorAll("path")).toHaveLength(1);
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
