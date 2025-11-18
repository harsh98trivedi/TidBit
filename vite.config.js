// vite.config.js
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// IMPORTANT: repo name on GitHub Pages
const repoName = "TidBit";

export default defineConfig({
  plugins: [svelte()],
  // This MUST match the repo name exactly (case sensitive)
  base: `/${repoName}/`,
});
