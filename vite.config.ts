import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base matches the GitHub Pages project path: https://<user>.github.io/fluke/
export default defineConfig({
  base: "/fluke/",
  plugins: [preact()],
});
