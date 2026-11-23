import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { createTableCatalog } from "../../packages/apps/src/server/tableCatalog.js";
import { buildAppTools } from "../../packages/bots/src/server/appTools.js";
import { buildBuilderTools } from "../../packages/bots/src/server/builderTools.js";
import { TABLE_ACTIONS } from "../../packages/bots/src/server/tableTools.js";

// Bots build on the shared tables (D-130), on the test database: any bot adds a shared table the home lacks, with the
// tables it links to, in one line and no card, and another bot reuses it; fields and one-to-one extensions wait for the
// person's yes on a card; nobody makes a second table for what a shared one is for; data_tables shows the links.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function setup(context) {
  const home = await appsHome(context, { slug: "apps-table-tools" });
  const { registry, gate, watches, views } = appsParts(home);
  const apps = { registry, gate, watches, views, catalog: createTableCatalog({ registry, gate }) };
  const call = home.options;
  const botTools = (botId, name) => {
    const notes = [];
    const asked = [];
    const tools = buildAppTools({
      apps,
      directory: { findBot: async () => ({ name }) },
      call,
      botId,
      chatBotId: null,
      userId: String(home.userId),
      isBuilder: false,
      after: [],
      attempted: [],
      via: null,
      fileAt: async () => {
        throw new Error("No files here.");
      },
      postLead: async (text) => notes.push(text),
      attempt: async (actionId, input) => {
        asked.push({ actionId, input });
        return { status: "waiting_for_approval" };
      },
      scriptModel: async () => ({})
    });
    return { tools, notes, asked };
  };
  const run = (tool, input) => tool.execute(input, {});
  return { home, apps, call, botTools, run };
}

