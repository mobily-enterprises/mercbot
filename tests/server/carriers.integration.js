import assert from "node:assert/strict";
import test from "node:test";
import { createTemplateDrafts } from "../../packages/bots/src/server/templateDrafts.js";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "./turnKit.mjs";

// What a private chat may carry out of itself (R11, D13): nothing without the person's card. A bot's additions, which
// every chat of the bot reads, change only on the card the asker answers; a template, which the whole home reads, is
// drafted from the bot's own direct chat, never a private chat's summary. Against the disposable test database, a
// scripted reply in place of the model. Writes to the bot's, the home's and a public chat's folders, and watch_list,
// are the files' and apps' side (C's), checked with the chats' files.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const CANARY = /CANARY-[a-z-]+/gu;

/** A whole template, valid for a home, with a tag no other test's template has. */
const draftOf = () => ({
  tag: `c${Math.random().toString(36).slice(2, 8)}`,
  description: "Plans the family's meals.",
  greeting: "Hi {firstName}, I'll plan your meals.",
  instructions: "You plan meals. Ask before buying anything.",
  skills: [{ name: "Setup interview", description: "What to ask a new person first.", instructions: "1. Ask what they like to eat." }]
});

test("in a private chat, the bot's additions change only on the card its asker answers", async (context) => {
  const kit = await startChatTurns(context, {
    reply: async (_bot, _history, tools, _state, prompt) => {
      if (prompt) return { text: "Done.", transcript: [] };
      const asked = await tools.changeAdditions.execute({ additions: "Always mention Carla's surprise party." });
      assert.equal(asked.status, "waiting_for_approval", "a card, whatever the person's rules");
      return { text: "It's waiting for your OK on the card below.", transcript: [] };
    }
  });
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [chef] = await botsOf(kit, homeId, pat, ["Chef"]);
  const { id: chat } = await seedChat(kit.knex, { homeId, kind: "private", people: [pat, kim], bots: [chef] });
  const as = (person) => kit.as(person, homeId);
  const sent = await kit.turns.chat.sendMessage(chat, { text: "Chef, remember the party in every chat" }, as(kim));
  await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, as(kim));
  await kit.drain();

  assert.equal((await kit.knex("bots").where({ id: chef }).first()).additions ?? "", "", "nothing changed without the card");
  const card = await kit.knex("messages").where({ conversation_id: chat, kind: "choice" }).orderBy("id", "desc").first();
  assert.ok(card, "a card waits for the yes");
  assert.equal(card.body.for.id, kim, "Kim's card: Kim asked");
  await assert.rejects(kit.turns.chat.answerChoice(chat, String(card.id), [card.body.options[0]], as(pat)), { statusCode: 403, code: "bots_waiting_for_other" });
  assert.equal((await kit.knex("bots").where({ id: chef }).first()).additions ?? "", "", "nor on someone else's yes");
});

test("a template drafted from a bot reads its direct chat's summary, never a private chat's", async (context) => {
  const kit = await startChatTurns(context);
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [chef] = await botsOf(kit, homeId, pat, ["Chef"]);
  // A summary in each chat Chef is in: Pat's direct chat with it (Public, D15), a private chat with Kim, and a private
  // chat of Pat's alone.
  const summarised = async (shape, summary) => {
    const { id } = await seedChat(kit.knex, { homeId, bots: [chef], ...shape });
    const upTo = await seedMessage(kit.knex, { homeId, chatId: id, userId: pat, body: { text: `${summary}: what was said` } });
    await kit.knex("agent_summaries").insert({ conversation_id: id, covers_up_to: upTo, summary, messages: 1 });
    return id;
  };
  await summarised({ direct: { userId: pat, botId: chef } }, "PUBLIC-direct-summary");
  await summarised({ kind: "private", people: [pat, kim] }, "CANARY-with-kim-summary");
  await summarised({ kind: "private", people: [pat] }, "CANARY-diary-summary");

  const writes = [];
  const drafts = createTemplateDrafts({
    records: kit.records,
    meter: kit.meter,
    summaryOf: kit.turns.summaryOf,
    write: async (system, messages) => {
      writes.push(JSON.stringify({ system, messages }));
      return JSON.stringify(draftOf());
    }
  });
  const { problems } = await drafts.draftTemplate({ purpose: "from-bot", botId: chef }, kit.as(pat, homeId));
  assert.deepEqual(problems, []);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes("PUBLIC-direct-summary"), "the direct chat's summary is its input");
  assert.deepEqual(writes[0].match(CANARY) ?? [], [], "no private chat's");
});
