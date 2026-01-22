import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { resolve } from "path";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ["vue"],
      dts: false,
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: false,
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
      entry: resolve(__dirname, "src/index.js"),
      name: "TSViewer",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [
        "vue",
        "pinia",
        "element-plus",
        "@aws-amplify/auth",
        "aws-amplify/auth",
      ],
      output: {
        exports: "named",
        globals: {
          vue: "Vue",
          pinia: "Pinia",
          "element-plus": "ElementPlus",
        },
        assetFileNames: (a) =>
          a.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]",
      },
    },
    copyPublicDir: false,
  },
});
