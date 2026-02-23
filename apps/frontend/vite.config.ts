// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  appType: 'spa',
  server: {
    host: "::",
    port: 8080,
  },
  publicDir: "public",
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@runquest/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
}));
