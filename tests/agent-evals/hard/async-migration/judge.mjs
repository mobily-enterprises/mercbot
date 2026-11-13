import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const db = require("./db.js");
const { createUser, getUser } = require("./users.js");
const { placeOrder, ordersFor } = require("./orders.js");
const { spendReport } = require("./report.js");

test("judge", async () => {
  await db.reset();
  const ana = await createUser("Ana", "ana@example.com");
  const bo = await createUser("Bo", "bo@example.com");
  assert.equal((await getUser(bo.id)).name, "Bo");
  await placeOrder(ana.id, [{ price: 2.5, qty: 2 }]);
  await placeOrder(ana.id, [{ price: 1, qty: 1 }]);
  assert.equal((await ordersFor(ana.id)).length, 2);
  assert.deepEqual(await spendReport([bo.id, ana.id]), ["Bo: 0.00", "Ana: 6.00"]);
  await assert.rejects(createUser("X", "nope"), /invalid email/);
  await assert.rejects(createUser("X", "ana@example.com"), /email taken/);
  await assert.rejects(getUser(99), /no user 99/);
  await assert.rejects(placeOrder(ana.id, []), /empty order/);
  await assert.rejects(placeOrder(99, [{ price: 1, qty: 1 }]), /no user 99/);
  await assert.rejects(spendReport([ana.id, 99]), /no user 99/);
  assert.ok(createUser("Y", "y@example.com") instanceof Promise);
  for (const file of ["db.js", "users.js", "orders.js", "report.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\b(callback|cb|done)\b/, `${file} still has callbacks`);
  }
  const tests = readFileSync("shop.test.js", "utf8");
  assert.doesNotMatch(tests, /\bdone\b/, "the tests are async too");
  assert.ok((tests.match(/test\(/g) || []).length >= 6, "a test per error case");
  const run = spawnSync("npm", ["test"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
