import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// Roll-up fields (D-140): an invoice's total, line count, largest line and open lines follow every write of its lines
// (made, changed, moved to another invoice, removed, restored, imported), a client's total of its invoices' totals
// follows on, lists filter and sort by them, nobody sets one, a roll-up added later starts worked out, and keeping
// them costs the same however many lines an invoice has.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A home with clients, their invoices and the invoices' lines, on parts whose tables stay cached (steady counts). */
async function invoicing(context, slug) {
  const home = await appsHome(context, { slug });
  const { registry, gate } = appsParts(home, { trustMs: Infinity });
  const person = { type: "person", id: home.userId, name: "Pat" };
  const ctx = home.ctx(person);
  const { options } = home;
  await registry.createTable(person, { key: "clients", fields: [{ key: "name", type: "text" }] }, options);
  await registry.createTable(person, { key: "invoices", fields: [{ key: "number", type: "text" }, { key: "client", type: "link", target: "clients" }] }, options);
  await registry.createTable(person, {
    key: "lines",
    fields: [
      { key: "item", type: "text" },
      { key: "amount", type: "money" },
      { key: "status", type: "choice", choices: ["open", "done"] },
      { key: "invoice", type: "link", target: "invoices" }
    ]
  }, options);
  const idOf = async (table, key) => (await registry.loadTables(options)).find((entry) => entry.key === table).fields.find((entry) => entry.key === key).id;
  /** A record's values by field key. */
  const read = async (table, id) => {
    const fields = (await registry.loadTables(options)).find((entry) => entry.key === table).fields;
    const record = await gate.get(ctx, table, id);
    return Object.fromEntries(fields.map((field) => [field.key, record[field.id]]));
  };
  const add = (table, key, type, rollup) => registry.addField(person, table, { key, type, rollup }, options);
  return { ...home, registry, gate, person, ctx, idOf, read, add };
}

test("roll-ups follow their records, through roll-ups too; lists filter and sort by them; nobody sets one", async (context) => {
  const { registry, gate, ctx, options, idOf, read, add } = await invoicing(context, "apps-rollups");
  const acme = await gate.create(ctx, "clients", { name: "Acme" });
  const first = await gate.create(ctx, "invoices", { number: "INV-1", client: acme.id });
  const second = await gate.create(ctx, "invoices", { number: "INV-2", client: acme.id });
  await add("invoices", "total", "money", { from: "lines", link: "invoice", measure: "sum", field: "amount" });
  await add("invoices", "lines_count", "number", { from: "lines", link: "invoice", measure: "count" });
  await add("invoices", "largest", "money", { from: "lines", link: "invoice", measure: "max", field: "amount" });
  await add("invoices", "open_count", "number", { from: "lines", link: "invoice", measure: "count", where: "=status == 'open'" });
  await add("clients", "billed", "money", { from: "invoices", link: "client", measure: "sum", field: "total" });
  const figures = async (id) => {
    const { total, lines_count: count, largest, open_count: open } = await read("invoices", id);
    return { total, count, largest, open };
  };
  assert.deepEqual(await figures(first.id), { total: 0, count: 0, largest: null, open: 0 }, "none yet: nothing to add up is 0, no largest");

  const chair = await gate.create(ctx, "lines", { item: "Chair", amount: 5000, status: "open", invoice: first.id });
  const desk = await gate.create(ctx, "lines", { item: "Desk", amount: 15000, status: "done", invoice: first.id });
  assert.deepEqual(await figures(first.id), { total: 20000, count: 2, largest: 15000, open: 1 }, "made");
  assert.equal((await read("clients", acme.id)).billed, 20000, "the client's total of its invoices' totals follows on");

  await gate.update(ctx, "lines", chair.id, { amount: 7000, status: "done" });
  assert.deepEqual(await figures(first.id), { total: 22000, count: 2, largest: 15000, open: 0 }, "changed");
  await gate.update(ctx, "lines", desk.id, { invoice: second.id });
  assert.deepEqual(await figures(first.id), { total: 7000, count: 1, largest: 7000, open: 0 }, "moved away");
  assert.deepEqual(await figures(second.id), { total: 15000, count: 1, largest: 15000, open: 0 }, "moved in");
  await gate.markObsolete(ctx, "lines", chair.id);
  assert.deepEqual(await figures(first.id), { total: 0, count: 0, largest: null, open: 0 }, "removed");
  await gate.restore(ctx, "lines", chair.id);
  assert.deepEqual(await figures(first.id), { total: 7000, count: 1, largest: 7000, open: 0 }, "restored");
  assert.equal((await read("clients", acme.id)).billed, 22000, "the client's total followed every step");

  // Stored, so lists filter and sort by them in the database.
  const totalId = await idOf("invoices", "total");
  const numberId = await idOf("invoices", "number");
  const listed = await gate.read(ctx, "invoices", {
    where: { plan: { kind: "compare", field: { name: totalId }, op: ">", value: "1000" }, variables: {}, values: {} },
    sort: [{ field: totalId, desc: true }]
  });
  assert.deepEqual(listed.records.map((record) => record[numberId]), ["INV-2", "INV-1"], "over $10, largest first");

  await assert.rejects(gate.update(ctx, "invoices", first.id, { total: 1 }), { code: "apps_field_rollup" }, "nobody sets one");
  const refused = async (table, key, type, rollup) => (await add(table, key, type, rollup).catch((error) => error)).code;
  assert.equal(await refused("invoices", "a", "text", { from: "lines", link: "invoice", measure: "count" }), "apps_rollup_invalid", "a number or money field");
  assert.equal(await refused("invoices", "b", "number", { from: "nowhere", link: "invoice", measure: "count" }), "apps_rollup_invalid", "an existing table");
  assert.equal(await refused("clients", "c", "number", { from: "lines", link: "invoice", measure: "count" }), "apps_rollup_invalid", "a link to this table");
  assert.equal(await refused("invoices", "d", "number", { from: "lines", link: "invoice", measure: "sum", field: "amount" }), "apps_rollup_invalid", "a sum of money is money");
  assert.equal(await refused("invoices", "e", "money", { from: "lines", link: "invoice", measure: "sum", field: "item" }), "apps_rollup_invalid", "a number field to add up");
  assert.equal(await refused("invoices", "f", "number", { from: "lines", link: "invoice", measure: "median" }), "apps_rollup_invalid", "a known measure");
  assert.equal(await refused("invoices", "g", "number", { from: "lines", link: "invoice", measure: "count", where: "=nothing == 1" }), "apps_rollup_invalid", "a filter on its fields");
  assert.equal(
    (await registry.createTable(ctx.actor, { key: "notes", fields: [{ key: "n", type: "number", rollup: { from: "lines", link: "invoice", measure: "count" } }] }, options).catch((error) => error)).code,
    "apps_rollup_new_table",
    "a new table has no links to it yet"
  );
});

