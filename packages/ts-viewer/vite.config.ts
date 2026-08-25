import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";
import path from "path";
import { resolve } from "path";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      // importStyle false keeps element-plus style deep-imports out of dist;
      // consumers load element-plus CSS themselves.
      resolvers: [ElementPlusResolver({ importStyle: false })],
      imports: ["vue"],
      dts: false,
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: false })],
      dts: false,
    }),
    dts({
      include: ["src"],
      exclude: ["src/**/*.test.js", "src/**/*.test.ts"],
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
      entryRoot: "src",
    }),
  ],
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "${path.resolve(
          __dirname,
          "src/assets/tsviewerVariables.scss"
        )}" as *;`,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "TSViewer",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // Regex externals so deep imports (element-plus/es/components/*, the
      // zarr reader's wasm chunks) stay external too.
      external: [
        /^vue$/,
        /^pinia($|\/)/,
        /^element-plus($|\/)/,
        /^@element-plus\//,
        /^@aws-amplify\//,
        /^@pennsieve\/timeseries-zarr-reader($|\/)/,
        /^protobufjs($|\/)/,
      ],
      output: {
        exports: "named",
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
      },
    },
    copyPublicDir: false,
  },
});
