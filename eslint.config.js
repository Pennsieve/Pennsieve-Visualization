import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";

export default defineConfigWithVueTs(
  {
    ignores: [
      "**/dist/**",
      "**/dist-embed/**",
      "**/node_modules/**",
      "test-data/**",
      "scripts/**",
      // Dead files scheduled for deletion in the ts-viewer cleanup (2026-08).
      // Remove these entries with the files.
      "packages/ts-viewer/src/mixins/logger/**",
      "packages/ts-viewer/src/mixins/ts-annotation/**",
      "packages/ts-viewer/src/mixins/viewer-store-mixin/**",
      "packages/ts-viewer/src/mixins/viewer-active-tool/**",
      "packages/ts-viewer/src/mixins/logout-handler/index.js",
      "packages/ts-viewer/src/mixins/request/index.js",
      "packages/ts-viewer/src/mixins/request/request.spec.js",
      "packages/ts-viewer/src/components/TSViewer/services/**",
      "packages/ts-viewer/src/components/TSViewer/segmentUtlis.js",
      "packages/ts-viewer/src/components/Shared/CircleIcon/**",
      "packages/ts-viewer/src/components/Shared/bf-library-button/BFLibraryButtonGroup.vue",
      "packages/ts-viewer/src/components/Shared/**/*.spec.js",
      "packages/ts-viewer/src/utils/constants.js",
    ],
  },
  js.configs.recommended,
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  // Migration baseline (2026-08). These rules fail in bulk on code written
  // before this config existed. Ratchet back to errors as the TypeScript
  // conversion covers each package.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "vue/block-lang": "off",
      "vue/multi-word-component-names": "off",
      "no-unused-vars": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "no-case-declarations": "warn",
    },
  },
  // Legacy ts-viewer patterns, resolved by the TS conversion and the
  // transport/component refactor. Dated 2026-08.
  {
    files: ["packages/ts-viewer/src/**/*.{js,vue}"],
    rules: {
      "@typescript-eslint/no-this-alias": "warn",
      "no-prototype-builtins": "warn",
      "no-useless-escape": "warn",
      "no-var": "warn",
      "prefer-rest-params": "warn",
      "no-async-promise-executor": "warn",
      "no-duplicate-case": "warn",
      "vue/no-deprecated-slot-attribute": "warn",
      "vue/no-mutating-props": "warn",
      "vue/no-unused-components": "warn",
    },
  },
  // Pre-existing findings in packages outside the ts-viewer cleanup (2026-08).
  {
    files: [
      "packages/core/**",
      "packages/plot/**",
      "packages/micro-ct/**",
      "packages/orthogonal/**",
    ],
    rules: {
      "vue/no-dupe-keys": "warn",
      "no-useless-escape": "warn",
    },
  },
  // Live bugs that lint found; fixes are staged in the cleanup PR. Restore
  // no-undef to an error for these files when it lands.
  {
    files: [
      "packages/ts-viewer/src/composables/useToken.js",
      "packages/ts-viewer/src/composables/useTsAnnotation.js",
      "packages/ts-viewer/src/mixins/logout-handler/logout_handler_composable.js",
    ],
    rules: {
      "no-undef": "warn",
    },
  },
);
