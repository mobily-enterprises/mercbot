import assert from "node:assert/strict";
import test from "node:test";
import { inParallel } from "../support/inParallel.mjs";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { plansDuring, queriesDuring } from "../support/queryCount.mjs";
import { compileWhere } from "../../packages/apps/src/shared/where.js";

// The data gate (D-35): every record change is checked by type and audited in the same
// transaction; nothing is deleted.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("the data gate validates, audits atomically and never deletes", async (context) => {
  const home = await appsHome(context, { slug: "apps-gate" });
  const { knex, userId, workspaceId, options } = home;
  // The gate without scripts' rules: the values as given.
  const { registry, gate } = appsParts(home);
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "data" });

  const contacts = await registry.createTable(person, {
    key: "contacts",
    fields: [
      { key: "name", type: "text", required: true },
      { key: "email", type: "email" },
      { key: "stage", type: "choice", choices: ["New", "Won", "Lost"] },
      { key: "price", type: "money" },
      { key: "started", type: "date" },
      { key: "active", type: "yesno" }
    ]
  }, options);
  const id = (key) => contacts.fields.find((field) => field.key === key).id;
  const deals = await registry.createTable(person, { key: "deals", fields: [{ key: "title", type: "text" }, { key: "contact", type: "link", target: "contacts" }] }, options);
  const contactField = deals.fields.find((field) => field.key === "contact").id;
  const audits = async () => Number((await knex("audit_events").where({ workspace_id: workspaceId }).whereNot({ action: "schema" }).count("* as n").first()).n);

  // Values by field key or id are checked by type.
  const ana = await gate.create(ctx, "contacts", { name: "Ana", email: "ana@example.com", stage: "New", price: 1250, started: "2021-03-03", active: "true" });
  assert.deepEqual([ana[id("name")], ana[id("price")], ana[id("active")]], ["Ana", 1250, true]);
  for (const [input, message] of [
    [{ email: "x@example.com" }, /Name is required/u],
    [{ name: "B", email: "not-an-email" }, /not a valid email/u],
    [{ name: "B", stage: "Maybe" }, /must be one of: New, Won, Lost/u],
    [{ name: "B", price: 12.5 }, /whole number of cents/u],
    [{ name: "B", started: "2021-02-30" }, /must be a date/u],
    [{ name: "B", nickname: "x" }, /has no field "nickname"/u]
  ]) await assert.rejects(gate.create(ctx, "contacts", input), message);
  assert.equal(await audits(), 1, "refused writes leave no audit");

  // Updates record each changed field's old and new value; a no-op writes nothing.
  await gate.update(ctx, "contacts", ana.id, { stage: "Won", email: "ana@example.com" });
  await gate.update(ctx, "contacts", ana.id, { stage: "Won" });
  const history = await gate.history(ctx, "contacts", ana.id);
  assert.deepEqual(history.map((event) => event.action), ["update", "create"]);
  assert.deepEqual(history[0].changes, { [id("stage")]: ["New", "Won"] });
  assert.equal(history[0].actor.name, "Tester");

  // If the audit entry can't be written, the change doesn't happen either.
  const before = await audits();
  await assert.rejects(gate.update({ ...ctx, actor: null }, "contacts", ana.id, { stage: "Lost" }));
  assert.equal((await gate.get(ctx, "contacts", ana.id))[id("stage")], "Won");
  await assert.rejects(gate.create({ ...ctx, actor: null }, "contacts", { name: "Ghost" }));
  assert.equal((await gate.read(ctx, "contacts")).records.length, 1, "no ghost record");
  assert.equal(await audits(), before);

  // Links show the target's title and refuse records that don't exist.
  const deal = await gate.create(ctx, "deals", { title: "Laptops", contact: ana.id });
  const readDeal = await gate.get(ctx, "deals", deal.id);
  assert.deepEqual(readDeal[contactField], { id: ana.id, label: "Ana", obsolete: false, missing: false });
  await assert.rejects(gate.create(ctx, "deals", { title: "Nobody", contact: "999999" }), /doesn't exist/u);

  // A page filter runs as SQL on AnyAPI's slots.
  await gate.create(ctx, "contacts", { name: "Ben", stage: "Lost", price: 500 });
  await gate.create(ctx, "contacts", { name: "Bea", stage: "Won", price: 300 });
  const variables = { ...Object.fromEntries(contacts.fields.map((field) => [field.id, "string"])), state: { q: "string" }, params: {} };
  const plan = compileWhere(variables, `=${id("name")}.startsWith(state.q)`);
  const filtered = await gate.read(ctx, "contacts", { where: { plan, variables: { state: { q: "string" }, params: {} }, values: { state: { q: "Be" }, params: {} } }, sort: [{ field: id("name") }] });
  assert.deepEqual(filtered.records.map((record) => record[id("name")]), ["Bea", "Ben"]);

  // Grouped totals, scoped to this home.
  const totals = await gate.totals(ctx, "contacts", { groupBy: id("stage"), measure: "sum", field: id("price") });
  assert.deepEqual(totals.map((row) => [row.key, row.count, row.total]).sort(), [["Lost", 1, 500], ["Won", 2, 1550]]);

  // Obsolete records are hidden, kept, and can come back; the link says so.
  await gate.markObsolete(ctx, "contacts", ana.id);
  assert.deepEqual((await gate.read(ctx, "contacts")).records.map((record) => record[id("name")]).sort(), ["Bea", "Ben"]);
  assert.equal((await gate.read(ctx, "contacts", { includeObsolete: true })).records.length, 3);
  assert.equal((await gate.get(ctx, "deals", deal.id))[contactField].obsolete, true);
  const withoutAna = await gate.totals(ctx, "contacts", { groupBy: id("stage"), measure: "sum", field: id("price") });
  assert.deepEqual(withoutAna.map((row) => [row.key, row.count]).sort(), [["Lost", 1], ["Won", 1]], "totals skip obsolete records");
  await gate.restore(ctx, "contacts", ana.id);
  assert.equal((await gate.read(ctx, "contacts")).records.length, 3);
  assert.deepEqual((await gate.history(ctx, "contacts", ana.id)).map((event) => event.action), ["restore", "obsolete", "update", "create"]);
});

