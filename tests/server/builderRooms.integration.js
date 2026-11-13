import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// A shared Builder keeps one conversation per app (owner, 2026-10-30): the app's room is made fresh
// the first time, named after the app, opened for the person, and found again afterwards; only a
// shared bot has one, and only for an app of its own home.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a shared Builder has one conversation per app", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const builder = await testBot(knex, userId, { name: "Bea" });
  const [app] = await knex("apps").insert({ id: `a_rooms${Date.now()}`.slice(0, 24), workspace_id: builder.workspace_id, slug: `rooms-${Date.now()}`, name: "Stock tracker", icon: "apps", color: "#1E5BD8" }).returning("*");
  const [elsewhere] = await knex("workspaces").insert({ slug: `rooms-other-${Date.now()}`, name: "Other", owner_user_id: userId, is_personal: false }).returning("id");
  const [foreign] = await knex("apps").insert({ id: `a_other${Date.now()}`.slice(0, 24), workspace_id: elsewhere.id ?? elsewhere, slug: "foreign", name: "Foreign", icon: "apps", color: "#1E5BD8" }).returning("*");
  context.after(async () => {
    await knex("bots").where({ id: builder.id }).del();
    await knex("apps").whereIn("id", [app.id, foreign.id]).del();
    await knex("workspaces").where({ id: elsewhere.id ?? elsewhere }).del();
    await knex.destroy();
  });
  // apps.findApp as the apps feature answers it: one app of the call's home, of one kind.
  const findApp = async (appId, _options, { kind } = {}) =>
    (await knex("apps").where({ id: appId, workspace_id: builder.workspace_id, ...(kind ? { kind } : {}) }).first("id", "name", "slug", "kind")) ?? null;
  const records = await startBotRecords(knex, context);
  const bots = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    apps: { apps: { findApp } },
    reply: async () => ({ text: "ok", transcript: [] })
  }));
  const options = memberOptions({ userId, homeId: builder.workspace_id });

  await assert.rejects(bots.roomForApp(builder.id, { appId: app.id }, options), /Only a shared bot/u);
  await bots.updateBot(builder.id, { sharing: "shared" }, options);
  const first = await bots.roomForApp(builder.id, { appId: app.id, title: app.name }, options);
  assert.equal(first.room.title, "Stock tracker");
  assert.equal(first.room.parentId, null, "fresh: it doesn't continue another conversation");
  assert.equal(first.bot.roomId, first.room.id, "opened for the person");
  const stored = await knex("bot_conversations").where({ id: first.room.id }).first();
  assert.equal(stored.app_id, app.id);

  // Found again, also when two pages ask at once.
  const [again, twice] = await Promise.all([bots.roomForApp(builder.id, { appId: app.id }, options), bots.roomForApp(builder.id, { appId: app.id }, options)]);
  assert.equal(again.room.id, first.room.id);
  assert.equal(twice.room.id, first.room.id);
  assert.equal((await knex("bot_conversations").where({ bot_id: builder.id, app_id: app.id })).length, 1);
  await assert.rejects(bots.roomForApp(builder.id, { appId: foreign.id }, options), /isn't in this home/u);
  const list = await bots.listBots(options);
  const listed = (list.bots || list).find((bot) => String(bot.id) === String(builder.id));
  assert.ok(listed.rooms.some((room) => room.title === "Stock tracker"), "a tab like any other");
});
