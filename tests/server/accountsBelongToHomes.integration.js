import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import migration from "../../migrations/20261121230000_accounts_belong_to_homes.cjs";
import { seal } from "../../packages/account/src/server/vaultCrypto.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The one-time move of people's own accounts to their homes (D-111), in a schema of its own inside a transaction that is
// rolled back: the tables it reads and changes, as small as it needs them, with the release before's rows. Each account
// goes to exactly one home, by its rule's branches in order; none makes it fail.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const KEY = randomBytes(32);

test("each own account moves to one home: its Drive's home, else the one other home, else the first home, else it goes", async (context) => {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  const schema = `accounts_to_homes_${randomBytes(4).toString("hex")}`;
  const keyBefore = process.env.MERCBOT_VAULT_KEY;
  process.env.MERCBOT_VAULT_KEY = KEY.toString("base64");
  const trx = await knex.transaction();
  try {
    await trx.raw(`CREATE SCHEMA ${schema}`);
    await trx.raw(`SET LOCAL search_path TO ${schema}`);
    await trx.raw("CREATE TABLE users (id bigint PRIMARY KEY)");
    await trx.raw("CREATE TABLE workspaces (id bigint PRIMARY KEY, owner_user_id bigint, is_personal boolean NOT NULL, deleted_at timestamptz)");
    await trx.raw("CREATE TABLE workspace_memberships (workspace_id bigint, user_id bigint, status text)");
    await trx.raw(`CREATE TABLE plugin_accounts (
      id bigint PRIMARY KEY, user_id bigint NOT NULL, workspace_id bigint REFERENCES workspaces (id) ON DELETE CASCADE,
      plugin_id varchar(64) NOT NULL, name varchar(80) NOT NULL DEFAULT '', label text, tokens jsonb, pace text
    )`);
    await trx.raw("CREATE UNIQUE INDEX ix_plugin_accounts_home_app_unlabelled ON plugin_accounts (workspace_id, plugin_id) WHERE workspace_id IS NOT NULL AND name = '' AND plugin_id IN ('sedna')");
    await trx.raw("CREATE TABLE user_plugins (user_id bigint NOT NULL, plugin_id varchar(64) NOT NULL, installed_at timestamptz NOT NULL)");
    await trx.raw("CREATE TABLE file_storage (workspace_id bigint NOT NULL, kind text NOT NULL, settings jsonb NOT NULL, move jsonb)");
    await trx.raw("CREATE TABLE connect_follow_ups (id bigint PRIMARY KEY, user_id bigint, plugin_id text, personal boolean, status text)");
    await trx.raw("CREATE INDEX ix_connect_follow_ups_person ON connect_follow_ups (user_id, plugin_id) WHERE status = 'waiting'");

    // Ann has her own first home (1), is in Shipping (2), and was in a home since deleted (6). Ben has his own (3) and is
    // in Shipping and the Office (4). Cy has no home of his own, only Shipping. Dee is in no home. Eve's own home (5)
    // keeps its files in a Drive sealed under another key, which the move can't read.
    await trx("users").insert([1, 2, 3, 4, 5].map((id) => ({ id })));
    await trx("workspaces").insert([
      { id: 1, owner_user_id: 1, is_personal: true },
      { id: 2, owner_user_id: 2, is_personal: false },
      { id: 3, owner_user_id: 2, is_personal: true },
      { id: 4, owner_user_id: 2, is_personal: false },
      { id: 5, owner_user_id: 5, is_personal: true },
      { id: 6, owner_user_id: 1, is_personal: false, deleted_at: new Date() }
    ]);
    await trx("workspace_memberships").insert([
      [1, 1], [2, 1], [6, 1], [3, 2], [2, 2], [4, 2], [2, 3], [5, 5]
    ].map(([workspaceId, userId]) => ({ workspace_id: workspaceId, user_id: userId, status: "active" })));
    await trx("plugin_accounts").insert([
      { id: 11, user_id: 1, plugin_id: "gmail", label: "ann@example.com", tokens: JSON.stringify({ sealed: "a" }), pace: "fast" },
      { id: 12, user_id: 1, plugin_id: "google-drive", label: "ann@example.com" },
      { id: 13, user_id: 2, plugin_id: "outlook", label: "ben@example.com" },
      { id: 14, user_id: 2, plugin_id: "google-drive", label: "ben@example.com" },
      { id: 15, user_id: 3, plugin_id: "github", label: "cy" },
      { id: 16, user_id: 4, plugin_id: "gmail", label: "dee@example.com" },
      { id: 17, user_id: 5, plugin_id: "google-drive", label: "eve@example.com" },
      { id: 18, user_id: 2, workspace_id: 2, plugin_id: "sedna", name: "" },
      { id: 19, user_id: 1, plugin_id: "sedna", name: "" },
      { id: 20, user_id: 3, workspace_id: 4, plugin_id: "slack", label: "already the office's" }
    ]);
    const at = new Date("2026-11-01T00:00:00Z");
    await trx("user_plugins").insert([
      [1, "gmail"], [1, "google-drive"], [1, "sedna"], [1, "notion"], [2, "outlook"], [2, "trello"], [4, "asana"]
    ].map(([userId, pluginId]) => ({ user_id: userId, plugin_id: pluginId, installed_at: at })));
    // Ann's own home keeps its files in her Drive; the Office is moving its files into Ben's.
    await trx("file_storage").insert([
      { workspace_id: 1, kind: "drive", settings: JSON.stringify(seal({ accountId: "12", userId: "1", label: "ann@example.com" }, KEY)) },
      { workspace_id: 4, kind: "mercbot", settings: JSON.stringify(seal({}, KEY)), move: JSON.stringify({ target: seal({ kind: "drive", accountId: "14", userId: "2" }, KEY) }) },
      { workspace_id: 5, kind: "drive", settings: JSON.stringify(seal({ accountId: "17", userId: "5" }, randomBytes(32))) }
    ]);
    await trx("connect_follow_ups").insert({ id: 1, user_id: 1, plugin_id: "gmail", personal: true, status: "waiting" });

    await migration.up(trx);

    const homes = Object.fromEntries((await trx("plugin_accounts").orderBy("id").select("id", "workspace_id")).map((row) => [row.id, String(row.workspace_id)]));
    assert.deepEqual(homes, {
      11: "2", // Ann's Gmail: Shipping, the one home she's in besides her own (the deleted one doesn't count)
      12: "1", // Ann's Drive: her own home, whose files it keeps, before the one-other-home branch
      13: "3", // Ben's Outlook: two other homes, so his own first home
      14: "4", // Ben's Drive: the Office, which is moving its files into it
      15: "2", // Cy's GitHub: his one home
      17: "5", // Eve's Drive, its home's setting unreadable: her own first home all the same
      18: "2", // Shipping's Sedna stays
      19: "2", // Ann's unlabelled Sedna: Shipping, named so the home's one unlabelled Sedna stays one
      20: "4" // already the Office's
    }, "Dee's, in no home, is gone");
    const kept = await trx("plugin_accounts").where({ id: 11 }).first();
    assert.deepEqual([String(kept.user_id), kept.label, kept.tokens, kept.pace], ["1", "ann@example.com", { sealed: "a" }, "fast"], "the same row, keys and pace kept");
    assert.equal((await trx("plugin_accounts").where({ id: 19 }).first()).name, "Sedna 19");

    const marks = (await trx("home_plugins").orderBy(["workspace_id", "plugin_id"]).select("workspace_id", "plugin_id", "user_id", "installed_at"))
      .map((row) => [String(row.workspace_id), row.plugin_id, String(row.user_id), row.installed_at.getTime() === at.getTime()]);
    assert.deepEqual(marks, [
      ["1", "google-drive", "1", true],
      ["1", "notion", "1", true], // Ann's app with no account: her first home
      ["2", "github", "3", false], // Cy never added GitHub to a list: it's on the home's now
      ["2", "gmail", "1", true],
      ["2", "sedna", "2", false], // the first Sedna account's adder, Ben
      ["3", "outlook", "2", true],
      ["3", "trello", "2", true], // Ben's app with no account: his first home
      ["4", "google-drive", "2", false], // Ben never listed Google Drive himself
      ["4", "slack", "3", false],
      ["5", "google-drive", "5", false]
    ], "Dee's Asana had no home to go to");

    // user_plugins and the follow-ups' personal column and person index are gone; every account names its home.
    assert.equal((await trx.raw("SELECT to_regclass('user_plugins') AS found")).rows[0].found, null);
    assert.equal((await trx.raw("SELECT to_regclass('ix_connect_follow_ups_person') AS found")).rows[0].found, null);
    assert.equal(await trx.schema.hasColumn("connect_follow_ups", "personal"), false);
    await trx.raw("SAVEPOINT refused");
    await assert.rejects(trx("plugin_accounts").insert({ id: 30, user_id: 1, plugin_id: "gmail" }), { code: "23502" });
    await trx.raw("ROLLBACK TO SAVEPOINT refused");
    await assert.rejects(trx("home_plugins").insert({ workspace_id: 2, plugin_id: "gmail", user_id: 3 }), /uq_home_plugins/u);
  } finally {
    await trx.rollback();
    if (keyBefore === undefined) delete process.env.MERCBOT_VAULT_KEY;
    else process.env.MERCBOT_VAULT_KEY = keyBefore;
  }
});

