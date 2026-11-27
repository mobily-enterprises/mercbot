import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// The home's time zone for its apps (D-140): owners and admins choose it, "today" in a screen's filter follows it, and
// totals group a date by month in it, in time order, labelled as people read them.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const todayIn = (zone) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("the home's time zone: who sets it, today in a filter, and totals by month", async (context) => {
  const home = await appsHome(context, { slug: "apps-dates" });
  const { knex, userId, options, workspace } = home;
  const { registry, gate, apps, runtime, homeZone } = home.apps;
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(person);
  await registry.createTable(person, { key: "tasks", fields: [{ key: "title", type: "text", required: true }, { key: "due", type: "date" }, { key: "amount", type: "money" }] }, options);
  // Kiribati and American Samoa are 25 hours apart, so their todays always differ.
  await gate.create(ctx, "tasks", { title: "Kiribati", due: todayIn("Pacific/Kiritimati"), amount: 100 });
  await gate.create(ctx, "tasks", { title: "Samoa", due: todayIn("Pacific/Pago_Pago"), amount: 200 });
  await gate.create(ctx, "tasks", { title: "October", due: "2026-10-15", amount: 300 });
  await gate.create(ctx, "tasks", { title: "October too", due: "2026-10-30", amount: 400 });
  await apps.createApp(person, { name: "Tasks" }, options);
  const definition = {
    home: "s",
    screens: {
      s: {
        data: {
          due: { from: "tasks", where: "=due == today()" },
          monthly: { from: "tasks", groupBy: "due", by: "month", sum: "amount" }
        },
        content: [
          { type: "table", rows: "=data.due", columns: [{ label: "Title", value: "=row.title" }] },
          { type: "totals", label: "By month", rows: "=data.monthly" }
        ]
      }
    }
  };
  assert.deepEqual((await apps.saveDraft(person, "tasks", definition, "v1", options)).errors, []);
  await apps.publish(person, "tasks", {}, options);
  const appId = (await apps.find("tasks", options)).id;
  const due = async () => (await runtime.query(ctx, { slug: appId, version: "live", screen: "s", query: "due" })).records.map((row) => row.title);

  // ---- Who chooses: owners and admins, by the route ----
  const owner = home.browser({ member: { userId, workspace } });
  const member = home.browser({ member: { userId, workspace, role: "member", permissions: [] } });
  const route = `/api/w/${workspace.slug}/apps-time-zone`;
  assert.equal((await member("PUT", route, { timeZone: "Pacific/Kiritimati" })).body.code, "apps_time_zone_forbidden");
  assert.equal((await owner("PUT", route, { timeZone: "Mars/Base" })).body.code, "apps_time_zone_invalid");
  assert.deepEqual((await owner("PUT", route, { timeZone: "Pacific/Kiritimati" })).body, { timeZone: "Pacific/Kiritimati" });
  assert.equal((await owner("GET", `/api/w/${workspace.slug}/apps-theme`)).body.timeZone, "Pacific/Kiritimati");

  // ---- Today in a filter follows it ----
  assert.deepEqual(await due(), ["Kiribati"]);
  await homeZone.chooseZone(person, "Pacific/Pago_Pago", options);
  assert.deepEqual(await due(), ["Samoa"], "a change counts at once on this server");

  // ---- Totals by month, oldest first, as people read them ----
  const { totals } = await runtime.query(ctx, { slug: appId, version: "live", screen: "s", query: "monthly" });
  const october = totals.find((group) => group.label === "Oct 2026");
  assert.deepEqual([october?.count, october?.total], [2, 700], "two in October, $7.00 in cents");
  const keys = totals.map((group) => group.key);
  assert.deepEqual(keys, [...keys].sort(), "in time order");
  assert.ok(totals.every((group) => /^[A-Z][a-z]{2} \d{4}$/u.test(group.label)), totals.map((group) => group.label).join(", "));

  // ---- Its cost follows the days the records span, not how many there are ----
  const monthly = () => queriesDuring(knex, () => runtime.query(ctx, { slug: appId, version: "live", screen: "s", query: "monthly" }));
  const before = await monthly();
  const tables = await registry.loadTables(options);
  const ids = Object.fromEntries(tables.find((table) => table.key === "tasks").fields.map((field) => [field.key, field.id]));
  await gate.importRecords(ctx, "tasks", Array.from({ length: 300 }, (_, index) => ({ [ids.title]: `More ${index}`, [ids.due]: index % 2 ? "2026-10-15" : "2026-10-30", [ids.amount]: 1 })));
  assert.equal(await monthly(), before, "300 more records on the same days read no more");
});
