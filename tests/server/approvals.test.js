import assert from "node:assert/strict";
import test from "node:test";
import { createApprovals } from "../../packages/bots/src/server/approvals.js";

// A stand-in for the person's policy (records.policies), enough for decide().
const fakePolicies = ({ autoReview = true, rules = [] }) => ({ policy: async () => ({ autoReview, rules }) });
// decide() reads the policy of the call's person; the stand-in has only one.
const call = { context: {} };

const rule = (id, behaviour) => ({ id, action: `rule ${id}`, behaviour });
const matchAll = async (rules) => rules;
const matchNone = async () => [];

test("auto-review asks before writes when no rule applies", async () => {
  const approvals = createApprovals({ policies: fakePolicies({}), match: matchNone });
  assert.equal(await approvals.decide("submit the form", {}, call), "ask");
});

test("with auto-review off, unmatched writes are allowed", async () => {
  const approvals = createApprovals({ policies: fakePolicies({ autoReview: false }), match: matchNone });
  assert.equal(await approvals.decide("create a routine", {}, call), "allow");
});

test("a matching allow rule skips asking, and ask wins over allow", async () => {
  const allowOnly = createApprovals({ policies: fakePolicies({ rules: [rule(1, "allow")] }), match: matchAll });
  assert.equal(await allowOnly.decide("create a routine", {}, call), "allow");
  const both = createApprovals({ policies: fakePolicies({ autoReview: false, rules: [rule(1, "allow"), rule(2, "ask")] }), match: matchAll });
  assert.equal(await both.decide("create a routine", {}, call), "ask");
});

test("reversible actions only ask when a rule says so", async () => {
  const unmatched = createApprovals({ policies: fakePolicies({}), match: matchNone });
  assert.equal(await unmatched.decide("create a routine", { reversible: true }, call), "allow");
  const askRule = createApprovals({ policies: fakePolicies({ rules: [rule(1, "ask")] }), match: matchAll });
  assert.equal(await askRule.decide("create a routine", { reversible: true }, call), "ask");
});
