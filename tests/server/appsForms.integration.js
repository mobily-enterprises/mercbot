import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// Better forms (D-140), on the test database: a field's min, max, pattern and unique hold for every save (a single
// write, a change, an import), checks added to a field later, a unique one refused while two records share a value; a
// button's branch runs the steps its `when` picks; and a create form's button answers the record it made, with the file
// fields it shows, for the browser to put its files on.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("field checks hold for every save; a field gets them later; unique is refused while values are shared", async (context) => {
  const home = await appsHome(context, { slug: "apps-checks" });
  const { registry, gate } = home.apps;
  const person = { type: "person", id: home.userId, name: "Pat" };
  const ctx = home.ctx(person);
  const { options } = home;
  await registry.createTable(person, {
    key: "members",
    fields: [
      { key: "name", type: "text", required: true },
      { key: "email", type: "email", unique: true },
      { key: "postcode", type: "text", pattern: "[0-9]{4}", patternMessage: "a 4-digit postcode" },
      { key: "age", type: "number", min: 18, max: 120 },
      { key: "joined", type: "date" },
      { key: "badge", type: "text" }
    ]
  }, options);
  const refusal = async (work) => (await work.catch((error) => error)).code;

  const ana = await gate.create(ctx, "members", { name: "Ana", email: "ana@example.com", postcode: "6000", age: 30 });
  assert.equal(await refusal(gate.create(ctx, "members", { name: "Bo", age: 12 })), "apps_value_out_of_range", "too young");
  assert.equal(await refusal(gate.create(ctx, "members", { name: "Bo", postcode: "60" })), "apps_value_out_of_range", "not a postcode");
  assert.equal(await refusal(gate.create(ctx, "members", { name: "Bo", email: "ANA@example.com" })), "apps_value_unique_taken", "the same email, in capitals");
  const bo = await gate.create(ctx, "members", { name: "Bo", email: "bo@example.com" });
  await gate.update(ctx, "members", ana.id, { email: "ana@example.com", age: 31 });
  assert.equal(await refusal(gate.update(ctx, "members", bo.id, { email: "Ana@Example.com" })), "apps_value_unique_taken", "a change into a taken one");
  assert.equal(await refusal(gate.update(ctx, "members", bo.id, { age: 121 })), "apps_value_out_of_range");
  const members = (await registry.loadTables(options)).find((table) => table.key === "members");
  const id = (key) => members.fields.find((field) => field.key === key).id;
  const imported = await gate.importRecords(ctx, "members", [
    { [id("name")]: "Cy", [id("email")]: "cy@example.com" },
    { [id("name")]: "Cy again", [id("email")]: "CY@example.com" },
    { [id("name")]: "Di", [id("email")]: "bo@example.com" },
    { [id("name")]: "Ed", [id("age")]: "7" }
  ]);
  assert.deepEqual(imported.errors.map((error) => error.row), [3, 4, 5], "a repeat among the rows, a taken one, a value out of range");

  const badge = members.fields.find((field) => field.key === "badge");
  await gate.update(ctx, "members", bo.id, { badge: "gold" });
  await gate.update(ctx, "members", ana.id, { badge: "gold" });
  assert.equal(await refusal(registry.changeChecks(person, badge.id, { unique: true }, options)), "apps_field_unique_shared", "two records share gold");
  await gate.update(ctx, "members", bo.id, { badge: "silver" });
  await registry.changeChecks(person, badge.id, { unique: true, pattern: "[a-z]+" }, options);
  assert.equal(await refusal(gate.update(ctx, "members", bo.id, { badge: "gold" })), "apps_value_unique_taken", "unique now");
  await registry.changeChecks(person, badge.id, { unique: null }, options);
  await gate.update(ctx, "members", bo.id, { badge: "gold" });
  assert.equal(await refusal(gate.update(ctx, "members", bo.id, { badge: "Gold1" })), "apps_value_out_of_range", "the pattern stayed");
  const joined = members.fields.find((field) => field.key === "joined");
  await registry.changeChecks(person, joined.id, { min: "2020-01-01" }, options);
  assert.equal(await refusal(gate.update(ctx, "members", bo.id, { joined: "2019-12-31" })), "apps_value_out_of_range");

  assert.equal(await refusal(registry.addField(person, "members", { key: "nick", type: "text", min: 3 }, options)), "apps_field_check_invalid", "min on text");
  assert.equal(await refusal(registry.addField(person, "members", { key: "code", type: "text", pattern: "(a+)+" }, options)), "apps_field_check_invalid", "a slow pattern");
  assert.equal(await refusal(registry.addField(person, "members", { key: "vip", type: "yesno", unique: true }, options)), "apps_field_check_invalid", "unique yes/no");
  assert.equal(await refusal(registry.addField(person, "members", { key: "score", type: "number", min: 10, max: 5 }, options)), "apps_field_check_invalid", "min above max");
});

test("a button's branch runs what its when picks; a create form's button answers the record it made and its file fields", async (context) => {
  const home = await appsHome(context, { slug: "apps-branch" });
  const { registry, apps, runtime } = home.apps;
  const person = { type: "person", id: home.userId, name: "Pat" };
  const ctx = home.ctx(person);
  const { options } = home;
  await registry.createTable(person, { key: "orders", fields: [{ key: "item", type: "text" }, { key: "amount", type: "money" }, { key: "receipt", type: "image" }] }, options);
  await apps.createApp(person, { name: "Orders" }, options);
  const definition = {
    home: "add",
    screens: {
      add: {
        content: [{
          type: "form",
          table: "orders",
          fields: ["item", "amount", "receipt"],
          buttons: [{
            type: "button",
            label: "Save",
            confirm: "Add this order?",
            do: [
              { create: { table: "orders", values: "=form.values" } },
              { if: { when: "=form.amount > 10000.0", then: [{ notify: "=\"Big order: \" + form.item" }], else: [{ notify: "Thanks" }, { if: { when: "=form.item == \"\"", then: [{ notify: "No item?" }] } }] } }
            ]
          }]
        }]
      }
    }
  };
  assert.deepEqual((await apps.saveDraft(person, "orders", definition, "v1", options)).errors, []);
  await apps.publish(person, "orders", {}, options);
  const appId = (await apps.find("orders", options)).id;
  const save = (values) => runtime.action(ctx, { slug: appId, version: "live", screen: "add", path: "content/0/buttons/0/do", values });

  const big = await save({ item: "Piano", amount: 250000 });
  assert.deepEqual(big.effects, [{ notify: "Big order: Piano" }]);
  assert.equal(big.created.length, 1);
  assert.deepEqual([big.created[0].table, big.created[0].files], ["orders", ["receipt"]], "its file fields, for the browser");
  assert.deepEqual((await save({ item: "Pen", amount: 300 })).effects, [{ notify: "Thanks" }]);
  assert.deepEqual((await save({ amount: 300 })).effects, [{ notify: "Thanks" }, { notify: "No item?" }], "a branch inside a branch");
});
