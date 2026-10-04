import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RQIcon, RQ_ICON_NAMES, RQ_ICON_PATHS, type RQIconName } from "./index";
// Designprojektets ikonkälla är sanningen (docs/design/claude-design/README.md).
import sourceText from "../../../../../../docs/design/claude-design/runquest-icons.js?raw";

type SourceWindow = { RQIcons?: { PATHS: Record<string, string[]>; names: string[] } };

/** Kör källfilen (en IIFE som skriver till window.RQIcons) mot ett fejkat window. */
function loadSourceIcons() {
  const fakeWindow: SourceWindow = {};
  new Function("window", sourceText)(fakeWindow);
  if (!fakeWindow.RQIcons) throw new Error("runquest-icons.js exporterade inte window.RQIcons");
  return fakeWindow.RQIcons;
}

describe("RQ_ICON_PATHS mot designprojektets runquest-icons.js", () => {
  const source = loadSourceIcons();

  it("har exakt samma ikonnamn i samma ordning", () => {
    expect(source.names).toHaveLength(28);
    expect(RQ_ICON_NAMES).toEqual(source.names);
  });

  it("har exakt samma path-data (inkl. '@cx cy r'-cirklar) för varje ikon", () => {
    expect(RQ_ICON_PATHS).toEqual(source.PATHS);
  });

  it("renderar varje källform som rätt element: '@' -> <circle>, annars <path>", () => {
    for (const name of source.names) {
      const { container, unmount } = render(<RQIcon name={name as RQIconName} />);
      const rendered = Array.from(container.querySelectorAll("path, circle"));

      expect(rendered).toHaveLength(source.PATHS[name].length);
      source.PATHS[name].forEach((shape, i) => {
        const el = rendered[i];
        if (shape.startsWith("@")) {
          const [cx, cy, r] = shape.slice(1).split(" ");
          expect(el.tagName).toBe("circle");
          expect([el.getAttribute("cx"), el.getAttribute("cy"), el.getAttribute("r")]).toEqual([cx, cy, r]);
        } else {
          expect(el.tagName).toBe("path");
          expect(el.getAttribute("d")).toBe(shape);
        }
      });
      unmount();
    }
  });
});
