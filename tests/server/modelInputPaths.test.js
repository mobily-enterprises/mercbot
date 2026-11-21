import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { MODEL_CALLS, MODEL_INPUTS } from "../../packages/bots/src/server/modelInputs.js";

// R12 (D-112): every path that builds a model's input has a row in packages/bots/src/server/modelInputs.js, which
// names what it reads and its reach. The scan below counts the model calls in the server source; a call site with no
// row, or a row whose counts no longer match, fails here, so a new model call can't reach a prompt unlisted.
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SOURCE_ROOTS = ["packages", "server", "src/server"];
const REACHES = new Set(["reader", "public", "none"]);
// The table itself names the calls: it isn't a call site.
const TABLE = "packages/bots/src/server/modelInputs.js";

/** Every server-side source file under the roots, as a path from the repository's root. */
function sourceFiles() {
  const files = [];
  const walk = (folder) => {
    let entries;
    try {
      entries = readdirSync(path.join(ROOT, folder), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const relative = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "client" || entry.name === "test" || entry.name === "tests") continue;
        walk(relative);
      } else if (/\.(?:js|mjs|cjs)$/u.test(entry.name) && relative.split(path.sep).join("/") !== TABLE) {
        files.push(relative.split(path.sep).join("/"));
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(root);
  return files;
}

/** The model calls one source makes, by call: code only, comments and imports left out. */
function callsIn(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|import\s)/u.test(line))
    .join("\n");
  const counts = {};
  for (const call of MODEL_CALLS) {
    const pattern = call.includes("/")
      ? new RegExp(call.replace(/[/]/gu, "\\/"), "gu")
      : new RegExp(`\\b${call}\\s*\\(`, "gu");
    const found = code.match(pattern)?.length ?? 0;
    if (found) counts[call] = found;
  }
  return counts;
}

/** The model calls of every source file that makes one, by file. */
function scanned() {
  const byFile = new Map();
  for (const file of sourceFiles()) {
    const counts = callsIn(readFileSync(path.join(ROOT, file), "utf8"));
    if (Object.keys(counts).length) byFile.set(file, counts);
  }
  return byFile;
}

/** The scanned calls against the table: what's missing, extra or miscounted. */
function mismatches(byFile, inputs) {
  const rows = new Map(inputs.map((row) => [row.file, row]));
  const problems = [];
  for (const [file, counts] of byFile) {
    const row = rows.get(file);
    if (!row) problems.push(`${file} calls ${JSON.stringify(counts)} with no row in modelInputs.js: add one (what it reads, its reach).`);
    else if (JSON.stringify(sorted(row.calls)) !== JSON.stringify(sorted(counts))) {
      problems.push(`${file} calls ${JSON.stringify(sorted(counts))}, its row says ${JSON.stringify(sorted(row.calls))}: update the row.`);
    }
  }
  for (const file of rows.keys()) {
    if (!byFile.has(file)) problems.push(`modelInputs.js lists ${file}, which makes no model call: remove its row.`);
  }
  return problems;
}

const sorted = (counts) => Object.fromEntries(Object.entries(counts).sort(([first], [second]) => first.localeCompare(second)));

test("every model call site in the server source has its row in modelInputs.js, with its counts", () => {
  assert.deepEqual(mismatches(scanned(), MODEL_INPUTS), []);
});

test("every row says what its path reads and a reach the model's reader decides", () => {
  for (const row of MODEL_INPUTS) {
    assert.ok(REACHES.has(row.reach), `${row.file}: reach "${row.reach}" is none of ${[...REACHES].join(", ")}`);
    assert.ok(row.path.trim() && row.reads.trim(), `${row.file} names its path and what it reads`);
  }
  assert.equal(new Set(MODEL_INPUTS.map((row) => row.file)).size, MODEL_INPUTS.length, "one row per file");
});

test("a new model call, or one in a file with no row, fails the guard by name", () => {
  const byFile = scanned();
  const [file, counts] = [...byFile].find(([name]) => name.endsWith("approvals.js"));
  const oneMore = new Map(byFile).set(file, { ...counts, generateOnce: counts.generateOnce + 1 });
  assert.match(mismatches(oneMore, MODEL_INPUTS).join("\n"), /approvals\.js calls .*generateOnce.*update the row/u);
  const unlisted = new Map(byFile).set("packages/bots/src/server/newPath.js", callsIn("await runLoop({ model });"));
  assert.match(mismatches(unlisted, MODEL_INPUTS).join("\n"), /newPath\.js calls \{"runLoop":1\} with no row/u);
  assert.deepEqual(callsIn("// generateOnce(\n/* runLoop( */\nimport { generateOnce } from \"x\";"), {}, "comments and imports aren't calls");
});
