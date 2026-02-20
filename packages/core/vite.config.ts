import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ["src"],
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
      entryRoot: "src",
    }),
  ],
  esbuild: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    entries: [
      "index.html",
      "node_modules/neuroglancer/lib/main.bundle.js",
      "node_modules/neuroglancer/lib/async_computation.bundle.js",
      "node_modules/neuroglancer/lib/chunk_worker.bundle.js",
    ],
    exclude: ["neuroglancer"],
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "PennsieveViz",
      formats: ["es", "cjs"],
      fileName: (format) => `pennsieve-viz.${format}.js`,
    },
    rollupOptions: {
      external: [
        "vue",
        "pinia",
        "plotly.js",
        "@aws-amplify/auth",
        "@pennsieve-viz/tsviewer",
        "@pennsieve-viz/micro-ct",
        "@pennsieve-viz/orthogonal",
      ],
      output: {
        globals: {
          vue: "Vue",
          pinia: "Pinia",
        },
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
      },
    },
    copyPublicDir: false,
  },
});
