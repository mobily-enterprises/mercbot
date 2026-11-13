import assert from "node:assert/strict";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { appsHome } from "../support/appsHome.mjs";
import { createAnyapi } from "../../packages/apps/src/server/anyapi.js";
import { createRegistry } from "../../packages/apps/src/server/registry.js";
import { loadTables } from "../../packages/apps/src/server/tables.js";

// Apps tables and fields (D-35) on two servers sharing one database (D-15): a table or field made
// on one server is usable on the other, through notices or, when one is missed, through
// json-rest-api 2.1's own version check.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// An in-memory stand-in for @local/notices that can lose messages on purpose.
function noticeBus() {
  const listeners = new Map();
  let delivering = true;
  return {
    pause: () => { delivering = false; },
    resume: () => { delivering = true; },
    server: () => ({
      async publish(topic, key, event) {
        if (!delivering) return;
        for (const listener of [...(listeners.get(`${topic}:${key}`) || [])]) await listener(event);
      },
      subscribe(topic, key, listener) {
        const name = `${topic}:${key}`;
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(listener);
        return () => listeners.get(name)?.delete(listener);
      }
    })
  };
}

/**
 * One server's AnyAPI and registry on the home's handles, as AppsFeature builds them, with its own end of `bus`:
 * AnyAPI builds a home's instance from the tables read in that home's system context.
 */
function server(home, bus, settings = {}) {
  const notices = bus.server();
  const anyapi = createAnyapi({
    knex: home.knex,
    notices,
    loadTables: (workspaceId) => loadTables(home.handles, { context: home.systemContext.forWorkspace(workspaceId) })
  });
  const registry = createRegistry({ resources: home.handles, anyapi, notices, ...settings });
  return { anyapi, registry };
}

const REGISTRY_SQL = /"app_(tables|fields)"/u;

test("tables and fields made on one server work on another", async (context) => {
  const home = await appsHome(context, { slug: "apps-it" });
  const { knex, userId, workspaceId, options } = home;

  const bus = noticeBus();
  const a = server(home, bus);
  const b = server(home, bus);
  const actor = { type: "person", id: userId };

  const contacts = await a.registry.createTable(actor, {
    key: "contacts",
    label: "Contacts",
    fields: [{ key: "name", type: "text", required: true }, { key: "email", type: "email" }, { key: "stage", type: "choice", choices: ["New", "Won"] }]
  }, options);
  const field = (key, table = contacts) => table.fields.find((entry) => entry.key === key).id;
  assert.equal(contacts.titleFieldId, field("name"));
  await assert.rejects(a.registry.createTable(actor, { key: "contacts" }, options), /already a table/u);
  await assert.rejects(a.registry.createTable(actor, { key: "Bad Key!" }, options), /must start with a letter/u);
  await assert.rejects(a.registry.addField(actor, "contacts", { key: "x", type: "choice" }, options), /at least one choice/u);

  // Server B has never seen the table: it builds its instance from the registry.
  const onB = await b.anyapi.instanceFor(workspaceId);
  const ana = await onB.resources[contacts.id].post({ data: { [field("name")]: "Ana", [field("email")]: "ana@example.com" } });
  assert.equal(ana[field("name")], "Ana");

  // A field added on A, announced through notices: B drops and rebuilds its instance.
  const phone = await a.registry.addField(actor, contacts.id, { key: "phone", type: "phone" }, options);
  const ben = await (await b.anyapi.instanceFor(workspaceId)).resources[contacts.id].post({ data: { [field("name")]: "Ben", [phone.id]: "123" } });
  assert.equal(ben[phone.id], "123");

  // A field added while B misses every notice: json-rest-api's version check catches up.
  const bBefore = await b.anyapi.instanceFor(workspaceId);
  bus.pause();
  const mobile = await a.registry.addField(actor, contacts.id, { key: "mobile", type: "phone" }, options);
  bus.resume();
  assert.equal(await b.anyapi.instanceFor(workspaceId), bBefore, "B kept its instance: it never heard of the change");
  const carla = await bBefore.resources[contacts.id].post({ data: { [field("name")]: "Carla", [mobile.id]: "456" } });
  assert.equal(carla[mobile.id], "456");

  // A link field must point to an existing table.
  const deals = await a.registry.createTable(actor, { key: "deals", fields: [{ key: "title", type: "text" }, { key: "contact", type: "link", target: "contacts" }] }, options);
  assert.equal(deals.fields.find((entry) => entry.key === "contact").options.target, contacts.id);

  // Renaming changes only the registry; records keep their values under the same field id.
  await a.registry.renameField(actor, phone.id, { key: "work_phone", label: "Work phone" }, options);
  const tables = await b.registry.loadTables(options);
  const renamed = tables.find((table) => table.id === contacts.id).fields.find((entry) => entry.id === phone.id);
  assert.deepEqual([renamed.key, renamed.label], ["work_phone", "Work phone"]);
  const rows = await (await b.anyapi.instanceFor(workspaceId)).resources[contacts.id].query({});
  assert.deepEqual((rows.data || rows).map((row) => [row[field("name")], row[phone.id] ?? null]).sort(), [["Ana", null], ["Ben", "123"], ["Carla", null]]);

  // Every structure change is in the audit trail, by the person who made it.
  const events = await knex("audit_events").where({ workspace_id: workspaceId, action: "schema" }).orderBy("id");
  const kinds = ["createdTable", "addedField", "renamedField"];
  assert.deepEqual(events.map((event) => kinds.find((kind) => kind in event.changes)), ["createdTable", "addedField", "addedField", "createdTable", "renamedField"]);
  assert.equal(String(events[0].actor.id), String(userId));
});

