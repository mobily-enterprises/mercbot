import assert from "node:assert/strict";
import test from "node:test";
import { createAccountService } from "../../packages/account/src/server/accountService.js";
import { SINGLE_USER_EMAIL } from "../../packages/account/src/server/thisCopy.js";
import { oneRunner } from "../../packages/single-user/src/server/SingleUserFeature.js";

// Who runs this copy (D-59, D-81, D-84), and so may put a home's website in a folder on its computer: whom
// `mercbot.copy-runners` names, Mercbot's one person (@local/single-user) or a copy built on Mercbot's own runners;
// without it, nobody.

const PEOPLE = new Map([["1", SINGLE_USER_EMAIL.toUpperCase()], ["2", "someone@example.com"]]);
const profiles = { findById: async (id) => (PEOPLE.has(id) ? { email: PEOPLE.get(id) } : null) };
const account = (copyRunners) => createAccountService({ resources: {}, systemContext: () => ({}), env: {}, copyRunners });
/** The service's answer for the one person, someone else, a stranger and no one. */
const answers = (service) => Promise.all(["1", "2", "3", "", null].map((userId) => service.runsThisCopy(userId, {})));

test("Mercbot's one person runs it; a copy built on Mercbot names its own runners; without runners, nobody", async () => {
  assert.deepEqual(await answers(account(oneRunner(profiles))), [true, false, false, false, false], "Mercbot: its one person");
  assert.deepEqual(await answers(account(null)), [false, false, false, false, false], "no runners: nobody");

  const asked = [];
  const copyRunners = {
    runsThisCopy: async (userId) => {
      asked.push(userId);
      return userId === "2";
    }
  };
  assert.deepEqual(await answers(account(copyRunners)), [false, true, false, false, false], "the runners a copy names");
  assert.deepEqual(asked, ["1", "2", "3"], "asked about each person, never about no one");
});
