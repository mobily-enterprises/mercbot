import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { orderTotal } from "./orders.js";
import { invoiceLine } from "./invoice.js";
import { bigOrders } from "./report.js";
test("judge", () => {
  assert.equal(orderTotal([{ price: 10, qty: 2 }]), 20);
  assert.equal(orderTotal([{ price: 10, qty: 2 }], 0.25), 15);
  assert.equal(invoiceLine("Ana", [{ price: 1.5, qty: 2 }]), "Ana: 3.00");
  assert.deepEqual(bigOrders([{ id: "a", items: [{ price: 50, qty: 3 }] }, { id: "b", items: [{ price: 1, qty: 1 }] }], 100), ["a"]);
  for (const file of readdirSync(".").filter((name) => name.endsWith(".js"))) assert.ok(!readFileSync(file, "utf8").includes("calcTotal"), file);
});
