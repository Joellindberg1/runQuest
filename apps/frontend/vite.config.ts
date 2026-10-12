// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  appType: 'spa' as const,
  server: {
    host: "::",
    port: 8080,
  },
  publicDir: "public",
  plugins: [
    react(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Ramverken byter sällan version och cachas separat från appkoden; resten delas av lazy-gränserna i routes.tsx.
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
}));
