import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "MicroCT",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: ["vue", "@deck.gl/core", "@vivjs/layers", "@vivjs/extensions", "@vivjs/views", "@vivjs/loaders", "geotiff"],
      output: {
        exports: "named",
        globals: {
          vue: "Vue",
        },
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
      },
    },
    copyPublicDir: false,
  },
});
