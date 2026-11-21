import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BOT_NAME,
  DESCRIBE,
  JUST_ME,
  NO_BOTS,
  ONBOARDING_STEPS,
  SHOW_TEAMS,
  WITH_OTHERS,
  __testables,
  firstNameOf
} from "../../packages/bots/src/server/onboarding.js";

const { pickNameOptions } = __testables;

test("name options are two distinct ideas plus the default name", () => {
  const options = pickNameOptions();
  assert.equal(options.length, 3);
  assert.equal(options[2], DEFAULT_BOT_NAME);
  assert.notEqual(options[0], options[1]);
});

test("first name comes from the account's display name", () => {
  assert.equal(firstNameOf("ada lovelace"), "Ada");
  assert.equal(firstNameOf("sam.rivera"), "Sam");
  assert.equal(firstNameOf(""), "there");
});

test("onboarding steps run in their order and end", () => {
  const order = [];
  let step = "start";
  while (step) {
    order.push(step);
    const result = ONBOARDING_STEPS[step]({ firstName: "Ada", chosenName: "Juno" });
    step = step === "start" ? "confirm" : result.next;
    if (order.length > 10) throw new Error("onboarding does not end");
  }
  assert.deepEqual(order, ["start", "confirm", "rename", "about", "connect", "settle", "await-nudge"]);
  assert.equal(ONBOARDING_STEPS.start({ firstName: "Ada" }).next, "ask-name");
  assert.equal(ONBOARDING_STEPS.rename({ chosenName: "Juno" }).rename, "Juno");
  assert.deepEqual(ONBOARDING_STEPS.about().messages.map((message) => message.kind), ["text", "text"]);
  assert.equal(ONBOARDING_STEPS.connect().messages[0].kind, "connect");
});

// Phase 3 of a new home (D-112, plan 4.6): once named, the main bot asks what the home is for while it has no other bot,
// then, for its owners and admins while it has no everyone chat, whether anyone else will use it; each card waits at
// its own step for the answer, and either can be skipped by typing.
test("named, the main bot asks what the home is for, then whether anyone else will use it, as each still applies", () => {
  const cardOf = (result) => result.messages.find((message) => message.kind === "choice")?.body ?? null;
  const both = ONBOARDING_STEPS.rename({ chosenName: "Juno", offerBots: true, askPeople: true });
  assert.deepEqual([both.next, both.rename, both.messages[0].body.text], ["home-for", "Juno", "Renamed to Juno"]);
  assert.deepEqual([cardOf(both).purpose, cardOf(both).options, cardOf(both).chosen], ["home-for", [DESCRIBE, SHOW_TEAMS, NO_BOTS], null]);
  const people = ONBOARDING_STEPS.rename({ chosenName: "Juno", askPeople: true });
  assert.deepEqual([people.next, cardOf(people).purpose, cardOf(people).options], ["home-people", "home-people", [JUST_ME, WITH_OTHERS]]);
  const neither = ONBOARDING_STEPS.rename({ chosenName: "Juno" });
  assert.deepEqual([neither.next, cardOf(neither)], ["about", null]);

  const asked = ONBOARDING_STEPS["people-offer"]({ askPeople: true });
  assert.deepEqual([asked.next, cardOf(asked).purpose], ["home-people", "home-people"]);
  assert.deepEqual(ONBOARDING_STEPS["people-offer"]({}), { next: "about", messages: [] });
  assert.equal(ONBOARDING_STEPS["team-offer"], undefined, "the old modes' steps are gone");
  assert.equal(ONBOARDING_STEPS["home-default"], undefined);
});

test("sidebar previews are plain text", async () => {
  const { previewOf } = await import("../../packages/bots/src/server/botRows.js");
  assert.equal(previewOf({ kind: "text", body: { text: "**Bold** see [docs](https://x.y) and `code`" } }), "Bold see docs and code");
  assert.equal(previewOf({ kind: "connect", body: { app: "Gmail" } }), "Connect Gmail");
});

test("bracketed bookkeeping lines never reach the person", async () => {
  const { stripNotes } = (await import("../../packages/bots/src/server/botAgent.js")).__testables;
  assert.equal(stripNotes("The page is open.\n(I handed you my screen to: sign in.)"), "The page is open.");
  assert.equal(stripNotes("Pick one (or both) of these."), "Pick one (or both) of these.");
  assert.equal(stripNotes("(Mercbot's record of a tool that ran: Starred: an email.)(Mercbot's record of a tool that ran: Marked as read: an email.)\n\nBoth undone."), "Both undone.", "copied records go, several on a line too");
});

test("a paragraph that says again what a later one says is spotted, but an answer after a status line isn't", async () => {
  const { sameGist } = await import("@jskit-ai/agent/server");
  assert.equal(sameGist(
    "GitHub isn't signed in, it's waiting for sign-in, so I can't see your activity. If you connect it, I'll pull together the week's activity and flag reviews.",
    "I can't see anything yet because GitHub isn't signed in, it's waiting for sign-in. Connect it and I'll pull this week's activity and flag anything."
  ), true);
  assert.equal(sameGist("I'll check your calendar for Tuesday now.", "Tuesday 3 Nov is clear on both calendars; I changed nothing."), false);
});
