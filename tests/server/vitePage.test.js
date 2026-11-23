import assert from "node:assert/strict";
import test from "node:test";
import { fromVitePage } from "../../server/lib/vitePage.js";

// Vite hands the API what its own page sends as from the API's own address (vite.config.mjs); anything else keeps its
// Origin, so packages/single-user's gate still refuses it.
test("Vite's own page counts under either scheme, and nothing else does", () => {
  assert.equal(fromVitePage("http://127.0.0.1:3001", "127.0.0.1:3001"), true, "a page opened straight from Vite");
  assert.equal(fromVitePage("https://127.0.0.1:3003", "127.0.0.1:3003"), true, "Vibe64's Preview, served over HTTPS");
  assert.equal(fromVitePage("https://127.0.0.1:3002", "127.0.0.1:3003"), false, "another port");
  assert.equal(fromVitePage("http://localhost:3003", "127.0.0.1:3003"), false, "another name");
  assert.equal(fromVitePage("https://evil.example", "127.0.0.1:3003"), false, "another site");
  assert.equal(fromVitePage("null", "127.0.0.1:3003"), false, "a file");
  assert.equal(fromVitePage(undefined, "127.0.0.1:3003"), false, "no Origin");
  assert.equal(fromVitePage("https://", ""), false, "no Host");
});
