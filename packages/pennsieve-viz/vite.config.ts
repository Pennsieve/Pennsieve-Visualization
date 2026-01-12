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
  resolve: {
    alias: {
      "@pennsieve-viz/core": resolve(__dirname, "../core/src"),
      "@pennsieve-viz/duckdb": resolve(__dirname, "../duckdb/src"),
      "@pennsieve-viz/data-explorer": resolve(
        __dirname,
        "../data-explorer/src"
      ),
      "@pennsieve-viz/umap": resolve(__dirname, "../umap/src"),
      "@pennsieve-viz/proportion-plot": resolve(
        __dirname,
        "../proportion-plot/src"
      ),
      "@pennsieve-viz/markdown": resolve(__dirname, "../markdown/src"),
      "@pennsieve-viz/text-viewer": resolve(__dirname, "../text-viewer/src"),
      "@pennsieve-viz/ai-plotly": resolve(__dirname, "../ai-plotly/src"),
    },
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
