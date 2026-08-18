import { defineConfig } from "vitest/config";
import { resolve } from "path";
import path from "path";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

const alias = { "@": resolve(__dirname, "src") };

// Two projects with different pipelines.
//
// `unit` deliberately does NOT extend vite.config.ts: it covers pure modules,
// so the vue/auto-import/scss plugin chain is dead weight and its global
// auto-imports would mask missing imports in the modules under test.
//
// `dom` mounts SFCs, which need the real compile pipeline: the vue plugin,
// the Element Plus resolvers, and the injected scss variables. It mirrors
// vite.config.ts minus the build-only pieces (lib mode, externals, dts).
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.dom.test.ts"],
        },
      },
      {
        plugins: [
          vue(),
          AutoImport({
            resolvers: [ElementPlusResolver({ importStyle: false })],
            imports: ["vue"],
            dts: false,
          }),
          Components({
            resolvers: [ElementPlusResolver({ importStyle: false })],
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
        resolve: { alias },
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["src/**/*.dom.test.ts"],
          setupFiles: ["src/test/setup-canvas.ts"],
        },
      },
    ],
  },
});
