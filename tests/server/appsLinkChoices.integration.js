import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { startApps } from "../support/appsFeatures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";
import { testServerEnv } from "../support/testEnv.mjs";

const { tenantOf } = anyapiTestables;

// A form's link field is picked from its table's records (the first 100, or those whose title has what was typed),
// read through the gate: a member sees the home's, a visitor only what the public app lets them read (D-66). A public
// form can link a new record to the one its page is about ("=params.event"), and the gate refuses a row the visitor
// can't read.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("link pickers in forms: members, visitors, search, and a public preset from the page", async (context) => {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first()).id);
  const slug = `apps-links-${Date.now()}`;
  const [home] = await knex("workspaces").insert({ slug, name: "Links test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = String(home.id ?? home);
  const started = await startApps({ knex, env: { ...testServerEnv(), MERCBOT_VAULT_KEY: randomBytes(32).toString("base64") } });
  const { registry, gate, apps, runtime } = started.apps;
  const member = started.memberOptions(userId, { id: workspaceId, slug });
  context.after(async () => {
    await started.stop();
    await knex("any_records").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("any_resource_configs").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
  });
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = { workspaceId, actor: person, via: { kind: "data" }, options: member };
  await registry.createTable(person, { key: "events", fields: [{ key: "title", type: "text", required: true }] }, member);
  await registry.createTable(person, { key: "attendees", fields: [{ key: "name", type: "text", required: true }, { key: "event", type: "link", target: "events" }] }, member);
  const party = await gate.create(ctx, "events", { title: "Summer party" });
  const quiz = await gate.create(ctx, "events", { title: "Quiz night" });
  const closed = await gate.create(ctx, "events", { title: "Closed board meeting" });

  const join = (preset) => ({
    type: "form",
    table: "attendees",
    fields: ["name", "event"],
    buttons: [{ type: "button", label: "Join", do: [{ create: { table: "attendees", values: "=form.values", ...(preset ? { preset } : {}) } }] }]
  });
  const definition = (preset) => ({
    home: "inside",
    public: {
      home: "signup",
      tables: {
        events: { can: ["list", "get"], rows: '=!title.startsWith("Closed")', read: ["title"] },
        attendees: { can: ["create"], write: ["name", "event"] }
      }
    },
    screens: {
      inside: { content: [join(null)] },
      signup: { public: true, params: { event: { type: "string" } }, content: [join(preset)] }
    }
  });
  await apps.createApp(person, { name: "Events" }, member);
  const refused = await apps.saveDraft(person, "events", definition({ event: "=params.nope" }), "v0", member);
  assert.match(JSON.stringify(refused.errors), /one of the screen's params/u, "a preset reads only the screen's own params");
  assert.deepEqual((await apps.saveDraft(person, "events", definition({ event: "=params.event" }), "v1", member)).errors, []);
  await apps.publish(person, "events", {}, member);
  const appId = (await apps.find("events", member)).id;

  // ---- A member: every event, and a search on the title ----
  const choices = (c, screen, search = "") => runtime.linkChoices(c, { slug: appId, version: "live", screen, path: "content/0", field: "event", search });
  const titles = async (c, screen, search) => (await choices(c, screen, search)).items.map((item) => item.title).sort();
  assert.deepEqual(await titles(ctx, "inside"), ["Closed board meeting", "Quiz night", "Summer party"]);
  assert.deepEqual(await titles(ctx, "inside", "quiz"), ["Quiz night"]);
  await assert.rejects(runtime.linkChoices(ctx, { slug: appId, version: "live", screen: "inside", path: "content/0", field: "name" }), { code: "apps_link_field_not_found" });

  // ---- A visitor: only the events the public app lets them read ----
  const tables = await registry.loadTables(member);
  const visitor = { signedIn: false, email: "" };
  const visitorCtx = {
    workspaceId,
    actor: { type: "visitor", id: null, name: "Events (public form)" },
    via: { kind: "public" },
    visitor,
    access: compile(definition({ event: "=params.event" }), tables, visitor),
    options: started.jobOptions(workspaceId)
  };
  assert.deepEqual(await titles(visitorCtx, "signup"), ["Quiz night", "Summer party"]);
  await assert.rejects(choices(visitorCtx, "inside"), /That screen doesn't exist/u, "never an internal screen's");

  // ---- A public form links to the page's event; never to one the visitor can't read ----
  const submit = (event) => runtime.action(visitorCtx, {
    slug: appId, version: "live", screen: "signup", path: "content/0/buttons/0/do", values: { name: "Ana" }, params: { event }
  });
  await submit(party.id);
  const attendees = (await gate.read(ctx, "attendees", { page: { size: 10, number: 1 } })).records;
  const eventField = tables.find((table) => table.key === "attendees").fields.find((field) => field.key === "event").id;
  assert.deepEqual(attendees.map((row) => String(row[eventField]?.id ?? row[eventField])), [String(party.id)], "linked to the page's event");
  await assert.rejects(submit(closed.id), /doesn't exist/u, "a closed event isn't one the visitor can reach");
  assert.ok(quiz.id);
});

// A form's link field may take its choices from one of the screen's list queries of the linked table (D-144): the
// picker offers only what that query reads (its filter, with the page's values), searched the same way; the save check
// holds it to a list of the table the field links to.
test("a link field's choices can be one of the screen's lists, filter and search included", async (context) => {
  const knex = await connectTestDatabase();
  const userId = String((await knex("users").first()).id);
  const slug = `apps-link-lists-${Date.now()}`;
  const [home] = await knex("workspaces").insert({ slug, name: "Link lists test", owner_user_id: userId, is_personal: false }).returning("id");
  const workspaceId = String(home.id ?? home);
  const started = await startApps({ knex, env: testServerEnv() });
  const { registry, gate, apps, runtime } = started.apps;
  const member = started.memberOptions(userId, { id: workspaceId, slug });
  context.after(async () => {
    await started.stop();
    await knex("any_records").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("any_resource_configs").where({ tenant_id: tenantOf(workspaceId) }).del();
    await knex("workspaces").where({ id: workspaceId }).del();
    await knex.destroy();
  });
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = { workspaceId, actor: person, via: { kind: "data" }, options: member };
  await registry.createTable(person, { key: "books", fields: [{ key: "title", type: "text", required: true }, { key: "ready", type: "yesno" }] }, member);
  await registry.createTable(person, { key: "courses", fields: [{ key: "goal", type: "text", required: true }, { key: "book", type: "link", target: "books" }] }, member);
  for (const [title, ready] of [["Plants", true], ["Planets", true], ["Poems", false]]) await gate.create(ctx, "books", { title, ready });
  const definition = (choices) => ({
    home: "learn",
    screens: {
      learn: {
        data: { readyBooks: { from: "books", where: "=ready == true", sort: "title" }, courses: { from: "courses" } },
        content: [{ type: "form", table: "courses", fields: ["goal", { field: "book", choices }], buttons: [] }]
      }
    }
  });
  await apps.createApp(person, { name: "Learn" }, member);
  const refused = await apps.saveDraft(person, "learn", definition("=data.courses"), "v0", member);
  assert.deepEqual(refused.errors.map((error) => error.path), ["screens.learn.content[0].fields[1].choices"]);
  assert.deepEqual((await apps.saveDraft(person, "learn", definition("=data.readyBooks"), "v1", member)).errors, []);
  await apps.publish(person, "learn", {}, member);
  const titles = async (search = "") =>
    (await runtime.linkChoices(ctx, { slug: "learn", version: "live", screen: "learn", path: "content/0", field: "book", search })).items.map((item) => item.title);
  assert.deepEqual(await titles(), ["Planets", "Plants"]);
  assert.deepEqual(await titles("plan"), ["Planets", "Plants"]);
  assert.deepEqual(await titles("poe"), [], "never one the list leaves out");
});
