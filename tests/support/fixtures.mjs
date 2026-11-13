import { connectTestDatabase } from "./testDatabase.mjs";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { startApps } from "./appsFeatures.mjs";
import { botsOf } from "./appsHome.mjs";
import { testPreviewHome, testPreviewOwner } from "./testPreviewExtensions.mjs";

const { tenantOf } = anyapiTestables;

// Test Preview fixtures, run by start-test-app.mjs after it has checked that DB_NAME is the test
// database. 1) The person (testPreviewExtensions.mjs testPreviewOwner): Mercbot's one person,
// you@mercbot.localhost, made by a temporary API server's start and opened with its key, which gives
// them their personal home. 2) That home gets fresh Apps data on every start: a Contacts table with
// three people, a bot called Otto, and a published Contacts app pinned in the sidebar (a list with an "Ask Otto"
// button, an edit screen, a chart of people by stage, and a public contact form with a thank-you
// screen, not yet made public), plus an unpublished draft that adds a Notes column. A second app,
// Stays, is already public and asks visitors to sign in: each visitor sees and edits only their
// own bookings (vera@example.test has one; someone else has another). A copy built on Mercbot may
// add more to the home (testPreviewHome).
// A Leads app runs scripts: a grade function in a column, a "Top 3" list worked out by a script, a
// Promote button, and a rule on the leads table (scores at most 100; every lead gets a reference).
// An Orders app (D-78) shows a calculated total (price × quantity) in its list, its totals and its edit
// form, and a named formula (with VAT) in a column.
// Views (D-55), each the whole home's: "Contacts by stage", with a card in Vera's chat, "Everyone's
// stages" (two versions) and "One contact"; a Reports app shares the second and keeps a copy of it,
// and shares the third on a person's screen; a Second report shares the second too.
if (!process.env.TEST_DB_NAME || process.env.DB_NAME !== process.env.TEST_DB_NAME) throw new Error("Only for the test database.");
// The person whose home the fixtures fill (testPreviewOwner: Mercbot's one person, or whom a copy built on Mercbot
// names), made with their personal home.
const owner = await testPreviewOwner();

