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
    coverage: {
      provider: "v8",
      // Both projects contribute; run the whole suite to get real numbers.
      include: ["src/**/*.{ts,vue}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.dom.test.ts",
        "src/test/**",
        "src/transport/conformance/**",
        // Type-only modules and ambient declarations have nothing to execute.
        "src/env.d.ts",
        "src/composables/wire.ts",
        "src/transport/TimeseriesTransport.ts",
      ],
      reporter: ["text-summary", "json-summary", "html"],
      // Floors, not targets. Each sits a few points under what the suite covers
      // today, so an unrelated change does not fail CI, but a real regression
      // does. Raise them when coverage rises; never lower one to make CI pass.
      thresholds: {
        statements: 78,
        lines: 78,
        functions: 70,
        branches: 70,
        // The data layer is where correctness lives and it is cheap to test, so
        // it is held far higher than the component average.
        "src/stores/**": { statements: 95, lines: 95, functions: 95, branches: 90 },
        "src/composables/**": { statements: 85, lines: 85, functions: 85, branches: 75 },
        "src/rendering/**": { statements: 95, lines: 95, functions: 95, branches: 90 },
        "src/interaction/**": { statements: 95, lines: 95, functions: 95, branches: 90 },
        "src/filters/**": { statements: 95, lines: 95, functions: 95, branches: 90 },
        "src/events/**": { statements: 95, lines: 95, functions: 95, branches: 90 },
      },
    },
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
