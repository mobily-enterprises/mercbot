import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { seedChat } from "../support/chatFixtures.mjs";
import { claimedWork } from "../support/botRecords.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// Background work runs as the person who set it up (R4, D-112): a routine Ben makes in a chat Anna made is Ben's, with
// his approvals, his usage and his cards, never the chat's maker's or the bot's. It runs only as him: once he can't open
// the chat (he left it) or his account is gone, it pauses with a line in the chat. Against the disposable test database,
// a scripted reply in place of the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const ROUTINE = { name: "Market list", schedule: "Every day at 8:00 (UTC)", timezone: "UTC", instructions: "Make the market list.", cron: "0 8 * * *", acknowledgement: "Setting it up" };

/**
 * Anna's home with Ben, Anna's bot Chef, and a private chat Anna made with Ben and Chef; Ben has asked Chef for a daily
 * routine there. Every approval asked, and the meter while the model runs, are kept with the person each is for.
 */
async function setup(context) {
  const decided = [];
  const metered = [];
  const runs = [];
  const meter = { current: null };
  const kit = await startChatTurns(context, {
    approvals: {
      decide: async (what, _how, call) => {
        decided.push({ what, for: String(resolveAuditActorId(call.context) ?? "") });
        // The routine's run asks before it adds another: Ben's card.
        return /^create a recurring routine/u.test(what) && runs.length ? "ask" : "allow";
      }
    },
    reply: async (_bot, _history, tools, _state, prompt) => {
      const { userId, work } = meter.current.currentMeter();
      metered.push({ userId, work });
      if (!prompt) {
        await tools.createRoutine.execute(ROUTINE);
        return { text: "The market list comes every morning at 8.", transcript: [] };
      }
      runs.push(prompt);
      await tools.createRoutine.execute({ ...ROUTINE, name: "Second list" });
      return { text: "Here's today's list.", transcript: [] };
    }
  });
  meter.current = kit.meter;
  const { homeId, people: [anna, ben] } = await homeOfPeople(kit, ["Anna", "Ben"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const { id: chat } = await seedChat(kit.knex, { homeId, kind: "private", people: [anna, ben], bots: [chef], madeBy: anna });
  const as = (person) => kit.as(person, homeId);
  const sent = await kit.turns.chat.sendMessage(chat, { text: "Chef, make me a market list every morning" }, as(ben));
  await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, as(ben));
  await kit.drain();
  const routine = await kit.knex("bot_routines").where({ name: ROUTINE.name }).whereIn("chat_bot_id", kit.knex("chat_bots").select("id").where({ conversation_id: chat })).first();
  /** Runs the routine now, as its runner does once it has claimed it. */
  const run = async () => {
    await kit.turns.runRoutine(claimedWork(await kit.knex("bot_routines").where({ id: routine.id }).first()));
    await kit.drain();
  };
  return { ...kit, homeId, anna, ben, chef, chat, as, routine, run, decided, metered, runs };
}

test("a routine Ben makes in Anna's chat runs as Ben: his approvals, his usage and his card", async (context) => {
  const { knex, anna, ben, chat, routine, run, decided, metered, runs } = await setup(context);
  assert.equal(String(routine.made_by), ben, "made by Ben, who asked, in a chat Anna made with a bot Anna made");
  decided.length = 0;
  metered.length = 0;
  await run();
  assert.equal(runs.length, 1);
  assert.deepEqual(metered, [{ userId: ben, work: "background" }], "Ben's usage");
  assert.deepEqual([...new Set(decided.map((entry) => entry.for))], [ben], "Ben's approvals");
  const card = await knex("messages").where({ conversation_id: chat, kind: "choice" }).orderBy("id", "desc").first();
  assert.equal(card.body.for.id, ben, "the card is Ben's, not Anna's");
  assert.notEqual(card.body.for.id, anna);
});

test("once Ben leaves the chat, his routine there pauses at its next run, with a line, and runs no more", async (context) => {
  const { knex, chats, ben, chat, as, routine, run, runs } = await setup(context);
  await chats.leave(chat, as(ben));
  await run();
  assert.equal(runs.length, 0, "it never ran as anyone else");
  const paused = await knex("bot_routines").where({ id: routine.id }).first();
  assert.deepEqual([paused.enabled, paused.next_run_at], [false, null]);
  const line = await knex("messages").where({ conversation_id: chat, kind: "event" }).whereRaw("body->>'text' = ?", ["Routine paused"]).first();
  assert.match(line.body.detail, /The routine "Market list" is paused: Ben, who set it up, can no longer open this chat/u);
});

test("once Ben's account goes, his routine pauses at its next run, with a line", async (context) => {
  const { knex, ben, chat, routine, run, runs } = await setup(context);
  await knex("users").where({ id: ben }).del();
  assert.equal((await knex("bot_routines").where({ id: routine.id }).first()).made_by, null, "the routine keeps no one's id");
  await run();
  assert.equal(runs.length, 0);
  assert.equal((await knex("bot_routines").where({ id: routine.id }).first()).enabled, false);
  const line = await knex("messages").where({ conversation_id: chat, kind: "event" }).whereRaw("body->>'text' = ?", ["Routine paused"]).first();
  assert.match(line.body.detail, /The routine "Market list" is paused: the account that set it up is gone/u);
});
