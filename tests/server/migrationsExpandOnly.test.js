import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

// A copy on several servers is updated one server at a time, so for a while the release before runs beside the new one
// on the same database, and a migration runs while the old release still serves. Every migration after the baseline
// therefore only adds (expand): a table, a column, an index, a view, a constraint the old release already keeps. Taking
// something away (contract) waits for a later release, once no server runs code that reads it, and that migration says
// why it may (`exports.contracts`). A migration that drops or renames without saying so fails here, before it can erase
// rows or break the release still running.
const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASELINE = "20261113120000_baseline.cjs";
const TAKES_AWAY = [
  /\bdrop\s+(?:table|column|view|materialized\s+view|schema|type|function)\b/iu,
  /\.drop(?:Table|TableIfExists|Column|Columns|View|ViewIfExists|MaterializedView|Schema|SchemaIfExists)\s*\(/u,
  /\.rename(?:Table|Column)\s*\(/u,
  /\brename\s+(?:to|column)\b/iu,
  /\balter\s+column\s+\S+\s+(?:type|set\s+data\s+type|set\s+not\s+null)\b/iu,
  /\.(?:truncate|del|delete)\s*\(/u,
  /\b(?:truncate|delete\s+from)\b/iu
];

/** Each migration file of a folder, by name, with the folder it is in. */
function migrationsIn(folder) {
  return readdirSync(path.join(ROOT, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".cjs"))
    .map((entry) => path.join(folder, entry.name));
}

/** What a migration's `up` does that takes something away, or [] when it only adds. */
function takesAway(source) {
  return TAKES_AWAY.filter((pattern) => pattern.test(source)).map(String);
}

test("every migration after the baseline only adds, unless it says why it may take away", () => {
  const files = [...migrationsIn("migrations"), ...migrationsIn(path.join("migrations", "constraints"))]
    .filter((file) => path.basename(file) !== BASELINE);
  for (const file of files) {
    const migration = require(path.join(ROOT, file));
    assert.equal(typeof migration.up, "function", `${file} has an up`);
    if (typeof migration.contracts === "string" && migration.contracts.trim()) continue;
    assert.deepEqual(takesAway(String(migration.up)), [], `${file}'s up takes something away; add instead, or say why it may (exports.contracts)`);
  }
});

test("the check sees a migration that drops, renames or deletes, and lets one that adds through", () => {
  for (const source of [
    "await knex.schema.dropTable('home_balances')",
    "await knex.schema.dropTableIfExists('charge_holds')",
    "await knex.raw('drop table home_ledger')",
    "await knex.raw('ALTER TABLE usage_events DROP COLUMN charge_nano')",
    "await knex.schema.alterTable('bots', (t) => t.dropColumn('name'))",
    "await knex.schema.renameTable('bots', 'agents')",
    "await knex.raw('alter table bots rename column name to title')",
    "await knex.raw('alter table bots alter column name type text')",
    "await knex('home_top_ups').del()",
    "await knex.raw('truncate home_ledger')"
  ]) {
    assert.notDeepEqual(takesAway(source), [], source);
  }
  for (const source of [
    "await knex.raw('CREATE INDEX ix_apps_made_by_user ON apps (made_by_user_id)')",
    "await knex.schema.createTable('computer_hosts', (t) => t.string('server_id'))",
    "await knex.schema.alterTable('bots', (t) => t.string('title'))",
    "await knex.raw('alter table bots add column title text')"
  ]) {
    assert.deepEqual(takesAway(source), [], source);
  }
});
