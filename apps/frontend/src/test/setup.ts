import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Globals är avstängda i vitest.config.ts, så RTL:s auto-cleanup måste kopplas in här.
afterEach(() => {
  cleanup();
});