test("with no vault key the Drive branch finds nothing and the rest still moves every account", async (context) => {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  const schema = `accounts_to_homes_${randomBytes(4).toString("hex")}`;
  const keyBefore = process.env.MERCBOT_VAULT_KEY;
  delete process.env.MERCBOT_VAULT_KEY;
  const trx = await knex.transaction();
  try {
    await trx.raw(`CREATE SCHEMA ${schema}`);
    await trx.raw(`SET LOCAL search_path TO ${schema}`);
    await trx.raw("CREATE TABLE users (id bigint PRIMARY KEY)");
    await trx.raw("CREATE TABLE workspaces (id bigint PRIMARY KEY, owner_user_id bigint, is_personal boolean NOT NULL, deleted_at timestamptz)");
    await trx.raw("CREATE TABLE workspace_memberships (workspace_id bigint, user_id bigint, status text)");
    await trx.raw("CREATE TABLE plugin_accounts (id bigint PRIMARY KEY, user_id bigint NOT NULL, workspace_id bigint, plugin_id varchar(64) NOT NULL, name varchar(80) NOT NULL DEFAULT '')");
    await trx.raw("CREATE TABLE user_plugins (user_id bigint NOT NULL, plugin_id varchar(64) NOT NULL, installed_at timestamptz NOT NULL)");
    await trx.raw("CREATE TABLE file_storage (workspace_id bigint NOT NULL, kind text NOT NULL, settings jsonb NOT NULL, move jsonb)");
    await trx.raw("CREATE TABLE connect_follow_ups (id bigint PRIMARY KEY, user_id bigint, plugin_id text, personal boolean, status text)");
    await trx.raw("CREATE INDEX ix_connect_follow_ups_person ON connect_follow_ups (user_id, plugin_id) WHERE status = 'waiting'");
    await trx("users").insert([{ id: 1 }]);
    await trx("workspaces").insert([{ id: 1, owner_user_id: 1, is_personal: true }, { id: 2, owner_user_id: 1, is_personal: false }]);
    await trx("workspace_memberships").insert([{ workspace_id: 1, user_id: 1, status: "active" }, { workspace_id: 2, user_id: 1, status: "active" }]);
    await trx("plugin_accounts").insert({ id: 1, user_id: 1, plugin_id: "google-drive" });
    await trx("file_storage").insert({ workspace_id: 1, kind: "drive", settings: JSON.stringify(seal({ accountId: "1" }, KEY)) });
    await migration.up(trx);
    assert.equal(String((await trx("plugin_accounts").where({ id: 1 }).first()).workspace_id), "2", "the one other home, as no Drive could be read");
  } finally {
    await trx.rollback();
    if (keyBefore !== undefined) process.env.MERCBOT_VAULT_KEY = keyBefore;
  }
});
