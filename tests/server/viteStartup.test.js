import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { optimizeDeps, resolveConfig } from "vite";

test("cold startup prepares UI dependencies without warming every screen", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "app-vite-startup-"));
  try {
    const config = await resolveConfig({ cacheDir, logLevel: "silent" }, "serve");
    assert.equal(config.server.warmup.clientFiles.length, 1,
      "Warm only the selected entry; pages and components should load on demand.");
    assert.doesNotMatch(config.server.warmup.clientFiles[0], /[*?{}]/u);

    const metadata = await optimizeDeps(config, true);
    for (const dependency of [
      "vuetify/components/VBtn",
      "vuetify/components/VDatePicker",
      "vuetify/directives/ripple",
      "@jskit-ai/shell-web/client/navigation/usePaths",
      "@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext",
      "@jskit-ai/shell-web/client/composables/useShellLayoutState"
    ]) {
      assert.ok(metadata.optimized[dependency], `${dependency} must be ready before the first page loads.`);
    }
    assert.equal(Object.keys(metadata.optimized).some(name => name.startsWith("@local/")), false,
      "Local application packages must remain editable source.");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
