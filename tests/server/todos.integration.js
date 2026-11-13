import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { previewOf } from "../../packages/bots/src/server/botRows.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { testBot } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// A bot's to-do list (D-48): one card in the chat, updated in place as items are ticked off, the
// open list in the state note at the next turn, and a new card for the next job. Against the
// disposable test database, with scripted replies standing in for the model.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("the to-do card is made, ticked off in place, remembered, and replaced for the next job", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Todo ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const turns = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools, state) => {
      turns.push({ state, tools });
      const n = turns.length;
      if (n === 1) {
        const made = await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "doing" }, { text: "Add the field", status: "todo" }, { text: "Test it", status: "todo" }] });
        assert.equal(made.status, "saved");
        const refused = await tools.updateTodos.execute({ items: [{ text: "A", status: "doing" }, { text: "B", status: "doing" }] });
        assert.match(refused.error, /Only one item can be doing/u);
        await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "done" }, { text: "Add the field", status: "doing" }, { text: "Test it", status: "todo" }] });
        return { text: "Working on it.", transcript: [] };
      }
      if (n === 2) {
        const last = await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "done" }, { text: "Add the field", status: "done" }, { text: "Test it", status: "done" }] });
        assert.match(last.note, /Everything on the list is done/u);
        return { text: "All done.", transcript: [] };
      }
      await tools.updateTodos.execute({ items: [{ text: "Plan the trip", status: "doing" }] });
      return { text: "Started.", transcript: [] };
    }
  }));
  const ask = async (text) => {
    const sent = await service.sendMessage(bot.id, { text, clientId: `t-${Date.now()}-${Math.random()}` }, as(userId));
    await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await service.drain(10000);
  };
  const cards = () => knex("bot_messages").where({ bot_id: bot.id, kind: "todos" }).orderBy("id");

  await ask("Add a Due date field to the CRM");
  let list = await cards();
  assert.equal(list.length, 1, "one card, updated in place");
  assert.deepEqual(list[0].body.items.map((item) => item.status), ["done", "doing", "todo"]);

  await ask("Carry on");
  assert.match(turns[1].state, /Your to-do list for this job[\s\S]*\[x\] Read the CRM[\s\S]*\[doing\] Add the field[\s\S]*\[ \] Test it/u, "the open list is in the next turn's state note");
  list = await cards();
  assert.equal(list.length, 1);
  assert.ok(list[0].body.items.every((item) => item.status === "done"));

  await ask("Now plan my trip");
  assert.doesNotMatch(turns[2].state, /Your to-do list/u, "a finished list isn't carried");
  list = await cards();
  assert.equal(list.length, 2, "the next job gets its own card");
  assert.equal(list[1].body.items[0].text, "Plan the trip");
  assert.equal(previewOf(list[0]), "To-do: 3 of 3 done", "the chat list's line for a card");
});

test("job notes are kept for the bot, shown at the next turn, and cleared", async (context) => {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  const bot = await testBot(knex, userId, { name: `Notes ${Date.now().toString(36)}` });
  context.after(async () => {
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const states = [];
  const records = await startBotRecords(knex, context);
  const as = (person) => memberOptions({ userId: person, homeId: bot.workspace_id });
  const service = createBotsService(serviceDoubles({
    knex,
    records,
    approvals: { decide: async () => "allow" },
    reply: async (_bot, _history, tools, state) => {
      states.push(state);
      if (states.length === 1) assert.equal((await tools.keepNotes.execute({ notes: ["The CRM table is contacts", "Due date goes after Stage"] })).status, "saved");
      if (states.length === 2) assert.equal((await tools.keepNotes.execute({ notes: [] })).status, "cleared");
      return { text: "OK.", transcript: [] };
    }
  }));
  for (const text of ["Start the CRM change", "Carry on", "Anything else?"]) {
    const sent = await service.sendMessage(bot.id, { text, clientId: `n-${Date.now()}-${Math.random()}` }, as(userId));
    await service.replyTo(bot.id, { afterMessageId: sent.messages[0].id }, undefined, as(userId));
    await service.drain(10000);
  }
  assert.doesNotMatch(states[0], /Your notes/u);
  assert.match(states[1], /Your notes for the job in hand[\s\S]*- The CRM table is contacts\n- Due date goes after Stage/u, "shown at the next turn");
  assert.doesNotMatch(states[2], /Your notes/u, "and gone once cleared");
  assert.equal(await knex("bot_messages").where({ bot_id: bot.id }).whereNotIn("kind", ["text"]).count("* as n").first().then((row) => Number(row.n)), 0, "nothing shows in the chat");
});
