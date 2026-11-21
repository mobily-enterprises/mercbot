import assert from "node:assert/strict";
import test from "node:test";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { seatOf } from "../../packages/bots/src/server/chatSeats.js";

// A bot's instructions are the same in every chat it's in (R5): its name, template, additions and Knowledge, and
// Mercbot's rules, never the chat's name, people or asker, nor the page's time zone, which the Current state note
// carries. So the start of every prompt of one bot stays the same, and cached, across chats. No model is called.

const ADA = Object.freeze({
  id: "7",
  workspace_id: "3",
  name: "Ada",
  made_by: "1",
  additions: "Always answer in British English.",
  description: "Plans the family's meals."
});

/** The bot a reply hands the model (botReplies.js): its seat in a chat, with what the turn's tools found for it. */
const replyBot = (seat) => ({
  ...seat,
  isBuilder: false,
  template: { tag: "Chef", instructions: "Plan meals for the week.", skills: [{ name: "Shopping list", description: "Turn a plan into a list." }] },
  additions: seat.additions || "",
  knowledge: { inMind: [{ id: "1", title: "Hours", text: "The market opens at 9." }], searched: [] }
});

test("one bot's instructions are byte-identical in two chats, for two people, in two time zones", () => {
  const family = { id: "11", workspace_id: "3", kind: "public", title: "Family dinners", time_zone: "Europe/Rome" };
  const party = { id: "12", workspace_id: "3", kind: "private", title: "Surprise party for Carla", time_zone: "Australia/Perth" };
  const inFamily = instructionsFor(replyBot(seatOf(ADA, family, { id: "880021", job_notes: "Anna's notes" }, "1")));
  const inParty = instructionsFor(replyBot(seatOf(ADA, party, { id: "880022", waiting_task: "Ben's errand" }, "2")));
  assert.equal(inFamily, inParty, "the same words, byte for byte");
  for (const own of ["Family dinners", "Surprise party", "Europe/Rome", "Australia/Perth", "Anna's notes", "Ben's errand", "880021", "880022"]) {
    assert.ok(!inFamily.includes(own), `nothing of a chat, its seat or its person: ${own}`);
  }
  assert.ok(inFamily.includes("Always answer in British English.") && inFamily.includes("Plan meals for the week."), "the bot's own words are there");
  assert.ok(inFamily.includes("The market opens at 9."), "and what it knows");
});

test("the memory's manners are in the instructions, the same in every chat; what a bot remembers is not", () => {
  const family = { id: "11", workspace_id: "3", kind: "public", title: "Family dinners", time_zone: "Europe/Rome" };
  const instructions = instructionsFor(replyBot(seatOf(ADA, family, { id: "880021" }, "1")));
  // D-113: recall and read_chat, where something came from, never quoting a private chat elsewhere, tell_everyone.
  for (const manner of ["recall", "read_chat", "where something came from", "private chat", "tell_everyone"]) {
    assert.ok(instructions.includes(manner), `the instructions say how to use the memory: ${manner}`);
  }
  for (const state of ["<<memory>>", "Since then", "Notes for everyone"]) {
    assert.ok(!instructions.includes(state), `the memory itself is in the state note, never the instructions: ${state}`);
  }
});
