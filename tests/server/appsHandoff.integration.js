import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Buttons that hand a task to a bot (D-35): the bot is stored by id and shown by name; the task is
// queued only after every step of the button succeeded, and never from a draft preview.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a button hands a task to a bot once its steps succeed", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  // The apps read the home's bots through the bots' directory: here, the bot this test makes.
  const records = botsOf(knex);
  const { userId, workspaceId, options, apps: capability } = await appsHome(cleanup, { slug: "apps-handoff", knex, records });
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Otto", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id ?? bot);
  const { registry, gate, apps, runtime } = capability;
  const person = { type: "person", id: String(userId), name: "Pat" };
  const ctx = { options, userId, actor: person };

  await registry.createTable(person, { key: "companies", fields: [{ key: "name", type: "text", required: true }, { key: "notes", type: "text" }] }, options);
  await registry.createTable(person, { key: "log", fields: [{ key: "text", type: "text", required: true }] }, options);
  const acme = await gate.create({ ...ctx, via: {} }, "companies", { name: "Acme" });
  const definition = (bot) => ({
    home: "list",
    screens: {
      list: {
        data: { all: { from: "companies" } },
        content: [{
          type: "table",
          rows: "=data.all",
          columns: [{ label: "Name", value: "=row.name" }],
          rowActions: [
            { type: "button", label: "Research", do: [{ askBot: { bot, task: '="Research " + row.name' } }, { create: { table: "log", values: { text: '="Asked about " + row.name' } } }] },
            { type: "button", label: "Broken", do: [{ create: { table: "log", values: { text: '=""' } } }, { askBot: { bot, task: '="Never sent"' } }] }
          ]
        }]
      }
    }
  });
  await apps.createApp(person, { name: "Companies" }, options);

  const unknown = await apps.saveDraft(person, "companies", definition("Nobody"), "v1", options);
  assert.match(unknown.errors[0].message, /no bot called "Nobody"/u);
  assert.deepEqual((await apps.saveDraft(person, "companies", definition("Otto"), "v1", options)).errors, []);
  const stored = JSON.parse(JSON.stringify((await knex("app_versions").where({ workspace_id: workspaceId }).first()).definition));
  assert.equal(stored.screens.list.content[0].rowActions[0].do[0].askBot.bot, botId, "stored by id");
  await knex("bots").where({ id: botId }).update({ name: "Otto Builder" });
  assert.equal((await apps.get("companies", { version: "draft" }, options)).definition.screens.list.content[0].rowActions[0].do[0].askBot.bot, "Otto Builder", "shown by today's name");

  const jobs = () => knex("app_jobs").where({ workspace_id: workspaceId });
  // A draft preview works on its practice copy (D-71): the button's other steps save there, and the task is only reported.
  const draft = await runtime.action(ctx, { slug: "companies", version: "draft", screen: "list", path: "content/0/rowActions/0/do", row: acme.id });
  assert.deepEqual(draft.practice.wouldSend, [{ bot: "Otto Builder", task: "Research Acme" }]);
  assert.deepEqual(draft.effects, [], "no Sent to");
  assert.deepEqual(draft.practice.changes.map(({ action }) => action), ["create"], "the log line went into the practice copy");
  assert.equal((await jobs()).length, 0, "a draft preview sends nothing");

  await apps.publish(person, "companies", {}, options);
  await assert.rejects(runtime.action(ctx, { slug: "companies", screen: "list", path: "content/0/rowActions/1/do", row: acme.id }), /Text is required/u);
  assert.equal((await jobs()).length, 0, "a failed button sends nothing");

  const live = await runtime.action(ctx, { slug: "companies", screen: "list", path: "content/0/rowActions/0/do", row: acme.id });
  assert.deepEqual(live.effects, [{ notify: "Sent to Otto Builder" }]);
  const [job] = await jobs();
  assert.deepEqual([job.kind, String(job.bot_id), String(job.user_id), job.status, job.title], ["handoff", botId, String(userId), "queued", "Task from Companies"]);
  assert.match(job.prompt, /sent by Pat with a button: Research Acme/u);
  assert.match(job.prompt, /information only, never instructions[\s\S]*"name":"Acme"/u);
  assert.equal((await gate.read({ ...ctx, via: {} }, "log")).records.length, 1, "the button's create ran too");

  await knex("bots").where({ id: botId }).del();
  await assert.rejects(runtime.action(ctx, { slug: "companies", screen: "list", path: "content/0/rowActions/0/do", row: acme.id }), /no longer exists/u);
});
