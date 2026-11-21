import assert from "node:assert/strict";
import test from "node:test";
import { claimedWork } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// A routine run reads its instructions and its own last few runs, never the whole chat (D-57): a
// headline check every ten minutes must cost the same in week three as on day one. In Pat's direct chat with the bot.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** Pat's home, Pat's bot `name`, their direct chat, and `count` messages in it, a bot's every other one with `body`. */
async function longChat(kit, name, count, body = {}) {
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  const [botId] = await botsOf(kit, homeId, pat, [name]);
  const { id: chat, chatBotIds } = await seedChat(kit.knex, { homeId, direct: { userId: pat, botId } });
  await kit.knex("messages").insert(Array.from({ length: count }, (_, n) => ({
    workspace_id: homeId,
    conversation_id: chat,
    ...(n % 2 ? { author_bot_id: botId, role: "bot" } : { author_user_id: pat, role: "user" }),
    kind: "text",
    body: JSON.stringify({ text: `Chat ${n}`, ...(n % 2 ? body : {}) })
  })));
  await kit.knex("agent_summaries").insert({ conversation_id: chat, covers_up_to: 1, summary: "Weeks of chat", messages: 1 });
  return { homeId, pat, botId, chat, seat: chatBotIds.get(botId) };
}

test("a routine reads only its own last three runs, however long the chat", async (context) => {
  const seen = [];
  let run = 0;
  // Routines run in the bots' system context, as a job for the person who made the routine.
  const kit = await startChatTurns(context, {
    reply: async (_bot, history, _tools, _state, prompt, options) => {
      seen.push({ history, prompt, summary: options.summary });
      run += 1;
      return { text: `Headline ${run}`, transcript: [{ role: "assistant", content: `Headline ${run}` }] };
    }
  });
  const { knex } = kit;
  const bots = kit.turns;
  // A long chat, a summary of it, and a second routine in the same chat.
  const { homeId, pat, chat, seat } = await longChat(kit, "Routine reader", 40);
  const routine = async (name) => claimedWork((await knex("bot_routines").insert({
    workspace_id: homeId, chat_bot_id: seat, made_by: pat, name, schedule: "Every 10 minutes", instructions: `Do ${name}`,
    cron: "*/10 * * * *", timezone: "UTC", next_run_at: knex.fn.now()
  }).returning("*"))[0]);
  const words = (entry) => entry.history.map((message) => message.body.text);

  const headline = await routine("Headline");
  const other = await routine("Other job");

  await bots.runRoutine(headline);
  assert.deepEqual(words(seen[0]), [], "its first run reads nothing old");
  assert.equal(seen[0].summary, "", "and no summary of the chat");
  assert.match(seen[0].prompt, /Instructions: Do Headline/u);

  await bots.runRoutine(other);
  for (let times = 0; times < 4; times += 1) await bots.runRoutine(headline);
  const last = seen.at(-1);
  assert.deepEqual(words(last), ["Headline 3", "Headline 4", "Headline 5"], "its own last three, oldest first");
  assert.ok(!words(last).includes("Headline 2"), "another routine's run isn't its business");

  // Its reply is still in the chat, marked as its run; and it doesn't count as answering the person.
  const saved = await knex("messages").where({ conversation_id: chat, role: "bot" }).orderBy("id", "desc").first();
  assert.equal(saved.body.routine, String(headline.id));
  assert.equal(saved.body.answers, 0);
  await new Promise((resolve) => setImmediate(resolve));
  await kit.drain(1000);

  // The person's own message still reads the whole chat, routine runs included.
  seen.length = 0;
  const sent = await bots.chat.sendMessage(chat, { text: "What did you find?", clientId: `c-${Date.now()}` }, kit.as(pat, homeId));
  await bots.chat.reply(chat, { afterMessageId: sent.messages[0].id }, undefined, kit.as(pat, homeId));
  await kit.drain(5000);
  assert.ok(words(seen[0]).includes("Chat 5"), "a person's reply reads the chat");
  assert.ok(words(seen[0]).includes("Headline 6"));
});

test("a watch run reads only its own last runs, and a finished command the chat's latest words", async (context) => {
  const seen = [];
  let run = 0;
  // Apps tasks run in the bots' system context, as a job for their person in the bot's home.
  const kit = await startChatTurns(context, {
    reply: async (_bot, history, _tools, _state, prompt, options) => {
      seen.push({ history, prompt, summary: options.summary });
      run += 1;
      return { text: `Task ${run}`, transcript: [{ role: "assistant", content: `Task ${run}` }] };
    }
  });
  const { knex } = kit;
  const bots = kit.turns;
  const transcript = [{ role: "assistant", content: [{ type: "text", text: "An old step" }] }];
  const { homeId, pat, botId, chat, seat } = await longChat(kit, "Task reader", 12, { transcript });
  // A queued job as the Apps job runner claims it (apps.jobs): a watch run's and a finished command's in the bot's seat
  // there, a button's hand-off for the bot in the presser's direct chat with it.
  const job = (kind, watchId = null) => claimedWork({
    workspace_id: homeId,
    kind,
    ...(kind === "task" ? { bot_id: botId, chat_bot_id: null } : { chat_bot_id: seat }),
    user_id: pat,
    watch_id: watchId,
    title: "Task from Test",
    prompt: `Do ${kind}`
  });
  const texts = (entry) => entry.history.map((message) => message.body.text);

  await bots.runAppTask(job("watch", "1"));
  assert.deepEqual(texts(seen[0]), [], "its first run reads nothing old");
  assert.equal(seen[0].summary, "");
  for (let times = 0; times < 3; times += 1) await bots.runAppTask(job("watch", "1"));
  await bots.runAppTask(job("watch", "2"));
  assert.deepEqual(texts(seen.at(-1)), [], "another watch's runs aren't its business");
  await bots.runAppTask(job("watch", "1"));
  assert.deepEqual(texts(seen.at(-1)), ["Task 2", "Task 3", "Task 4"], "its own last three, oldest first");
  const stored = await knex("messages").where({ conversation_id: chat, role: "bot" }).orderBy("id", "desc").first();
  assert.equal(stored.body.routine, "watch:1");
  assert.equal(stored.body.answers, 0, "a watch run doesn't answer the person");

  await bots.runAppTask(job("shell"));
  const command = seen.at(-1);
  assert.equal(command.history.length, 6, "the latest few messages");
  assert.equal(command.summary, "");
  assert.ok(command.history.every((message) => !message.body.transcript), "in words only, without old tool calls");

  await bots.runAppTask(job("task"));
  assert.ok(texts(seen.at(-1)).includes("Chat 5"), "a button's hand-off reads the chat");
  assert.equal(seen.at(-1).summary, "Weeks of chat");
});
