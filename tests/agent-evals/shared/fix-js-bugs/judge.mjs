import test from "node:test";
import assert from "node:assert/strict";
import { addItem, cartTotal } from "./cart.js";
import { applyCoupon } from "./coupon.js";
test("judge", () => {
  assert.deepEqual(addItem({ b: 1 }, "b"), { b: 2 });
  assert.ok(Math.abs(cartTotal({ a: 2, b: 1 }, { a: 0.1, b: 0.2 }) - 0.4) < 1e-9);
  assert.equal(applyCoupon(20, "SAVE10"), 18);
  assert.equal(applyCoupon(4, "FLAT5"), 0);
  assert.equal(applyCoupon(9, "NOPE"), 9);
});
