// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { stagingGuard } from "./stagingGuard";
import { stripSourceMaps } from "./stripSourceMaps";
import { stylesheetOrder, THEME_CHUNK_NAME } from "./stylesheetOrder";
import { currentSentryRelease, sentryUploadOptions, uploadNotice } from "../../scripts/sentry-build.mjs";

const SENTRY_PROJECT = "runquest-frontend";

export default defineConfig(({ command, mode, isSsrBuild }) => {
  // VITE_APP_ENV=staging sätts bara på stagingtjänsten (Railway). Saknad eller annat värde = prod: ingen banner, inget noindex.
  const appEnv = loadEnv(mode, __dirname, "VITE_").VITE_APP_ENV;
  // Källkartorna laddas upp till Sentry under releasen som också bakas in i appen (scripts/sentry-build.mjs). Utan SENTRY_AUTH_TOKEN
  // finns ingen uppladdning och inget Sentry-plugin alls; kartorna tas bort ur dist i båda fallen (stripSourceMaps.ts).
  const sentryRelease = currentSentryRelease(process.env);
  // SSR-bygget (prerender-landing.mjs) är ett hjälpbygge som kastas: det laddar inte upp några kartor, skriver ingen robots.txt och ger ingen dist att städa.
  const upload = command === "build" && !isSsrBuild ? sentryUploadOptions({ env: process.env, project: SENTRY_PROJECT, release: sentryRelease }) : null;
  return {
    appType: 'spa' as const,
    server: {
      host: "::",
      port: 8080,
    },
    publicDir: "public",
    // Miljön läses som en konstant, så bannerns gren (App.tsx) och dess kod försvinner ur prodbygget.
    define: {
      "import.meta.env.VITE_APP_ENV": JSON.stringify(appEnv ?? ""),
      // Samma namn som uppladdningen: SDK:t (sentryClient.ts) rapporterar det, så Sentry hittar kartan till varje händelse.
      "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease),
    },
    plugins: [
      react(),
      ...(isSsrBuild
        ? []
        : [
            stagingGuard(appEnv),
            // Uppladdningen körs i writeBundle och tas bort-steget i closeBundle: kartorna ska finnas kvar tills uppladdningen är klar.
            ...(upload ? [sentryVitePlugin(upload)] : []),
            stripSourceMaps(),
            stylesheetOrder(),
            {
              name: "rq-sentry-upload-notice",
              apply: "build" as const,
              buildStart: () => console.log(uploadNotice(SENTRY_PROJECT, upload)),
            },
          ]),
    ],
    build: isSsrBuild
      ? {}
      : {
          // Dolda kartor: ingen sourceMappingURL i skripten. De laddas upp till Sentry och tas bort ur dist (stripSourceMaps.ts).
          sourcemap: "hidden" as const,
          rollupOptions: {
            // Två HTML-ingångar (ADR 006, addendum 2026-10-19): hela appen och landningens lean ingång. Namnen ger filnamnen index-*.js och landing-*.js.
            input: {
              index: path.resolve(__dirname, "index.html"),
              landing: path.resolve(__dirname, "landing.html"),
            },
            output: {
              // Ramverken byter sällan version och cachas separat från appkoden; resten delas av lazy-gränserna i routes.tsx.
              // Felspårningens chunk får ett neutralt namn som börjar med `optional-`: annonsblockerare stoppar adresser som innehåller "sentry", och
              // staleChunkReload.ts känner igen prefixet så att en blockerad chunk inte laddar om sidan. Håll de två i takt.
              chunkFileNames: (chunk: { name: string }) => (chunk.name === 'sentryClient' ? 'assets/optional-[hash].js' : 'assets/[name]-[hash].js'),
              manualChunks: {
                react: ['react', 'react-dom'],
                router: ['react-router-dom'],
                'react-query': ['@tanstack/react-query'],
                // Temat (Tailwind, tokens, globala regler) delas av båda ingångarna. Egen fil gör att stylesheetOrder.ts kan placera den: sist i appen, först i landningen.
                [THEME_CHUNK_NAME]: [path.resolve(__dirname, "src/index.css")],
              },
            },
          },
        },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
