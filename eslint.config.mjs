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
    ignores: ["dist/**", "node_modules/**", "coverage/**", "test-results/**", "playwright-report/**", ".jskit/**", ".artifacts/**", ".tools/**", "artifacts/**", "tests/agent-evals/**/files/**"]
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
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES)
];
