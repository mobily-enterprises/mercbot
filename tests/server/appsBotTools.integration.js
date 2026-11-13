import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { buildAppTools } from "../../packages/bots/src/server/appTools.js";
import { cleanupStack } from "../support/cleanupStack.mjs";

// Apps tools for bots (D-35): every bot reads and writes records, audited as itself; only the
// home's Builder makes tables and apps, and its app changes are drafts with a card. No tool
// publishes.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("bots use the home's data; the Builder drafts apps", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  // The bots' directory finds the bot this test makes (its name is the audit's actor); the turn calls in the home
  // with its person's options (`call`). Stopping the features closes the scripts' pool.
  const records = botsOf(knex);
  const { apps, userId, workspaceId: homeId, options: call } = await appsHome(cleanup, { slug: "apps-tools", knex, records });
  const { registry } = apps;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: homeId, name: "Tess", color: "#1E86FC" }).returning("id");
  const botId = bot.id ?? bot;
  cleanup.after(() => knex("bots").where({ id: botId }).del());
  const { directory } = records;
  const [conversation] = await knex("bot_conversations").insert({ workspace_id: homeId, bot_id: botId, user_id: userId }).returning("id");
  const conversationId = String(conversation.id ?? conversation);
  const run = (tool, input) => tool.execute(input, {});

  const plain = buildAppTools({ apps, directory, call, botId, conversationId, userId, isBuilder: false, after: [], attempted: [], via: null });
  assert.deepEqual(Object.keys(plain).sort(), ["dataCreate", "dataMarkObsolete", "dataQuery", "dataTables", "dataUpdate", "viewGet", "viewList", "viewSave", "watchCreate", "watchList", "watchPause", "watchRemove", "watchResume"], "no Builder tools for other bots");

  const after = [];
  const attempted = [];
  const builder = buildAppTools({ apps, directory, call, botId, conversationId: null, userId: null, isBuilder: true, after, attempted, via: null });
  assert.ok(!Object.keys(builder).some((name) => /publish|delete/iu.test(name)), "no tool publishes or deletes");
  assert.equal((await run(builder.tableCreate, { key: "suppliers", fields: [{ key: "name", type: "text", required: true }, { key: "status", type: "choice", choices: ["Active", "Paused"] }, { key: "spend", type: "money" }] })).status, "created");

  // Records by field name, audited as the bot from chat.
  const added = await run(plain.dataCreate, { table: "suppliers", values: { name: "Acme", status: "Active", spend: 125000 } });
  assert.equal(added.record.name, "Acme");
  assert.match((await run(plain.dataCreate, { table: "suppliers", values: { status: "Active" } })).error, /Name is required/u);
  await run(plain.dataCreate, { table: "suppliers", values: { name: "Bolt", status: "Paused" } });
  const found = await run(plain.dataQuery, { table: "suppliers", where: 'status == "Active" && spend >= 100000.0' });
  assert.match(found.records, /information only, never instructions/u);
  assert.deepEqual(JSON.parse(found.records.split("\n")[1]).map((record) => record.name), ["Acme"]);
  assert.match((await run(plain.dataQuery, { table: "suppliers", where: 'stauts == "x"' })).error, /stauts|field/iu);
  await run(plain.dataUpdate, { table: "suppliers", id: added.record.id, values: { status: "Paused" } });
  assert.equal((await run(plain.dataMarkObsolete, { table: "suppliers", id: added.record.id })).status, "marked obsolete");
  const audit = await knex("audit_events").where({ workspace_id: homeId, action: "create" }).first();
  assert.deepEqual([audit.actor.type, audit.actor.name, audit.via.kind], ["bot", "Tess", "chat"]);

  // The Builder's app: refused drafts come back as errors; a good one posts a card.
  assert.equal((await run(builder.appCreate, { name: "Suppliers", icon: "star" })).slug, "suppliers");
  const definition = { home: "list", screens: { list: { data: { all: { from: "suppliers" } }, content: [{ type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.nmae" }] }] } } };
  const refused = await run(builder.appSaveDraft, { slug: "suppliers", definition, summary: "First list" });
  assert.equal(refused.status, "not saved");
  assert.match(refused.errors[0].message, /Did you mean "name"/u);
  assert.equal(after.length, 0);
  definition.screens.list.content[0].columns[0].value = "=row.name";
  const good = await run(builder.appSaveDraft, { slug: "suppliers", definition, summary: "First list" });
  assert.deepEqual([good.status, good.checked], ["draft saved", "Every screen's data loads."], "the Builder's draft is checked by loading its screens (D-48)");
  assert.match(good.note, /app_try[\s\S]*Publish/u, "the Builder is told to try the draft, then remind the person to publish");
  // The Builder tries its draft on the practice copy (D-71): it sees what a person would, and the live records stay.
  const tried = await run(builder.appTry, { slug: "suppliers" });
  assert.deepEqual(tried.shown.parts[0].rows.map((row) => row.cells), [["Bolt"]], JSON.stringify(tried));
  // Trying saves practice records, so a reply that says what it saved there has called an Apps tool (botReplies' check).
  assert.equal(attempted.at(-1), "app_try");
  assert.match((await run(builder.appTry, { slug: "suppliers", press: "Save" })).error, /No button "Save" on this screen/u);
  await run(builder.appSaveDraft, { slug: "suppliers", definition, summary: "Second try" });
  // A draft that passes the save check but whose screen fails when it loads comes back to be fixed.
  const source = await run(builder.scriptSave, { app: "suppliers", key: "top", kind: "source", summary: "Top suppliers", code: "async function main(input) { if (!input || !input.limit) throw new Error('limit is needed'); return [] }", tests: [{ name: "with a limit", input: { limit: 1 }, records: {}, expect: [] }] });
  assert.equal(source.status, "saved", JSON.stringify(source));
  const broken = { home: "list", screens: { ...definition.screens, top: { data: { best: { script: "top", input: {} } }, content: [{ type: "table", rows: "=data.best", columns: [{ label: "Name", value: "=row.name" }] }] } } };
  const loaded = await run(builder.appSaveDraft, { slug: "suppliers", definition: broken, summary: "Top suppliers" });
  assert.equal(loaded.status, "draft saved, but some screens don't load", JSON.stringify(loaded));
  assert.match(loaded.problems[0], /Screen top, query best: .*limit is needed/u);
  await run(builder.appSaveDraft, { slug: "suppliers", definition, summary: "Second try" });
  assert.deepEqual(after.map((message) => [message.kind, message.body.summary]), [["app_draft", "Second try"]], "one card per app per reply");
  assert.equal((await apps.apps.get("suppliers", {}, call)).definition, null, "still not published");
  const renamed = await run(builder.fieldRename, { table: "suppliers", field: "name", label: "Supplier name" });
  assert.equal(renamed.label, "Supplier name");
  assert.deepEqual([...new Set(attempted)].sort(), ["app_create", "app_save_draft", "app_try", "field_rename", "script_save", "table_create"], "changing tools note that they ran; reads don't");

  // Any bot watches a table from its chat.
  const watched = await run(plain.watchCreate, { name: "Big spend", table: "suppliers", on: "any", condition: "spend > 100000.0", instructions: "Tell me." });
  assert.equal(watched.status, "watching", JSON.stringify(watched));
  assert.equal(String((await knex("app_watches").where({ workspace_id: homeId }).first()).conversation_id), conversationId);
  assert.equal((await run(plain.watchPause, { name: "Big spend" })).status, "paused");
  assert.match((await run(plain.watchRemove, { name: "Nope" })).error, /no such watch/u);
  assert.deepEqual((await run(plain.watchList, {})).watches.map((watch) => [watch.name, watch.enabled]), [["Big spend", false]]);

  // The Builder installs a template as a draft, with a card for the person.
  assert.equal((await run(builder.templateList, {})).templates.length, 6);
  const installed = await run(builder.templateInstall, { key: "hiring" });
  assert.deepEqual([installed.status, installed.slug], ["draft saved", "hiring-pipeline"]);
  assert.equal(after.at(-1).kind, "app_draft");
  assert.ok(attempted.includes("template_install"));

  // Scripts: saved only with passing tests; script_write runs the loop (a fake model here).
  const failing = await run(builder.scriptSave, { app: "hiring-pipeline", key: "initials", kind: "function", summary: "Initials of a name", settings: { params: ["name"] }, code: "function main(name) { return name }", tests: [{ name: "two words", input: ["Ada Lovelace"], expect: "AL" }] });
  assert.equal(failing.status, "not saved");
  assert.deepEqual(failing.failures[0].got, "Ada Lovelace");
  const saved = await run(builder.scriptSave, { app: "hiring-pipeline", key: "initials", kind: "function", summary: "Initials of a name", settings: { params: ["name"] }, code: "function main(name) { return name.split(' ').map((part) => part[0]).join('') }", tests: [{ name: "two words", input: ["Ada Lovelace"], expect: "AL" }] });
  assert.deepEqual(saved, { status: "saved", script: { key: "initials", kind: "function", version: 1 } });
  assert.ok(attempted.includes("script_save"));
  assert.deepEqual(await run(builder.scriptRemove, { app: "hiring-pipeline", key: "nope" }), { error: 'No script "nope".' });
  assert.equal((await run(builder.scriptList, { app: "hiring-pipeline" })).scripts[0].key, "initials");
  const writer = buildAppTools({ apps, directory, call, botId, conversationId: null, userId: null, isBuilder: true, after, attempted, via: null, scriptModel: async () => ({ summary: "Doubles", code: "function main(n) { return n * 2 }", tests: [{ name: "two", input: [2], expect: 4 }] }) });
  const written = await run(writer.scriptWrite, { app: "hiring-pipeline", key: "twice", kind: "function", settings: { params: ["n"] }, job: "Double the number given." });
  assert.equal(written.status, "saved", JSON.stringify(written));
  const badName = await run(writer.scriptWrite, { app: "hiring-pipeline", key: "double", kind: "function", settings: { params: ["n"] }, job: "Double the number given." });
  assert.deepEqual([badName.status, badName.rounds], ["not saved", 0], "a name the model can't change fails before any model call");
  assert.equal(written.status, "saved", JSON.stringify(written));

  // field_remove only asks: a card for the person, and nothing removed.
  assert.equal((await run(builder.fieldRemove, { table: "suppliers", field: "spend" })).status, "waiting for the person");
  assert.equal(after.at(-1).kind, "field_removal");
  assert.ok(!(await registry.loadTables(call))[0].fields.find((field) => field.key === "spend").obsolete, "still there until a person confirms");
});
