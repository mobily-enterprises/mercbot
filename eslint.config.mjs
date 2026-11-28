import {
  baseConfig,
  clientFeaturesConfig,
  formatterConfig,
  nodeConfig,
  sizeLimitsConfig,
  typedFeaturesConfig,
  vueConfig,
  webConfig
} from "@jskit-ai/config-eslint/server";

// The checks of https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features and
// https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features, as errors.
const SERVER_SOURCES = ["packages/*/src/server/**", "packages/*/src/shared/**", "server/**", "server.js"];
const CLIENT_SOURCES = ["packages/*/src/client/**", "src/**"];
// Files under 750 lines and functions under 600 in all hand-written code, client and scripts included (rule 123).
const HAND_WRITTEN_SOURCES = ["packages/*/src/**", "src/**", "server/**", "server.js", "bin/**", "scripts/**", "config/**"];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", ".jskit/**", ".artifacts/**", ".tools/**", "artifacts/**", "tests/agent-evals/**/files/**",
      // An AI assistant's own scratch folders: never the app's code.
      ".claude/**", ".tmp-scripts/**"]
  },
  {
    files: ["src/pages/**/*.vue"],
    languageOptions: {
      globals: {
        definePage: "readonly"
      }
    }
  },
  ...baseConfig,
  // The typed-features rules at error over every package's server and shared code.
  ...typedFeaturesConfig(SERVER_SOURCES),
  ...vueConfig,
  // The client-features rules at error over every client tree.
  ...clientFeaturesConfig(CLIENT_SOURCES),
  ...webConfig,
  ...nodeConfig,
  // JSKIT's one formatter config, over server and shared code (STYLE-ADDENDUM rules 91, 103 and 104).
  ...formatterConfig(SERVER_SOURCES),
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES),
  // Every menu takes Mercbot's look, the popover (docs/ui-style.md, "Lists, chips, fields, tabs, menus"): a v-menu
  // without content-class="mb-popover" draws Vuetify's default list, too big and unlike every other menu.
  {
    files: ["src/**/*.vue", "packages/*/src/client/**/*.vue"],
    rules: {
      "vue/no-restricted-syntax": [
        "error",
        {
          selector: "VElement[name='v-menu']:not(:has(VStartTag > VAttribute[key.name='content-class'][value.value=/\\bmb-popover\\b/]))",
          message: 'A menu takes Mercbot\'s look: give the v-menu content-class="mb-popover" (docs/ui-style.md, menus).'
        }
      ]
    }
  }
];
