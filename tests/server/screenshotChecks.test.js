import assert from "node:assert/strict";
import test from "node:test";
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { turnDoubles } from "../support/botDoubles.mjs";

// The screenshots a copy that checks pictures checks (D-90): only the ones a reply shows people, the last few under it
// and a hand-over card's, queued once its turn is over. Every other screenshot its computer took is kept unqueued.

const WHOSE = Object.freeze({ homeId: "11", userId: "12", botId: "13", conversationId: "14", computerId: "9" });
const shotName = (at) => `9-${String(at).padStart(16, "0")}.jpg`;

/** A computer that names each screenshot it takes in turn, and one reply's tools on it. */
function turn({ checking = true, queue = null, ...options } = {}) {
  let taken = 0;
  const computer = {
    browse: async (_computerId, url) => ({ url, title: `Page ${taken}`, text: "", screenshot: shotName(taken++) }),
    screenshot: async () => shotName(taken++),
    status: async () => null
  };
  const queued = [];
  const guard = createMediaGuard(checking ? { check: async () => ({ verdict: "allow" }), checkText: async () => ({ verdict: "allow" }) } : null);
  const media = {
    ...createMediaChecks({ guard, mediaChecks: null, systemContext: null, store: null }),
    screenshotLater: queue ?? (async (screenshot) => queued.push(screenshot))
  };
  const run = buildTools(turnDoubles({
    approvals: { decide: async () => "allow" },
    computer,
    files: { media },
    homeId: WHOSE.homeId,
    userId: WHOSE.userId,
    botId: WHOSE.botId,
    conversationId: WHOSE.conversationId,
    computerId: WHOSE.computerId,
    ...options
  }));
  const browse = async (pages) => {
    for (let page = 0; page < pages; page += 1) await run.tools.openWebPage.execute({ url: `https://example.com/${page}` });
  };
  return { run, queued, browse };
}

const queuedFor = (name) => ({ computerId: "9", name, workspaceId: "11", userId: "12", botId: "13" });

test("only the screenshots a reply shows are queued for their check, the hand-over card's among them, once its turn is over", async () => {
  const { run, queued, browse } = turn();
  await browse(6);
  await run.tools.askForHelp.execute({ task: "Sign in to example.com" });
  assert.deepEqual(queued, [], "nothing is queued while the turn works");
  await run.finish();
  assert.deepEqual(queued, [], "nor when its messages are decided");
  await run.close();
  const shown = run.after.find((message) => message.kind === "screenshots").body.images.map((image) => image.name);
  const handover = run.after.find((message) => message.kind === "handover").body.screenshot;
  assert.deepEqual(shown, [2, 3, 4, 5].map(shotName), "the last four pages are under the reply");
  assert.equal(handover, shotName(6));
  assert.deepEqual(queued, [...shown, handover].map(queuedFor), "the first two pages' screenshots, never shown, aren't queued");
});

test("a hand-over card posted without the reply's screenshots still has its screenshot queued", async () => {
  // A group's turn that failed before finish still posts its cards (groupReplies.js).
  const { run, queued } = turn();
  await run.tools.askForHelp.execute({ task: "Sign in to example.com" });
  await run.close();
  assert.deepEqual(queued, [queuedFor(shotName(0))]);
});

test("without a copy that checks pictures, and in a routine's run that posted nothing, nothing is queued", async () => {
  const unchecked = turn({ checking: false });
  await unchecked.browse(2);
  await unchecked.run.finish();
  await unchecked.run.close();
  assert.equal(unchecked.run.after.find((message) => message.kind === "screenshots").body.images.length, 2, "they're shown as ever");
  assert.deepEqual(unchecked.queued, []);

  const quiet = turn({ routineRun: true });
  await quiet.browse(1);
  await quiet.run.tools.askForHelp.execute({ task: "Sign in to example.com" });
  await quiet.run.tools.nothingNew.execute({});
  await quiet.run.close();
  assert.deepEqual(quiet.queued, []);
});

test("a screenshot that can't be queued for its check isn't shown", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const { run, browse } = turn({
    queue: async () => {
      throw new Error("the database is away");
    }
  });
  await browse(2);
  await run.tools.askForHelp.execute({ task: "Sign in to example.com" });
  await run.finish();
  await run.close();
  assert.equal(run.after.some((message) => message.kind === "screenshots"), false, "the screenshots under the reply go");
  assert.equal(run.after.find((message) => message.kind === "handover").body.screenshot, null, "the card shows none");
  assert.match(warned.mock.calls[0].arguments[0], /^Queueing a reply's screenshots for a check failed, so they aren't shown: the database is away$/u);
});
