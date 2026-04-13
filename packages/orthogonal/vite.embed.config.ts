import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { copyFileSync } from "fs";

// App-mode build for the embeddable orthogonal viewer.
// Produces a self-contained static app (HTML + JS/CSS/workers/WASM)
// deployable to S3/CloudFront and loaded inside an iframe.

// Copy sw.js to dist-embed/ after build. The service worker must remain
// a standalone file (not bundled) so the browser can register it.
const copyServiceWorker = () => ({
  name: "copy-sw",
  closeBundle() {
    copyFileSync(
      resolve(__dirname, "src/sw.js"),
      resolve(__dirname, "dist-embed/sw.js")
    );
  },
});

export default defineConfig({
  plugins: [vue(), copyServiceWorker()],
  root: __dirname,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  esbuild: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    entries: [
      "embed.html",
      "node_modules/neuroglancer/lib/main.bundle.js",
      "node_modules/neuroglancer/lib/async_computation.bundle.js",
      "node_modules/neuroglancer/lib/chunk_worker.bundle.js",
    ],
    exclude: ["neuroglancer"],
  },
  build: {
    outDir: resolve(__dirname, "dist-embed"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2 * 1024 * 1024,
    rollupOptions: {
      input: resolve(__dirname, "embed.html"),
    },
  },
});
