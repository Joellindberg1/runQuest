import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Routes och skalet är lazy-chunkar (routes.tsx); den första importen i en testfil är kall och kan ta längre än standardsekunden när sviten körs parallellt.
configure({ asyncUtilTimeout: 5000 });

// Globals är avstängda i vitest.config.ts, så RTL:s auto-cleanup måste kopplas in här.
afterEach(() => {
  cleanup();
});

// jsdom saknar dessa; Radix (popover/dialog) och skalets scroll-återställning behöver dem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
}