const knex = await connectTestDatabase();
let started = null;
try {
  const user = await knex("users").where({ email: owner }).first();
  const home = user && (await knex("workspaces").where({ owner_user_id: user.id, is_personal: true }).first());
  if (!home) throw new Error(`The fixtures' person, ${owner}, has no personal home.`);
  const workspaceId = home.id;

  await knex.transaction(async (trx) => {
    await trx("app_jobs").where({ workspace_id: workspaceId }).del();
    await trx("app_watches").where({ workspace_id: workspaceId }).del();
    await trx("bots").where({ workspace_id: workspaceId }).whereIn("name", ["Otto", "Vera"]).del();
    await trx("app_themes").where({ workspace_id: workspaceId }).del();
    await trx("app_web_access").where({ workspace_id: workspaceId }).del();
    for (const table of ["app_pins", "app_versions", "apps", "app_settings", "audit_events", "app_fields", "app_tables"]) await trx(table).where({ workspace_id: workspaceId }).del();
    // The home's records, and its drafts' practice copies (D-71), each an AnyAPI tenant under the home's.
    for (const table of ["any_records", "any_resource_configs"]) {
      await trx(table).where({ tenant_id: tenantOf(workspaceId) }).orWhereLike("tenant_id", `${tenantOf(workspaceId)}:p:%`).del();
    }
  });

  // The apps features as the server starts them, on the test database. The person's calls are their request's, in
  // their home, and the home's bots are the ones made below.
  started = await startApps({ knex, env: process.env, records: botsOf(knex) });
  const { registry, gate, apps, scripts, views } = started.apps;
  const options = started.memberOptions(user.id, { id: workspaceId, slug: home.slug });
  const person = { type: "person", id: String(user.id), name: user.display_name || user.username };
  const ctx = { options, actor: person, via: { kind: "data" } };

  await registry.createTable(person, {
    key: "contacts",
    fields: [
      { key: "name", type: "text", required: true },
      { key: "email", type: "email" },
      { key: "stage", type: "choice", choices: ["New", "Active", "Won"] },
      { key: "notes", type: "text" }
    ]
  }, options);
  for (const [name, email, stage] of [["Ana Ruiz", "ana@example.test", "Active"], ["Ben Okafor", "ben@example.test", "New"], ["Carla Mendes", "carla@example.test", "Won"]]) {
    await gate.create(ctx, "contacts", { name, email, stage });
  }

  await knex("bots").insert({ user_id: user.id, workspace_id: workspaceId, name: "Otto", color: "#7E57C2" });
  // The views tests' own bot: others make Otto the home's shared Builder, which takes its private chat out of view.
  await knex("bots").insert({ user_id: user.id, workspace_id: workspaceId, name: "Vera", color: "#00897B" });

  const definition = (columns) => ({
    home: "list",
    public: { home: "contact", tables: { contacts: { can: ["create"], write: ["name", "email"] } } },
    navigation: { style: "tabs", items: [{ screen: "list", label: "People", icon: "person" }, { screen: "stages", label: "Stages", icon: "chart" }] },
    screens: {
      list: {
        data: { people: { from: "contacts", sort: "name" } },
        content: [{
          type: "table",
          rows: "=data.people",
          columns,
          onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }],
          rowActions: [{ type: "button", label: "Ask Otto", do: [{ askBot: { bot: "Otto", task: '="Find out more about " + row.name' } }] }]
        }]
      },
      stages: {
        data: { byStage: { from: "contacts", groupBy: "stage" } },
        content: [{ type: "chart", kind: "bar", label: "People by stage", rows: "=data.byStage" }]
      },
      contact: {
        public: true,
        content: [
          { type: "text", value: "Get in touch", size: "title" },
          { type: "form", table: "contacts", fields: ["name", "email"], buttons: [{ type: "button", label: "Send", emphasis: "primary", do: [{ create: { table: "contacts", values: "=form.values" } }, { go: { screen: "thanks" } }] }] }
        ]
      },
      thanks: { public: true, content: [{ type: "text", value: "Thanks, we'll be in touch." }] },
      edit: {
        params: { id: { type: "string" } },
        data: { person: { record: "contacts", id: "=params.id" } },
        content: [{
          type: "form",
          record: "=data.person",
          fields: ["name", "email", "stage", "notes"],
          buttons: [{ type: "button", label: "Save", emphasis: "primary", do: [{ update: { record: "=data.person", set: "=form.values" } }, { notify: '="Saved " + form.name' }, { go: { screen: "list" } }] }]
        }]
      }
    }
  });
  const columns = [{ label: "Name", value: "=row.name" }, { label: "Email", value: "=row.email" }, { label: "Stage", value: "=row.stage", display: "chip" }];
  const app = await apps.createApp(person, { name: "Contacts", icon: "person" }, options);
  const check = (result) => {
    if (result.errors?.length) throw new Error(`The fixture app was refused: ${JSON.stringify(result.errors)}`);
  };
  check(await apps.saveDraft(person, app.slug, definition(columns), "People list", options));
  await apps.publish(person, app.slug, {}, options);
  check(await apps.saveDraft(person, app.slug, definition([...columns, { label: "Notes", value: "=row.notes" }]), "Add a Notes column", options));
  await apps.setPins([app.id], options);

  await registry.createTable(person, { key: "bookings", fields: [{ key: "what", type: "text", required: true }, { key: "email", type: "email" }, { key: "nights", type: "number" }] }, options);
  await gate.create(ctx, "bookings", { what: "Vera's stay", email: "vera@example.test", nights: 2 });
  await gate.create(ctx, "bookings", { what: "Someone else's stay", email: "other@example.test", nights: 9 });
  const stays = await apps.createApp(person, { name: "Stays", icon: "calendar" }, options);
  check(await apps.saveDraft(person, stays.slug, {
    home: "mine",
    public: { home: "mine", signIn: "required", signInWith: ["code", "link", "google"], tables: { bookings: { can: ["list", "get", "update"], rows: "own", owner: "email", read: ["what", "nights"], write: ["what", "nights"] } } },
    screens: {
      mine: {
        public: true,
        data: { mine: { from: "bookings", sort: "what" } },
        content: [
          { type: "text", value: '="Bookings for " + visitor.email', size: "title" },
          { type: "table", rows: "=data.mine", columns: [{ label: "Stay", value: "=row.what" }, { label: "Nights", value: "=row.nights" }], onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }] }
        ]
      },
      edit: {
        public: true,
        params: { id: { type: "string" } },
        data: { stay: { record: "bookings", id: "=params.id" } },
        content: [{ type: "form", record: "=data.stay", fields: ["what", "nights"], buttons: [{ type: "button", label: "Save", emphasis: "primary", do: [{ update: { record: "=data.stay", set: "=form.values" } }, { notify: '="Saved"' }, { go: { screen: "mine" } }] }] }]
      }
    }
  }, "Visitors' own bookings", options));
  await apps.publish(person, stays.slug, {}, options);
  await apps.setPublic(person, stays.slug, true, options);

  // What a copy built on Mercbot adds to the home (testPreviewExtensions.mjs): Mercbot adds nothing.
  await testPreviewHome({ knex, home: { id: workspaceId, slug: home.slug }, person, ctx, options, apps: started.apps, check });
  // Leads, with scripts (saved like the Builder does: only with passing tests).
  await registry.createTable(person, { key: "leads", fields: [{ key: "name", type: "text", required: true }, { key: "score", type: "number" }, { key: "stage", type: "choice", choices: ["New", "Hot", "Won"] }, { key: "ref", type: "text" }] }, options);
  for (const [name, score] of [["Dora Lee", 91], ["Eli Park", 64], ["Fay Moss", 30], ["Gus Hill", 77]]) await gate.create(ctx, "leads", { name, score, stage: "New" });
  const leads = await apps.createApp(person, { name: "Leads", icon: "star" }, options);
  const saveScript = async (input) => {
    const result = await scripts.save(person, leads.slug, input, options);
    if (result.errors.length) throw new Error(`The fixture script ${input.key} was refused: ${JSON.stringify(result)}`);
  };
  await saveScript({ key: "grade", kind: "function", summary: "Grades a score: A from 80, B from 50, else C", settings: { params: ["score"] }, code: "function main(score) { return score >= 80 ? 'A' : score >= 50 ? 'B' : 'C' }", tests: [{ name: "A", input: [80], expect: "A" }, { name: "B", input: [50], expect: "B" }, { name: "C", input: [49], expect: "C" }] });
  await saveScript({ key: "top", kind: "source", summary: "The three best leads, numbered", code: "async function main() { const rows = await records.list('leads', { sort: '-score', limit: 3 }); return rows.map((row, index) => ({ place: index + 1, name: row.name, score: row.score })) }", tests: [{ name: "best first", input: null, records: { leads: [{ name: "A", score: 1 }, { name: "B", score: 9 }] }, expect: [{ place: 1, name: "B", score: 9 }, { place: 2, name: "A", score: 1 }] }] });
  await saveScript({ key: "promote", kind: "action", summary: "Marks a lead as won", code: "async function main(input) { const lead = await records.update('leads', input.id, { stage: 'Won' }); return { notify: 'Promoted ' + lead.name } }", tests: [{ name: "won", input: { id: "1" }, records: { leads: [{ id: "1", name: "Dora", stage: "New" }] }, expect: { notify: "Promoted Dora" } }] });
  await saveScript({ key: "lead_rules", kind: "rule", summary: "Scores are at most 100, and every lead gets a reference", settings: { table: "leads" }, code: "async function main({ record }) { if (record.score > 100) return { refuse: 'A score is at most 100.' }; if (!record.ref) return { set: { ref: 'L-' + record.name.slice(0, 3).toUpperCase() } }; return {} }", tests: [{ name: "too high", input: { record: { name: "X", score: 101 } }, expect: { refuse: "A score is at most 100." } }, { name: "reference", input: { record: { name: "Dora", score: 5, ref: null } }, expect: { set: { ref: "L-DOR" } } }] });
  check(await apps.saveDraft(person, leads.slug, {
    home: "list",
    // Its own look (the app's CSS): a dark page, a pink banner, see-through tables.
    style: ":root { background: rgb(10, 10, 40); color: rgb(240, 240, 255); } .x-banner .text-h6 { color: rgb(255, 51, 102); letter-spacing: 4px; text-transform: uppercase; } .app-node--table .v-table { background: transparent; color: inherit; }",
    screens: {
      list: {
        data: { all: { from: "leads", sort: "name" }, best: { script: "top" } },
        content: [
          { type: "table", rows: "=data.all", columns: [{ label: "Name", value: "=row.name" }, { label: "Score", value: "=row.score" }, { label: "Grade", value: "=grade(row.score)", display: "chip" }, { label: "Stage", value: "=row.stage" }], rowActions: [{ type: "button", label: "Promote", do: [{ runScript: { script: "promote", input: { id: "=row.id" } } }] }] },
          { type: "text", value: "Top 3", size: "title", class: "banner" },
          { type: "table", rows: "=data.best", columns: [{ label: "#", value: "=string(row.place)" }, { label: "Lead", value: "=row.name" }] }
        ]
      }
    }
  }, "Leads with scripts", options));
  await apps.publish(person, leads.slug, {}, options);

  // Orders, with a calculated field and a named formula (D-78).
  await registry.createTable(person, {
    key: "orders",
    fields: [
      { key: "item", type: "text", required: true },
      { key: "price", type: "money" },
      { key: "quantity", type: "number" },
      { key: "total", type: "money", formula: "=price * quantity" }
    ]
  }, options);
  for (const [item, price, quantity] of [["Mug", 1250, 4], ["Desk", 25000, 1]]) await gate.create(ctx, "orders", { item, price, quantity });
  const orders = await apps.createApp(person, { name: "Orders", icon: "chart" }, options);
  check(await apps.saveDraft(person, orders.slug, {
    home: "list",
    formulas: { with_vat: { params: ["amount"], formula: "=amount * 1.2" } },
    screens: {
      list: {
        data: { all: { from: "orders", sort: "item" }, byItem: { from: "orders", groupBy: "item", sum: "total", grandTotal: true } },
        content: [
          {
            type: "table",
            rows: "=data.all",
            columns: [{ label: "Item", value: "=row.item" }, { label: "Price", value: "=row.price" }, { label: "Quantity", value: "=row.quantity" }, { label: "Total", value: "=row.total" }, { label: "With VAT", value: "=formatMoney(with_vat(row.total))" }],
            onRowClick: [{ go: { screen: "edit", params: { id: "=row.id" } } }]
          },
          { type: "totals", label: "Totals by item", rows: "=data.byItem" }
        ]
      },
      edit: {
        params: { id: { type: "string" } },
        data: { order: { record: "orders", id: "=params.id" } },
        content: [
          { type: "text", value: '=data.order.item + ": " + formatMoney(with_vat(data.order.total)) + " with VAT"', size: "title" },
          {
            type: "form",
            record: "=data.order",
            fields: ["item", "price", "quantity", "total"],
            buttons: [{ type: "button", label: "Save", emphasis: "primary", do: [{ update: { record: "=data.order", set: "=form.values" } }, { notify: '="Saved " + form.item' }, { go: { screen: "list" } }] }]
          }
        ]
      }
    }
  }, "Orders with totals", options));
  await apps.publish(person, orders.slug, {}, options);

  // Views (D-55).
  const [vera] = await knex("bots").where({ workspace_id: workspaceId, name: "Vera" }).pluck("id");
  const byStage = (kind) => ({
    data: {
      stages: { from: "contacts", groupBy: "stage", grandTotal: true },
      newest: { from: "contacts", sort: "-name", limit: 2 }
    },
    content: [
      { type: "totals", label: "Contacts by stage", rows: "=data.stages" },
      { type: "chart", label: "As a chart", kind, rows: "=data.stages", measure: "count" },
      { type: "table", rows: "=data.newest", columns: [{ label: "Name", value: "=row.name" }] }
    ]
  });
  const saveView = async (input, working) => {
    const saved = await views.save(ctx, input, { botId: vera, ...working });
    if (saved.errors.length) throw new Error(`Fixture view: ${JSON.stringify(saved.errors)}`);
    return saved.view;
  };
  const mine = await saveView({ title: "Contacts by stage", summary: "How many contacts at each stage", definition: byStage("bar") }, { userId: user.id });
  const everyones = await saveView({ title: "Everyone's stages", summary: "First version", definition: byStage("bar") }, { userId: user.id });
  await saveView({ view: everyones.key, title: "Everyone's stages", summary: "As a pie", definition: byStage("pie") }, { userId: user.id });
  const oneContact = await saveView({
    title: "One contact",
    summary: "A contact's stage",
    definition: {
      params: { contact: {} },
      data: { person: { record: "contacts", id: "=params.contact" } },
      content: [{ type: "field", label: "Their stage", value: "=data.person.stage" }]
    }
  }, { userId: user.id });
  const reports = await apps.createApp(person, { name: "Reports", icon: "chart" }, options);
  check(await apps.saveDraft(person, reports.slug, {
    home: "home",
    screens: {
      home: {
        data: { people: { from: "contacts", sort: "name" } },
        content: [
          { type: "text", value: "Shared", size: "title" },
          { type: "view", view: everyones.key },
          { type: "text", value: "Our copy", size: "title" },
          { type: "view", view: everyones.key, copy: true },
          { type: "table", rows: "=data.people", columns: [{ label: "Person", value: "=row.name" }], onRowClick: [{ go: { screen: "person", params: { id: "=row.id" } } }] }
        ]
      },
      person: {
        params: { id: {} },
        content: [{ type: "view", view: oneContact.key, params: { contact: "=params.id" } }]
      }
    }
  }, "Reports with views", options));
  await apps.publish(person, reports.slug, {}, options);
  const second = await apps.createApp(person, { name: "Second report", icon: "chart" }, options);
  check(await apps.saveDraft(person, second.slug, {
    home: "home",
    screens: { home: { content: [{ type: "view", view: everyones.key }] } }
  }, "Also shows the view", options));
  await apps.publish(person, second.slug, {}, options);
  const [conversation] = await knex("bot_conversations").insert({ workspace_id: workspaceId, bot_id: vera, user_id: user.id }).onConflict().ignore().returning("id");
  const conversationId = conversation?.id ?? (await knex("bot_conversations").where({ bot_id: vera, user_id: user.id }).first("id")).id;
  await knex("bot_messages").insert({
    workspace_id: workspaceId,
    bot_id: vera,
    conversation_id: conversationId,
    kind: "view",
    role: "bot",
    body: JSON.stringify({ path: mine.key, title: mine.title, summary: mine.summary })
  });

  console.log(`Test fixtures ready: home "${home.slug}", app "${app.slug}".`);
} finally {
  // Stopping the features closes the scripts' pool, as a server's shutdown does.
  await started?.stop();
  await knex.destroy();
}
process.exit(0);
