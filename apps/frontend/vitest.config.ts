// vitest.config.ts — frontend-sviten (ADR 001: Vitest + React Testing Library + jsdom)
//
// Två projekt: rena .test.ts (modeller, format, vakter) går i node, resten i jsdom. Det sparar
// jsdom-uppstarten per fil (environment-tiden var störst i hela sviten). En .test.ts som behöver
// window/localStorage läggs i NEEDS_DOM så hamnar den i dom-projektet.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const NEEDS_DOM = [
  "src/app-shell/legacyRedirects.test.ts",
  "src/features/badges/api.test.ts",
  "src/shared/services/backendApi.*.test.ts",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    css: false,
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.tsx", ...NEEDS_DOM],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: NEEDS_DOM,
        },
      },
    ],
  },
});
