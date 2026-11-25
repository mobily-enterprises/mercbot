import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// json-rest-api has one owner of its version: JSKIT, whose resource-runtime pins it exactly. The apps
// package uses it directly for AnyAPI (AnyapiRegistry, RestApiAnyapiKnexPlugin, ensureAnyApiSchema), so it
// takes a caret range: npm resolves the one copy at JSKIT's version, and a JSKIT release that moves the pin
// (or a connected JSKIT copy in a Vibe64 session) is never refused against an exact pin of Mercbot's own.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

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

test("no Mercbot package pins json-rest-api exactly: each one that uses it takes a caret range", () => {
  const specs = manifests().flatMap(([file, manifest]) => FIELDS
    .filter((field) => manifest[field]?.["json-rest-api"] !== undefined)
    .map((field) => `${file} ${field}: ${manifest[field]["json-rest-api"]}`));
  assert.ok(specs.length > 0, "the apps package uses json-rest-api directly, so some package declares it");
  assert.deepEqual(specs.filter((spec) => !/: \^\d+\.\d+\.\d+$/u.test(spec)), [],
    "json-rest-api's version belongs to JSKIT; a Mercbot package takes it as ^x.y.z, never an exact version");
});

test("the lock installs one json-rest-api, at the top, so the server runs one AnyAPI registry", () => {
  const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const copies = Object.keys(lock.packages).filter((key) => key === "node_modules/json-rest-api" || key.endsWith("/node_modules/json-rest-api"));
  assert.deepEqual(copies, ["node_modules/json-rest-api"]);
});
