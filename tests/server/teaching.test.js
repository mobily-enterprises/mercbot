import assert from "node:assert/strict";
import test from "node:test";
import { demoHasSteps, demoLines, demoSummary } from "../../packages/bots/src/server/teaching.js";

// Teach a task: what the bot reads from a recording, and its one-line summary.
const demo = [
  { at: 0, type: "page", url: "about:blank" },
  { at: 2, type: "navigate", url: "https://www.example.com/" },
  { at: 3, type: "page", url: "https://www.example.com/", title: "Example" },
  { at: 5, type: "input", tag: "input", label: "Search", value: "kittens", url: "https://www.example.com/" },
  { at: 6, type: "input", tag: "input", label: "Password", value: "(hidden)", url: "https://www.example.com/" },
  { at: 7, type: "enter", tag: "input", label: "Search", value: "kittens", url: "https://www.example.com/" },
  { at: 9, type: "page", url: "https://www.example.com/s?q=kittens", title: "Results for kittens" }
];

test("a recording becomes plain lines, with secrets kept hidden", () => {
  const lines = demoLines(demo);
  assert.ok(lines.includes('5s: typed "kittens" into "Search" on example.com'));
  assert.ok(lines.includes('6s: typed "(hidden)" into "Password" on example.com'));
  assert.ok(lines.includes('7s: pressed Enter in "Search" (value "kittens")'));
});

test("the summary names the site and where it ended", () => {
  assert.equal(demoSummary(demo), 'You worked on example.com and ended up on "Results for kittens".');
});

test("a still page has no steps", () => {
  assert.equal(demoHasSteps([{ at: 0, type: "page", url: "https://example.com/", title: "Example" }]), false);
  assert.equal(demoHasSteps(demo), true);
});

test("passwords a bot read on a page are blanked in its reply, other slashes are left alone", async () => {
  const { blankPasswords } = await import("../../packages/bots/src/server/replyChecks.js");
  assert.equal(blankPasswords("I signed in with tomsmith / SuperSecretPassword! on the practice page."), "I signed in with tomsmith / ••• on the practice page.");
  assert.equal(blankPasswords("The demo login is **tomsmith** / **SuperSecretPassword!**."), "The demo login is **tomsmith** / •••.");
  assert.equal(blankPasswords("The password is hunter22 for this site."), "The password is ••• for this site.");
  assert.equal(blankPasswords("Lunch and/or dinner, 50 km/h on the road."), "Lunch and/or dinner, 50 km/h on the road.");
});