test("a roll-up added later starts worked out; a change costs the same however many lines; an import adds up once", async (context) => {
  const { knex, gate, ctx, idOf, read, add } = await invoicing(context, "apps-rollups-cost");
  const small = await gate.create(ctx, "invoices", { number: "SMALL" });
  const big = await gate.create(ctx, "invoices", { number: "BIG" });
  const empty = await gate.create(ctx, "invoices", { number: "EMPTY" });
  const ids = { item: await idOf("lines", "item"), amount: await idOf("lines", "amount"), invoice: await idOf("lines", "invoice") };
  const lines = (invoice, count) => Array.from({ length: count }, (_, index) => ({ [ids.item]: `Line ${index}`, [ids.amount]: "1.00", [ids.invoice]: invoice }));
  assert.deepEqual((await gate.importRecords(ctx, "lines", [...lines(small.id, 3), ...lines(big.id, 300)])).errors, []);

  await add("invoices", "total", "money", { from: "lines", link: "invoice", measure: "sum", field: "amount" });
  assert.deepEqual(
    [(await read("invoices", small.id)).total, (await read("invoices", big.id)).total, (await read("invoices", empty.id)).total],
    [300, 30000, 0],
    "every invoice worked out when it was added, one without lines too"
  );

  const [smallLine] = (await gate.read(ctx, "lines", { page: { size: 1 } })).records;
  const bigLine = (await gate.read(ctx, "lines", { page: { size: 1, number: 200 } })).records[0];
  assert.equal(bigLine[ids.invoice].id, big.id);
  const change = async (line) => queriesDuring(knex, () => gate.update(ctx, "lines", line.id, { amount: 200 }));
  assert.equal(await change(bigLine), await change(smallLine), "a line of a 300-line invoice costs what a 3-line one's does");
  assert.equal((await read("invoices", big.id)).total, 30100);

  // An import adds up each invoice it touches once: as many grouped reads for 400 lines as for 4.
  const grouped = (rows) => queriesDuring(knex, () => gate.importRecords(ctx, "lines", rows), { matching: /group by/iu });
  const few = await grouped([...lines(small.id, 2), ...lines(empty.id, 2)]);
  const many = await grouped([...lines(small.id, 200), ...lines(empty.id, 200)]);
  assert.equal(many, few, "the same grouped reads for 400 lines as for 4");
  assert.deepEqual([(await read("invoices", small.id)).total, (await read("invoices", empty.id)).total], [20600, 20200]);
});
