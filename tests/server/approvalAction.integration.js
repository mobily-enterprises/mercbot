import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { startChatTurns } from "./turnKit.mjs";
import { testBot } from "./testHome.js";
import { memberOptions } from "../support/botRecords.mjs";

// An approved web step runs on the chat's computer, which saves a screenshot through its own
// database connection. Approving must finish, not wait on a lock the approval itself holds.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("an approved computer step can write screenshots while it runs", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Approver" });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  let actedOn = null;
  const computer = {
    async act(computerId) {
      actedOn = computerId;
      return { success: true };
    }
  };
  const bots = (await startChatTurns(context, { computer })).turns;
  // The bot's card, for the person it worked for (R4).
  const [card] = await knex("messages").insert({
    workspace_id: bot.workspace_id, author_bot_id: bot.id,
    conversation_id: bot.conversation_id,
    kind: "choice",
    role: "bot",
    body: { purpose: "approval", question: "Shall I?", options: ["Go ahead", "Don't do it"], multi: false, chosen: null, action: { id: "use_web_page", args: { instruction: "submit the form" } }, for: { id: String(userId), name: "Pat" } }
  }).returning("*");

  // A bound on the approval, cleared once it finishes so it doesn't keep the process alive 10 s.
  let guard;
  const result = await Promise.race([
    bots.chat.answerChoice(bot.conversation_id, String(card.id), ["Go ahead"], memberOptions({ userId, homeId: bot.workspace_id })),
    new Promise((_resolve, reject) => (guard = setTimeout(() => reject(new Error("approving didn't finish within 10s")), 10000)))
  ]).finally(() => clearTimeout(guard));
  assert.equal(result.messages[0].body.chosen, "Go ahead");
  assert.match(result.messages[1].body.text, /Done on the web page/u);
  assert.equal(String(actedOn), String(bot.chat_bot_id), "the computer is the bot's in this chat (D14)");
});
