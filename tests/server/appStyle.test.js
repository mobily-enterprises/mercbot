import assert from "node:assert/strict";
import test from "node:test";
import { checkStyle, scopeStyle } from "../../packages/apps/src/server/appStyle.js";
import { checkApp } from "../../packages/apps/src/shared/check.js";

// An app's own CSS (owner, 2026-10-30): anything goes inside the app's area, nothing outside it,
// nothing loaded from elsewhere.
test("an app's CSS is checked and fenced to its own area", () => {
  const css = `
    @font-face { font-family: "Brand"; src: url(https://fonts.gstatic.com/s/brand/v1/brand.woff2) format("woff2"); }
    :root { --accent: #ff3366; background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"); }
    body { font-family: "Brand", serif; }
    .x-hero, .app-node--table .v-table { animation: pop 1s; position: fixed; }
    @media (max-width: 600px) { .x-hero { display: none } }
    @keyframes pop { from { transform: scale(0.9) } to { transform: none } }`;
  assert.deepEqual(checkStyle(css).errors, []);
  const scoped = scopeStyle("a_123", css);
  assert.match(scoped, /^\[data-app-style="a_123"\] \{ contain: paint; isolation: isolate; \}/u, "the area paints only inside itself");
  assert.match(scoped, /\[data-app-style="a_123"\] \{ --accent/u, ":root is the app's area");
  assert.match(scoped, /\[data-app-style="a_123"\] \{ font-family: "aa_123-Brand", serif/u, "body too, with the app's own font name");
  assert.match(scoped, /\[data-app-style="a_123"\] \.x-hero, \[data-app-style="a_123"\] \.app-node--table \.v-table/u);
  assert.match(scoped, /@media \(max-width: 600px\) \{ \[data-app-style="a_123"\] \.x-hero/u);
  assert.match(scoped, /@keyframes aa_123-pop/u);
  assert.match(scoped, /animation: aa_123-pop 1s/u);
  assert.match(scoped, /font-family: "aa_123-Brand"; src: url\(https:\/\/fonts\.gstatic\.com/u);

  const refused = (text) => checkStyle(text).errors.map((error) => error.message).join(" | ");
  assert.match(refused('@import url("https://evil.example/x.css");'), /@import isn't allowed/u);
  assert.match(refused('input[value^="a"] { background: url(https://evil.example/a) }'), /can't be loaded/u);
  assert.match(refused("@font-face { font-family: X; src: url(https://evil.example/f.woff2) }"), /can't be loaded/u);
  assert.match(refused(".a { width: expression(alert(1)) }"), /isn't allowed/u);
  assert.match(refused("> .v-btn { color: red }"), /starts with a combinator/u);
  assert.match(refused(".a { color: red"), /doesn't parse|Unclosed/u);
  assert.deepEqual(checkStyle("").errors, []);
  assert.equal(scopeStyle("a_1", ""), "");
});

test("any part can carry class names for the app's CSS", () => {
  const app = (node) => ({ home: "a", screens: { a: { content: [node] } } });
  assert.deepEqual(checkApp(app({ type: "text", value: "Hi", class: "hero wide" }), []), []);
  assert.match(JSON.stringify(checkApp(app({ type: "text", value: "Hi", class: "Hero!" }), [])), /names for the app's CSS/u);
});