test("a bot adds a shared table with what it links to, in one line and no card, and another bot reuses it", async (context) => {
  const { apps, call, botTools, run } = await setup(context);
  const tess = botTools("1", "Tess");
  const added = await run(tess.tools.tableEnsure, { table: "tasks" });
  assert.equal(added.status, "added", JSON.stringify(added));
  assert.deepEqual(added.made, ["departments", "todo_lists", "organisations", "contacts", "todos"]);
  assert.equal(tess.notes.length, 1);
  assert.match(tess.notes[0], /^Added the shared To-dos table, linked to (To-do lists|Departments|Organisations|Contacts)(, | and )/u);
  assert.deepEqual(tess.asked, [], "no card");

  const max = botTools("2", "Max");
  const reused = await run(max.tools.tableEnsure, { table: "to-do list" });
  assert.deepEqual([reused.status, reused.made, max.notes], ["already here", [], []]);
  assert.match((await run(max.tools.tableEnsure, { table: "plants" })).error, /isn't a shared table\. The shared tables are: .*contacts/u);
  const tables = (await apps.registry.loadTables(call)).filter((table) => !table.obsolete);
  assert.equal(tables.filter((table) => table.key === "todos").length, 1);

  // Only the tables it links to, when the shared table is a home's own already.
  const shared = await run(max.tools.tableEnsure, { table: "graphics" });
  assert.match(max.notes[0], /^Added the shared Graphics table, linked to /u);
  assert.ok(shared.made.includes("events") && shared.made.includes("places"));
});

test("fields and one-to-one extensions wait for the person's yes, then are made as the bot that asked", async (context) => {
  const { apps, call, botTools, run } = await setup(context);
  const tess = botTools("1", "Tess");
  await run(tess.tools.tableEnsure, { table: "contacts" });

  const extend = await run(tess.tools.tableExtend, { base: "contacts", key: "vip_details", label: "VIP details", fields: [{ key: "tier", type: "choice", choices: ["Gold"] }] });
  assert.equal(extend.status, "waiting_for_approval");
  assert.equal((await apps.registry.loadTables(call)).some((table) => table.key === "vip_details"), false, "nothing before the yes");
  const [{ actionId, input }] = tess.asked;
  assert.equal(actionId, "table_extend");
  assert.deepEqual(input.as, { type: "bot", id: "1", name: "Tess" });
  assert.match(TABLE_ACTIONS.table_extend.question(input), /^Shall I add a "VIP details" table that holds more about each record of contacts, with tier\?$/u);
  assert.equal(TABLE_ACTIONS.table_extend.alwaysAsks, true);
  const made = await TABLE_ACTIONS.table_extend.run({ apps, call }, input);
  assert.equal(made.result.table, "vip_details");
  const ann = await apps.gate.create({ options: call, actor: input.as, via: { kind: "chat" } }, "contacts", { name: "Ann" });
  await apps.gate.create({ options: call, actor: input.as, via: { kind: "chat" } }, "vip_details", { contact: ann.id, tier: "Gold" });
  await assert.rejects(apps.gate.create({ options: call, actor: input.as, via: { kind: "chat" } }, "vip_details", { contact: ann.id }), { code: "apps_link_unique_taken" });

  assert.match((await run(tess.tools.tableExtend, { base: "contacts", key: "clients" })).error, /shared Contacts table/u);
  assert.equal(tess.asked.length, 1, "a shared table's name is refused before any card");

  await run(tess.tools.tableFieldAdd, { table: "contacts", field: { key: "shoe_size", type: "number" } });
  const fieldInput = tess.asked[1].input;
  assert.equal(tess.asked[1].actionId, "table_field_add");
  assert.match(TABLE_ACTIONS.table_field_add.question(fieldInput), /^Shall I add a "shoe_size" field \(number\) to contacts\?$/u);
  assert.equal((await TABLE_ACTIONS.table_field_add.run({ apps, call }, fieldInput)).result.field, "shoe_size");
  assert.match((await run(tess.tools.tableFieldAdd, { table: "contacts", field: { key: "email", type: "email" } })).error, /already has a field "email"/u);
  const history = await apps.gate.tableFor("contacts", call);
  assert.ok(history.table.fields.some((field) => field.key === "shoe_size"));
});

test("the Builder can't make a second table for a shared one, and data_tables shows every link and what's left to add", async (context) => {
  const { home, apps, call, botTools, run } = await setup(context);
  const builder = buildBuilderTools({
    apps,
    call,
    actor: async () => ({ type: "bot", id: "9", name: "Builder" }),
    ctx: async () => ({ options: call, actor: { type: "bot", id: "9", name: "Builder" }, via: { kind: "chat" } }),
    failed: (error) => ({ error: error.message }),
    after: [],
    scriptModel: async () => ({})
  });
  for (const [key, label] of [["clients", undefined], ["my_jobs", "Tasks"], ["venue", undefined]]) {
    const refused = await run(builder.tableCreate, { key, label, fields: [{ key: "name", type: "text" }] });
    assert.match(refused.error ?? "", /is what the shared .* table .* is for: add it with table_ensure/u, key);
  }
  assert.equal((await run(builder.tableCreate, { key: "bills", fields: [{ key: "title", type: "text" }] })).status, "created");

  const tess = botTools("1", "Tess");
  await run(tess.tools.tableEnsure, { table: "crm_contacts" });
  await run(tess.tools.tableEnsure, { table: "deals" });
  const listed = await run(tess.tools.dataTables, {});
  const of = (key) => listed.tables.find((table) => table.table === key);
  assert.deepEqual(of("contacts").linksTo, ["organisations"]);
  assert.deepEqual(of("contacts").linkedFrom, ["deals"]);
  assert.deepEqual(of("contacts").extendedBy, ["crm_contacts"]);
  assert.deepEqual(of("organisations").linkedFrom.sort(), ["contacts", "deals"]);
  const left = listed.sharedTablesToAdd.map((entry) => entry.table);
  assert.ok(left.includes("todos") && !left.includes("contacts") && !left.includes("deals"));
  assert.ok(listed.sharedTablesToAdd.find((entry) => entry.table === "todos").alsoCalled.includes("tasks"));
  assert.ok(home.workspaceId);
});
