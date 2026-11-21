import assert from "node:assert/strict";
import test from "node:test";
import { seedChat } from "../support/chatFixtures.mjs";
import { claimedWork } from "../support/botRecords.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "./turnKit.mjs";

// Who pays for a bot's work in a chat (D-112, R8): a reply is the person's who asked, whoever made the bot; a routine's
// run is the person's who made the routine. What the meter carries while the model runs is what usage records.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a reply is metered to whoever asked, never the bot's maker, and a routine's run to whoever made the routine", async (context) => {
  const metered = [];
  const meter = { current: null };
  const kit = await startChatTurns(context, {
    reply: async (_bot, _history, _tools, _state, prompt) => {
      const { userId, botId, workspaceId, work } = meter.current.currentMeter();
      metered.push({ userId, botId, workspaceId, work });
      return { text: prompt ? "Here's this morning's summary." : "On it.", transcript: [] };
    }
  });
  meter.current = kit.meter;
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [ada] = await botsOf(kit, homeId, pat, ["Ada"]);
  const { id: chat, chatBotIds } = await seedChat(kit.knex, { homeId, people: [pat, kim], bots: [ada] });
  async function asks(person, text) {
    const options = kit.as(person, homeId);
    const sent = await kit.turns.chat.sendMessage(chat, { text }, options);
    await kit.turns.chat.reply(chat, { afterMessageId: sent.messages.at(-1).id }, undefined, options);
    await kit.drain();
  }

  await asks(kim, "Ada, what's the weather?");
  await asks(pat, "Ada, and tomorrow?");
  const [routine] = await kit.knex("bot_routines").insert({
    workspace_id: homeId,
    chat_bot_id: chatBotIds.get(ada),
    made_by: kim,
    name: "Morning summary",
    schedule: "Every day at 9:00",
    cron: "0 9 * * *",
    timezone: "UTC",
    enabled: true
  }).returning("*");
  await kit.turns.runRoutine(claimedWork(routine));
  await kit.drain();

  assert.deepEqual(metered, [
    { userId: kim, botId: ada, workspaceId: homeId, work: "chat" },
    { userId: pat, botId: ada, workspaceId: homeId, work: "chat" },
    { userId: kim, botId: ada, workspaceId: homeId, work: "background" }
  ], "Kim's question is Kim's, Pat's is Pat's, and Kim's routine is Kim's, though Pat made Ada");
});
