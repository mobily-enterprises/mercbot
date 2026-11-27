import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Moving a card (D-140): a board's card to another column, a calendar's to another day and a timeline's bar along
// change their record through the data gate, so the table's rule on saving can refuse one, with its reason; a part
// that doesn't move, or a path that isn't such a part, is refused.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const NEEDS_AMOUNT = `async function main(input) {
  if (input.record.stage === "Won" && !input.record.amount) return { refuse: "A won deal needs its amount." };
  return {};
}`;

test("cards move their records through the gate and its rules; a part that doesn't move refuses", async (context) => {
  const home = await appsHome(context, { slug: "apps-boards" });
  const { userId, options } = home;
  const { registry, gate, apps, scripts, runtime } = home.apps;
  const person = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(person);
  await registry.createTable(person, {
    key: "deals",
    fields: [
      { key: "name", type: "text", required: true },
      { key: "stage", type: "choice", choices: ["Open", "Won", "Lost"] },
      { key: "amount", type: "money" },
      { key: "starts", type: "date" },
      { key: "ends", type: "date" },
      { key: "visit", type: "datetime" }
    ]
  }, options);
  const acme = await gate.create(ctx, "deals", { name: "Acme", stage: "Open", amount: 5000, starts: "2026-11-27", ends: "2026-11-30", visit: "2026-11-27T09:30:00Z" });
  const bolt = await gate.create(ctx, "deals", { name: "Bolt", stage: "Open" });
  await apps.createApp(person, { name: "Pipeline" }, options);
  const saved = await scripts.save(person, "pipeline", {
    key: "won_amount", kind: "rule", summary: "A won deal needs its amount", settings: { table: "deals", on: ["update"] }, code: NEEDS_AMOUNT,
    tests: [{ name: "no amount", input: { action: "update", record: { stage: "Won" }, previous: { stage: "Open" } }, expect: { refuse: "A won deal needs its amount." } }]
  }, options);
  assert.deepEqual(saved.errors, []);
  const definition = {
    home: "plan",
    screens: {
      plan: {
        data: { deals: { from: "deals", sort: "name" } },
        content: [
          { type: "board", rows: "=data.deals", groupBy: "stage", title: "=row.name" },
          { type: "calendar", rows: "=data.deals", date: "visit", title: "=row.name" },
          { type: "timeline", rows: "=data.deals", start: "starts", end: "ends", title: "=row.name" },
          { type: "board", rows: "=data.deals", groupBy: "stage", title: "=row.name", move: false }
        ]
      }
    }
  };
  assert.deepEqual((await apps.saveDraft(person, "pipeline", definition, "v1", options)).errors, []);
  await apps.publish(person, "pipeline", {}, options);
  const appId = (await apps.find("pipeline", options)).id;
  const move = (path, row, to) => runtime.move(ctx, { slug: appId, version: "live", screen: "plan", path, row, to });
  const deal = async (id) => (await runtime.query(ctx, { slug: appId, version: "live", screen: "plan", query: "deals" })).records.find((record) => record.id === id);

  assert.deepEqual(await move("content/0", acme.id, "Won"), { moved: true });
  assert.equal((await deal(acme.id)).stage, "Won", "the board's card took the column's choice");
  await assert.rejects(move("content/0", bolt.id, "Won"), { message: /A won deal needs its amount/u }, "the table's rule refuses, with its reason");
  assert.equal((await deal(bolt.id)).stage, "Open", "and the card stays where it was");
  await assert.rejects(move("content/0", bolt.id, "Gone"), { code: "apps_move_invalid" });

  await move("content/1", acme.id, 3);
  assert.equal(new Date((await deal(acme.id)).visit).toISOString(), "2026-11-30T09:30:00.000Z", "the calendar's card three days on, at its time");
  await move("content/2", acme.id, -2);
  assert.deepEqual([(await deal(acme.id)).starts, (await deal(acme.id)).ends], ["2026-11-25", "2026-11-28"], "the bar's start and end two days back");

  await assert.rejects(move("content/3", acme.id, "Lost"), { code: "apps_move_not_found" }, "a board that doesn't move");
  await assert.rejects(move("content/9", acme.id, "Lost"), { code: "apps_move_not_found" }, "not a part");
});
