import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { dropRowSearchAfterBack } from "@/shared/utils/focusRowAfterBack";

// Globals är avstängda i vitest.config.ts, så RTL:s auto-cleanup måste kopplas in här.
// Sökningen efter löparens rad efter Back (send-arket) lever utanför komponenterna och väntar upp till en sekund: den
// avbryts här, annars kan dess timer gå efter att filens jsdom stängts ("document is not defined" i CI).
afterEach(() => {
  cleanup();
  dropRowSearchAfterBack();
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
