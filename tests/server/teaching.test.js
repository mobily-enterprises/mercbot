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

test("a recording with steps the bot can't make a skill of gets the too-short answer naming the bot", async () => {
  const { createBotTeaching } = await import("../../packages/bots/src/server/botTeaching.js");
  const posted = [];
  const pending = [];
  const teaching = createBotTeaching({
    records: {
      directory: {
        chatBotOf: async () => ({ id: "9" }),
        findBot: async () => ({ id: "3", name: "Tripbot" })
      },
      chats: { people: async () => [] },
      messages: {
        append: async (_chatId, messages) => {
          posted.push(...messages);
          return messages.map((message, index) => ({ ...message, id: String(posted.length + index) }));
        },
        messageById: async () => null
      }
    },
    computer: {
      takeOver: async () => ({ control: null }),
      startRecording: async () => {},
      stopRecording: async () => ({ events: demo }),
      handBack: async () => ({ messages: [] })
    },
    integrations: { createSkill: async () => assert.fail("no skill is saved") },
    notices: { publishEach: async () => {} },
    background: { add: (work) => pending.push(work) },
    writeSkill: async () => ({ name: "", steps: [] })
  });
  await teaching.stopTeaching("1", "3", {}, {});
  await Promise.all(pending);
  assert.match(posted.at(-1).body.text, /^That recording was too short to show me a task.*Teach Tripbot a task/u);
});
