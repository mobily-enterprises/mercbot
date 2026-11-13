import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_THEME, __testables, checkTheme, effectiveTheme, onColor } from "../../packages/apps/src/shared/theme/index.js";

const { contrast } = __testables;

// App themes (D-35, stage 3): fixed choices, colours that can be seen on the page, readable text.
test("a theme is fixed choices with a colour that stands out from the page", () => {
  assert.deepEqual(checkTheme({ ...DEFAULT_THEME }), []);
  assert.deepEqual(checkTheme({ ...DEFAULT_THEME, color: "#1E5BD8", mode: "system" }), [], "blue works in light and dark");
  assert.match(checkTheme({ ...DEFAULT_THEME, color: "#FFEE58" }).join(" "), /too hard to see on a light page; pick a darker one/u);
  assert.match(checkTheme({ ...DEFAULT_THEME, mode: "dark" }).join(" "), /too hard to see on a dark page; pick a lighter one/u);
  assert.match(checkTheme({ ...DEFAULT_THEME, font: "comic" }).join(" "), /font must be one of: system, classic, serif, rounded/u);
  assert.match(checkTheme({ ...DEFAULT_THEME, css: "body{}" }).join(" "), /"css" isn't a theme setting/u);
  assert.match(checkTheme({ ...DEFAULT_THEME, color: "blue" }).join(" "), /must look like #1E86FC/u);
  assert.match(checkTheme({ ...DEFAULT_THEME, logo: "data:image/svg+xml;base64,PHN2Zz4=" }).join(" "), /PNG, JPEG or WebP/u, "no SVG (it could carry script)");
  assert.match(checkTheme({ ...DEFAULT_THEME, logo: `data:image/png;base64,${"A".repeat(300000)}` }).join(" "), /200 KB or smaller/u);
  assert.deepEqual(checkTheme({ density: "compact" }, { partial: true }), [], "an app's override is partial");
  assert.equal(onColor("#1C1C1C"), "#FFFFFF");
  assert.equal(onColor("#FFEE58"), "#000000");
  assert.ok(Math.abs(contrast("#FFFFFF", "#000000") - 21) < 0.01);
  assert.deepEqual(effectiveTheme({ ...DEFAULT_THEME, corners: "round" }, { color: "#0B7A5B" }), { ...DEFAULT_THEME, corners: "round", color: "#0B7A5B" });
});