test("each server keeps a home's tables until they change, and past a missed notice only briefly", async (context) => {
  const home = await appsHome(context, { slug: "apps-cache" });
  const { knex, userId, options } = home;

  const bus = noticeBus();
  const a = server(home, bus);
  const b = server(home, bus);
  // A server whose cached tables are never trusted without news: what a missed notice costs at most.
  const bounded = server(home, bus, { trustMs: 0 });
  const actor = { type: "person", id: userId };
  const contacts = await a.registry.createTable(actor, { key: "contacts", fields: [{ key: "name", type: "text" }] }, options);
  const keysOn = async (one) => (await one.registry.loadTables(options))[0].fields.map((field) => field.key);

  // Read once, then from memory however often it's asked; nobody can change the shared copy.
  assert.deepEqual(await keysOn(b), ["name"]);
  assert.deepEqual(await keysOn(bounded), ["name"]);
  const reads = await queriesDuring(knex, () => Promise.all(Array.from({ length: 50 }, () => b.registry.loadTables(options))), {
    matching: REGISTRY_SQL
  });
  assert.equal(reads, 0, "50 lookups of a home's tables read app_tables and app_fields again");
  const [cached] = await b.registry.loadTables(options);
  assert.throws(() => { cached.label = "Changed"; }, TypeError);
  assert.throws(() => cached.fields.push({}), TypeError);

  // A change on A reaches B through its notice.
  await a.registry.addField(actor, contacts.id, { key: "phone", type: "phone" }, options);
  assert.deepEqual(await keysOn(b), ["name", "phone"]);

  // A change on B itself drops B's copy whether or not any notice arrives.
  bus.pause();
  await b.registry.addField(actor, contacts.id, { key: "email", type: "email" }, options);
  assert.deepEqual(await keysOn(b), ["name", "phone", "email"]);

  // A notice B misses leaves its copy as it was until its trust runs out; past it, the change shows.
  await a.registry.renameField(actor, contacts.fields[0].id, { key: "full_name" }, options);
  bus.resume();
  assert.deepEqual(await keysOn(b), ["name", "phone", "email"]);
  assert.deepEqual(await keysOn(bounded), ["full_name", "phone", "email"]);
});
