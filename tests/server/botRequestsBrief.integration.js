import assert from "node:assert/strict";
import test from "node:test";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// A request between bots carries nothing of the asking chat but its brief (O22): the asked bot, outside the asking
// chat, works on the brief alone, its answer lands in the asking chat, and when it needs its computer it joins that
// chat as a member, with a line, and uses its own computer there. Against the disposable test database, a scripted
// reply in place of the model and a stand-in computer.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// Each step without the minutes a real request waits between its turns.
const FAST = { retryMs: 200, resumeMs: 200, nextTurnMs: 200 };
const CANARY = /CANARY-[a-z-]+/gu;
const BRIEF = "Look up the market's opening hours on its website.";

test("the asked bot sees only the brief, answers in the asking chat, and joins it for its computer", async (context) => {
  const seen = [];
  const browsed = [];
  const ids = {};
  const kit = await startChatTurns(context, {
    requestLimits: FAST,
    computer: {
      browse: async (computerId, url) => {
        browsed.push(String(computerId));
        return { url, title: "Market", text: "Open 9 to 5, Monday to Saturday.", screenshot: "market.png" };
      }
    },
    reply: async (bot, history, tools, state, prompt) => {
      if (String(bot.id) === ids.asker) {
        if (!prompt) await tools.askBot.execute({ bot: "Builder", brief: BRIEF });
        return { text: prompt ? "The market opens at 9." : "I've asked the Builder.", transcript: [] };
      }
      seen.push(JSON.stringify({ history, state, prompt }));
      await tools.openWebPage.execute({ url: "https://market.example/hours" });
      await tools.answerRequest.execute({ answer: "It opens 9 to 5, Monday to Saturday." });
      return { text: "Found it on the market's website.", transcript: [] };
    }
  });
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  [ids.asker, ids.builder] = await botsOf(kit, homeId, pat, ["Asker", "Builder"]);
  // The asking chat (Pat and the Asker, not a direct chat, so another bot can join it), with its own private words, and
  // the Builder's own direct chat with Pat, whose words are the Builder's own history elsewhere.
  const { id: chat } = await seedChat(kit.knex, { homeId, kind: "private", people: [pat], bots: [ids.asker] });
  await seedMessage(kit.knex, { homeId, chatId: chat, userId: pat, body: { text: "CANARY-asking-chat: my bank PIN is in the drawer." } });
  const { id: elsewhere } = await seedChat(kit.knex, { homeId, direct: { userId: pat, botId: ids.builder } });
  await seedMessage(kit.knex, { homeId, chatId: elsewhere, userId: pat, body: { text: "CANARY-builder-direct: plans for Saturday." } });

  const as = kit.as(pat, homeId);
  const sent = await kit.turns.chat.sendMessage(chat, { text: "Ask the Builder when the market opens" }, as);
  await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, as);
  // Its steps run until none is left, each when it comes due, by the database's clock; 10 s of waiting in all.
  let waited = 0;
  for (let round = 0; round < 40; round += 1) {
    await kit.drain();
    await kit.turns.requests.runDue();
    await kit.drain();
    const { pending, ms } = await kit.knex("bot_requests").where({ conversation_id: chat }).whereNotNull("next_step").first(
      kit.knex.raw("count(*)::int as pending"),
      kit.knex.raw("ceil(greatest(0, extract(epoch from min(greatest(run_after, coalesce(lease_until, run_after))) - now()) * 1000))::int as ms")
    );
    if (!pending || waited + ms > 10_000) break;
    waited += ms;
    await new Promise((resolve) => setTimeout(resolve, ms + 1));
  }

  // Only the brief: no message of the asking chat, nor of any other chat, reached the asked bot's model.
  assert.ok(seen.length, "the asked bot had its turn");
  for (const input of seen) {
    assert.deepEqual(input.match(CANARY) ?? [], [], "nothing of the asking chat or the bot's other chats");
    assert.ok(input.includes(BRIEF), "the brief, whole");
  }
  // Needing its computer, it joined the asking chat as a member, with a line, and used its own computer there.
  const joined = await kit.knex("chat_bots").where({ conversation_id: chat, bot_id: ids.builder }).first();
  assert.ok(joined, "a member of the asking chat");
  assert.deepEqual([...new Set(browsed)], [String(joined.id)], "its computer in the asking chat");
  const line = await kit.knex("messages").where({ conversation_id: chat, kind: "event" }).whereRaw("body->>'text' = ?", ["Builder joined to work on a request"]).first();
  assert.ok(line, "the chat is told it joined");
  // Its answer, and what it said, are in the asking chat; nothing of it went to its own direct chat.
  const request = await kit.knex("bot_requests").where({ conversation_id: chat }).first();
  assert.deepEqual([request.status, request.answer], ["done", "It opens 9 to 5, Monday to Saturday."]);
  const builderSaid = await kit.knex("messages").where({ conversation_id: chat, author_bot_id: ids.builder, kind: "text" }).pluck("body");
  assert.deepEqual(builderSaid.map((body) => body.text), ["Found it on the market's website."]);
  assert.equal(await kit.knex("messages").where({ conversation_id: elsewhere, author_bot_id: ids.builder }).first(), undefined);
  const askerSaid = await kit.knex("messages").where({ conversation_id: chat, author_bot_id: ids.asker, kind: "text" }).orderBy("id").pluck("body");
  assert.equal(askerSaid.at(-1).text, "The market opens at 9.", "the asking bot carried on with the answer");
});
