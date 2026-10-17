// vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { stagingGuard } from "./stagingGuard";

export default defineConfig(({ mode }) => {
  // VITE_APP_ENV=staging sätts bara på stagingtjänsten (Railway). Saknad eller annat värde = prod: ingen banner, inget noindex.
  const appEnv = loadEnv(mode, __dirname, "VITE_").VITE_APP_ENV;
  return {
    appType: 'spa' as const,
    server: {
      host: "::",
      port: 8080,
    },
    publicDir: "public",
    // Miljön läses som en konstant, så bannerns gren (App.tsx) och dess kod försvinner ur prodbygget.
    define: { "import.meta.env.VITE_APP_ENV": JSON.stringify(appEnv ?? "") },
    plugins: [
      react(),
      stagingGuard(appEnv),
    ],
    build: {
      rollupOptions: {
        output: {
          // Ramverken byter sällan version och cachas separat från appkoden; resten delas av lazy-gränserna i routes.tsx.
          // Felspårningens chunk får ett neutralt namn som börjar med `optional-`: annonsblockerare stoppar adresser som innehåller "sentry", och
          // staleChunkReload.ts känner igen prefixet så att en blockerad chunk inte laddar om sidan. Håll de två i takt.
          chunkFileNames: (chunk: { name: string }) => (chunk.name === 'sentryClient' ? 'assets/optional-[hash].js' : 'assets/[name]-[hash].js'),
          manualChunks: {
            react: ['react', 'react-dom'],
            router: ['react-router-dom'],
            'react-query': ['@tanstack/react-query'],
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