// A page costs the same at any size: linked records come in one query per link field, not one each.
test("a page's links cost the same queries at 10 rows and at 200", async (context) => {
  const home = await appsHome(context, { slug: "apps-gate-links" });
  const { knex, userId, workspaceId, options } = home;
  // Only the work's own queries are counted here: no refresh of the cached tables after their 5 s (appsRegistry checks that).
  const { anyapi, registry, gate } = appsParts(home, { trustMs: Infinity });
  const person = { type: "person", id: String(userId), name: "Tester" };
  const ctx = home.ctx(person, { kind: "data" });

  await registry.createTable(person, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const deals = await registry.createTable(person, {
    key: "deals",
    fields: [{ key: "title", type: "text" }, { key: "contact", type: "link", target: "contacts" }, { key: "backup", type: "link", target: "contacts" }]
  }, options);
  const id = (key) => deals.fields.find((field) => field.key === key).id;
  // The home's AnyAPI instance, which the gate reads and writes through.
  const api = await anyapi.instanceFor(workspaceId);
  const gone = await gate.create(ctx, "contacts", { name: "Gone" });
  await gate.markObsolete(ctx, "contacts", gone.id);
  // Each deal links to its own contact, the worst case; its backup is an obsolete contact or a missing one.
  const contactIds = await inParallel(200, async (index) => {
    const number = String(index).padStart(3, "0");
    const contact = await gate.create(ctx, "contacts", { name: `Contact ${number}` });
    const deal = await gate.create(ctx, "deals", { title: `Deal ${number}`, contact: contact.id, backup: gone.id });
    // The gate refuses a missing link, so a link left behind by some other way is written underneath it.
    if (index % 2) await api.resources[deals.id].patch({ id: deal.id, data: { [id("backup")]: "999999999" } }, { includeObsolete: true });
    return contact.id;
  });

  const page = async (size) => {
    let records = null;
    const count = await queriesDuring(knex, async () => {
      records = (await gate.read(ctx, "deals", { sort: [{ field: id("title") }], page: { size } })).records;
    });
    assert.equal(records.length, size);
    for (const [index, record] of records.entries()) {
      const number = String(index).padStart(3, "0");
      assert.deepEqual(record[id("contact")], { id: contactIds[index], label: `Contact ${number}`, obsolete: false, missing: false });
      assert.deepEqual(
        record[id("backup")],
        index % 2 ? { id: "999999999", label: "999999999", obsolete: true, missing: true } : { id: gone.id, label: "Gone", obsolete: true, missing: false }
      );
    }
    return count;
  };
  const small = await page(10);
  const large = await page(200);
  assert.equal(large, small, `a 200-row page took ${large} queries, a 10-row page ${small}`);
});

test("record calls look a home's tables up once, not on every call", async (context) => {
  const home = await appsHome(context, { slug: "apps-gate-lookups" });
  const { knex, userId, options } = home;
  // Only the work's own queries are counted here: no refresh of the cached tables after their 5 s (appsRegistry checks that).
  const { registry, gate } = appsParts(home, { trustMs: Infinity });
  const ctx = home.ctx({ type: "person", id: String(userId), name: "Tester" }, { kind: "data" });
  await registry.createTable(ctx.actor, { key: "contacts", fields: [{ key: "name", type: "text", required: true }] }, options);
  const ana = await gate.create(ctx, "contacts", { name: "Ana" });

  // Each update used to read app_tables and app_fields twice (update, then change): 200 lookups here.
  const lookups = await queriesDuring(knex, async () => {
    for (let index = 0; index < 50; index += 1) await gate.update(ctx, "contacts", ana.id, { name: `Ana ${index}` });
    await gate.read(ctx, "contacts");
    await gate.get(ctx, "contacts", ana.id);
    await gate.count(ctx, "contacts");
  }, { matching: /"app_(tables|fields)"/u });
  assert.equal(lookups, 0, `50 updates and a read, a get and a count looked the tables up ${lookups} times`);
  assert.equal((await gate.get(ctx, "contacts", ana.id))[(await registry.loadTables(options))[0].fields[0].id], "Ana 49");
});

test("the Activity filter's people and one person's page read by actor, not the home's whole history", async (context) => {
  const home = await appsHome(context, { slug: "apps-gate-actors" });
  const { knex, userId, workspaceId } = home;
  const { gate } = appsParts(home);
  const pat = { type: "person", id: String(userId), name: "Pat" };
  const helper = { type: "bot", id: "b-1", name: "Helper" };
  const cy = { type: "person", id: "u-cy", name: "Cy" };
  const ctx = home.ctx(pat, { kind: "data" });
  const entry = (actor, index) => ({ workspace_id: workspaceId, actor, via: {}, table_id: "t-1", record_id: String(index), action: "update", changes: {} });
  let written = 0;
  const seed = async (actors) => {
    await knex.batchInsert("audit_events", actors.map((actor) => entry(actor, (written += 1))), 500);
    await knex.raw("analyze audit_events");
  };

  // Pat was once called something else; Cy, the rare one, changed two things long ago.
  await seed([{ ...pat, name: "Pat Before" }, cy, cy, ...Array.from({ length: 47 }, (_, index) => (index % 2 ? helper : pat))]);
  // The people list takes a statement per step of its loose index scan (nextActor): its reads are all of them.
  const together = (plans) => ({
    plan: plans.map((step) => step.plan),
    rowsRead: plans.reduce((sum, step) => sum + step.rowsRead, 0),
    indexes: new Set(plans.flatMap((step) => [...step.indexes]))
  });
  const measure = async () => {
    let people = null;
    let page = null;
    const list = together(await plansDuring(knex, async () => {
      people = await gate.actors(ctx);
    }));
    const [filtered] = await plansDuring(knex, async () => {
      page = await gate.activity(ctx, { actor: cy.id });
    });
    const byId = (left, right) => left.id.localeCompare(right.id);
    assert.deepEqual([...people].sort(byId), [helper, pat, cy].sort(byId), "one entry per actor, with their latest name");
    assert.deepEqual(page.map((event) => event.actor), [cy, cy]);
    return { list, filtered };
  };
  const small = await measure();
  await seed(Array.from({ length: 1950 }, (_, index) => (index % 2 ? helper : pat)));
  const large = await measure();

  for (const { list, filtered } of [small, large]) {
    assert.ok(list.indexes.has("ix_audit_events_actor"), `the people list uses the actor index: ${JSON.stringify(list.plan)}`);
    assert.ok(filtered.indexes.has("ix_audit_events_actor"), `one person's page uses the actor index: ${JSON.stringify(filtered.plan)}`);
  }
  // An entry per actor (their latest) and a last step that finds none, and Cy's two entries: the same with 50 or 2,000 entries.
  // Cy, who changed something long ago, is the case a newest-first walk of the home's entries reads all of history for.
  const plan = (read) => JSON.stringify(read.plan);
  assert.ok(large.list.rowsRead <= 4 * (3 + 1), `the people list read ${large.list.rowsRead} rows of 2,000 (${small.list.rowsRead} of 50): ${plan(large.list)}`);
  assert.ok(large.filtered.rowsRead <= 4, `Cy's page read ${large.filtered.rowsRead} rows of 2,000 (${small.filtered.rowsRead} of 50): ${plan(large.filtered)}`);
});
