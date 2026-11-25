import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// json-rest-api belongs to JSKIT: its resource-runtime runs one copy. json-rest-api knows the transactions
// api.transaction opened by identity, and AnyAPI its registry with instanceof, so the apps package's AnyAPI writes, which
// join the transaction an audit_events handle opened, work only on that copy. The apps package takes AnyAPI from
// @jskit-ai/resource-runtime/server/anyapi and no Mercbot package declares json-rest-api, so npm run jskit:update moves
// Mercbot's one copy with JSKIT's catalog and never leaves a second one beside it.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const SOURCE_ROOTS = ["packages", "server", "src", "tests", "scripts", "bin", "config", "migrations", "server.js"];
const SOURCE_FILE = /\.(?:[cm]?js|vue)$/u;
const SKIPPED = new Set(["node_modules", "dist", "coverage", "test-results", "playwright-report"]);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']json-rest-api(?:\/[^"']*)?["']/u;

function manifests() {
  const found = [["package.json", JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))]];
  for (const entry of readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join("packages", entry.name, "package.json");
    try {
      found.push([file, JSON.parse(readFileSync(path.join(ROOT, file), "utf8"))]);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return found;
}

function sourceFiles(relative) {
  const absolute = path.join(ROOT, relative);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return SOURCE_FILE.test(relative) ? [relative] : [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => !SKIPPED.has(entry.name))
    .flatMap((entry) => sourceFiles(path.join(relative, entry.name)));
}

test("no Mercbot package declares json-rest-api: its one copy comes with JSKIT's resource-runtime", () => {
  const declared = manifests().flatMap(([file, manifest]) => FIELDS
    .filter((field) => manifest[field]?.["json-rest-api"] !== undefined)
    .map((field) => `${file} ${field}: ${manifest[field]["json-rest-api"]}`));
  assert.deepEqual(declared, []);
});

test("no Mercbot source imports json-rest-api: AnyAPI comes from @jskit-ai/resource-runtime/server/anyapi", () => {
  const files = SOURCE_ROOTS.flatMap((root) => sourceFiles(root));
  assert.ok(files.includes(path.join("packages", "apps", "src", "server", "anyapi.js")), "the walk reads the apps package's sources");
  const importing = files.filter((file) => IMPORT.test(readFileSync(path.join(ROOT, file), "utf8")));
  assert.deepEqual(importing, []);
});
