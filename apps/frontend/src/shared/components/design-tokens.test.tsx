import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RQIcon, RQLogo } from "./icons";
import { SkeletonRows } from "./loaders/SkeletonRows";
import { TrackLoader } from "./loaders/TrackLoader";

// Regel 1 (designsprak-forslag.md): inga råvärden i klassnamn — varken som
// Tailwind-arbitrary ([22px]) eller inskrivna px-mått. Mått kommer ur --rq-*-tokens.
const RAW_PX = /[\d.]+px/;

const sources = import.meta.glob(["./icons/*.tsx", "./loaders/*.tsx", "!./**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function classNamesIn(root: Element): string[] {
  return Array.from(root.querySelectorAll("[class]"))
    .concat(root.hasAttribute("class") ? [root] : [])
    .map((el) => el.getAttribute("class") ?? "");
}

describe("icons/ och loaders/ följer regel 1 (inga råa px i klassnamn)", () => {
  it("hittar komponentfilerna som ska granskas", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
  });

  it("har inga px-värden inom Tailwind-hakparenteser eller className-strängar i källan", () => {
    for (const [file, text] of Object.entries(sources)) {
      const arbitrary = text.match(/[a-z-]+-\[[^\]]*[\d.]+px[^\]]*\]/g) ?? [];
      const classNameLiterals = (text.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? []).filter((c) => RAW_PX.test(c));

      expect({ file, arbitrary, classNameLiterals }).toEqual({ file, arbitrary: [], classNameLiterals: [] });
    }
  });

  it("renderar inga klasser med px-värden", () => {
    const rendered = [
      render(<RQIcon name="flame" className="text-foreground" label="Streak" />).container,
      render(<RQLogo />).container,
      render(<TrackLoader size={88} />).container,
      render(<SkeletonRows rows={4} />).container,
    ];

    for (const container of rendered) {
      const classes = classNamesIn(container).filter((c) => RAW_PX.test(c));
      expect(classes).toEqual([]);
    }
  });
});
