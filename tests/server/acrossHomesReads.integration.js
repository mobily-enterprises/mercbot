import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createAppsRepository } from "../../packages/apps/src/server/appsRepository.js";
import { appResource } from "../../packages/apps/src/server/tableResources.js";
import { createFileStorageRepository } from "../../packages/files/src/server/fileStorageRepository.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { memberOptions, startBotRecordsForChecks } from "../support/botRecords.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { plansDuring, queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The reads over every home a system context reaches: the bots and apps a person made, with their homes, the chats a
// person is in in a few homes (D-112), how many public apps each home has, and where each home keeps its files. Each is
// one statement however many homes it names, and a home's own request still reads only that home.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** What `work` answers, and how many statements matching `matching` it sent. */
async function counted(knex, work, matching) {
  let result;
  const count = await queriesDuring(knex, async () => (result = await work()), { matching });
  return { result, count };
}

test("a person's bots and apps across their homes, each home's public apps and its storage", async (context) => {
  const knex = await connectTestDatabase();
  const [maker, other] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  assert.ok(maker && other, "the test database needs two users");
  const stamp = randomBytes(5).toString("hex");
  const homes = [];
  for (const name of ["first", "second", "third"]) {
    const [row] = await knex("workspaces").insert({ slug: `across-${name}-${stamp}`, name, owner_user_id: maker, is_personal: false }).returning("id");
    homes.push(String(row.id ?? row));
  }
  const [first, second, third] = homes;
  context.after(async () => {
    for (const table of ["file_storage", "apps", "conversations", "bots", "workspace_memberships"]) await knex(table).whereIn("workspace_id", homes).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  await knex("workspace_memberships").insert(homes.map((id) => ({ workspace_id: id, user_id: maker, role_sid: "owner", status: "active" })));

  // Later than any other test's rows, so the newest of the person's rows are these.
  const at = (minutes) => new Date(Date.UTC(2099, 0, 1, 9, minutes));
  const bot = async (workspaceId, userId, name, minutes) =>
    String((await knex("bots").insert({ workspace_id: workspaceId, made_by: userId, name, color: "#1E86FC", created_at: at(minutes) }).returning("id"))[0].id);
  const older = await bot(first, maker, "Older", 1);
  const newer = await bot(second, maker, "Newer", 2);
  const newest = await bot(third, maker, "Newest", 3);
  await bot(first, other, "Someone else's", 4);

  const app = (id, workspaceId, fields) =>
    knex("apps").insert({ id: `${id}${stamp}`, workspace_id: workspaceId, slug: `${id}-${stamp}`, name: id, ...fields });
  await app("pub1", first, { made_by_user_id: maker, public_at: at(5), created_at: at(5) });
  await app("draft", second, { made_by_user_id: maker, created_at: at(6) });
  await app("gone", first, { made_by_user_id: maker, public_at: at(7), retired_at: at(8), created_at: at(7) });
  await app("pub2", first, { made_by_user_id: other, public_at: at(9), created_at: at(9) });
  await app("pub3", third, { made_by_user_id: null, made_by_bot_id: newer, public_at: at(10), created_at: at(10) });
  await knex("file_storage").insert({ workspace_id: second, kind: "webdav", settings: {} });

  const { records, systemContext } = await startBotRecordsForChecks(knex, context);
  const { features } = await ownedHandles(knex, context, { "mercbot.apps": [appResource], "mercbot.files": FILES_OWNS });
  const apps = createAppsRepository(features["mercbot.apps"].resources);
  const storage = createFileStorageRepository(features["mercbot.files"].resources);
  const everyHome = { context: systemContext("read a person's bots and apps in every home") };

  await context.test("the bots a person made, newest first, in every home, with their homes", async () => {
    const { result, count } = await counted(knex, () => records.makers.botsMadeBy(maker, 10, everyHome), /from "bots"/u);
    const mine = result.filter((row) => homes.includes(row.workspaceId));
    assert.deepEqual(mine.map((row) => [row.id, row.name, row.workspaceId]), [
      [newest, "Newest", third],
      [newer, "Newer", second],
      [older, "Older", first]
    ]);
    assert.equal(count, 1);
    assert.equal((await records.makers.botsMadeBy(maker, 1, everyHome)).length, 1, "the limit is the database's");
    // A request in one home reads that home's bots alone.
    const inFirst = await records.makers.botsMadeBy(maker, 10, memberOptions({ userId: maker, homeId: first, role: "owner" }));
    assert.deepEqual(inFirst.map((row) => row.id), [older]);
  });

  await context.test("the apps a person made, retired ones left out, with whether each is public", async () => {
    const { result, count } = await counted(knex, () => apps.appsMadeBy(maker, 10, everyHome), /from "apps"/u);
    assert.deepEqual(
      result.filter((row) => homes.includes(row.workspaceId)).map((row) => [row.name, row.workspaceId, row.publicAt !== null]),
      [["draft", second, false], ["pub1", first, true]]
    );
    assert.equal(count, 1);
  });

  await context.test("each home's public apps, counted in one statement", async () => {
    const { result, count } = await counted(knex, () => apps.publicAppsByHome(homes, everyHome), /from "apps"/u);
    assert.deepEqual([...result].sort(), [[first, 2], [third, 1]].sort());
    assert.equal(count, 1);
    assert.deepEqual([...(await apps.publicAppsByHome([], everyHome))], []);
  });

  await context.test("where each home keeps its files: a home without a row has none", async () => {
    const { result, count } = await counted(knex, () => storage.kindsByHome(homes, everyHome), /from "file_storage"/u);
    assert.deepEqual([...result], [[second, "webdav"]]);
    assert.equal(count, 1);
  });
});

test("the chats a person is in, in a few homes, latest activity first, without their titles or words", async (context) => {
  const knex = await connectTestDatabase();
  const [person, other] = (await knex("users").orderBy("id").limit(2).pluck("id")).map(String);
  const stamp = randomBytes(5).toString("hex");
  const homes = [];
  for (const name of ["first", "second", "elsewhere"]) {
    const [row] = await knex("workspaces").insert({ slug: `talks-${name}-${stamp}`, name, owner_user_id: person, is_personal: false }).returning("id");
    homes.push(String(row.id ?? row));
  }
  const [first, second, elsewhere] = homes;
  context.after(async () => {
    for (const table of ["conversations", "workspace_memberships"]) await knex(table).whereIn("workspace_id", homes).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  await knex("workspace_memberships").insert(homes.map((id) => ({ workspace_id: id, user_id: person, role_sid: "owner", status: "active" })));
  const at = (minutes) => new Date(Date.UTC(2099, 0, 1, 9, minutes));
  /** A chat in a home with `userId` in it (none for null), its latest activity at `minutes`, and its id. */
  const chat = async (workspaceId, userId, minutes, kind = "private") => {
    const [row] = await knex("conversations")
      .insert({ workspace_id: workspaceId, kind, title: "Talk", made_by: person, created_at: at(0), last_activity_at: at(minutes) })
      .returning("id");
    if (userId) await knex("chat_people").insert({ workspace_id: workspaceId, conversation_id: row.id, user_id: userId });
    return String(row.id);
  };
  const older = await chat(first, person, 1);
  const newer = await chat(second, person, 3, "public");
  const latest = await chat(first, person, 5);
  await chat(first, other, 9);
  await chat(elsewhere, person, 7);
  await chat(second, null, 8, "public");

  const { records, systemContext } = await startBotRecordsForChecks(knex, context);
  const everyHome = { context: systemContext("read the chats a person is in, in a few homes") };
  let result = null;
  const plans = await plansDuring(knex, async () => (result = await records.makers.chatsOf(person, [first, second], 10, everyHome)));
  assert.deepEqual(result, [
    { id: latest, kind: "private", workspaceId: first, createdAt: at(0).toISOString(), lastActivityAt: at(5).toISOString() },
    { id: newer, kind: "public", workspaceId: second, createdAt: at(0).toISOString(), lastActivityAt: at(3).toISOString() },
    { id: older, kind: "private", workspaceId: first, createdAt: at(0).toISOString(), lastActivityAt: at(1).toISOString() }
  ], "only the chats they're in, in the homes named, latest activity first, and only which, where and when each is");
  const read = plans.filter((plan) => /from "conversations"/u.test(plan.sql));
  assert.equal(read.length, 1, "one statement for every home named");
  assert.ok(!/"title"|"body"/u.test(read[0].sql), "no title and no message is read");
  assert.deepEqual((await records.makers.chatsOf(person, [first, second], 1, everyHome)).map((row) => row.id), [latest], "the limit is the database's");
  assert.deepEqual(await records.makers.chatsOf(person, [], 10, everyHome), []);
  // A request in one home reads that home's alone, whatever homes it names.
  const inFirst = await records.makers.chatsOf(person, [first, second], 10, memberOptions({ userId: person, homeId: first, role: "owner" }));
  assert.deepEqual(inFirst.map((row) => row.id), [latest, older]);
});
