import assert from "node:assert/strict";
import test, { after } from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// Rows made on first use (D-112): a person's welcome chat with the home's main bot (and a new home's main bot with
// it), their direct chat with a bot from its [Message], and the home's everyone chat. Several first uses at once make
// one row, and every caller gets that row. The welcome chat holds the home's lock, so its first visits wait for each
// other and no insert of theirs fails; the others are made on their unique keys (records.chats madeOnce).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const AT_ONCE = 6;

/** What `work` answers, and the statements that failed meanwhile. */
async function watched(work) {
  const failed = [];
  const onError = (error, query) => failed.push(`${String(query?.sql || "")}: ${error.message}`);
  knex.on("query-error", onError);
  try {
    return { answers: await work(), failed };
  } finally {
    knex.removeListener("query-error", onError);
  }
}

const ids = (answers) => [...new Set(answers.map((answer) => answer.chat.id))];

test("a person's first visits at once make one main bot and one welcome chat, with no insert failing", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, as } = await seedHome(knex, context);
  const { answers, failed } = await watched(() => Promise.all(Array.from({ length: AT_ONCE }, () => kit.onboarding.welcome(as("anna")))));
  assert.equal(ids(answers).length, 1, "every visit answers the one welcome chat");
  assert.equal((await knex("bots").where({ workspace_id: homeId })).length, 1);
  assert.equal((await knex("conversations").where({ workspace_id: homeId })).length, 1);
  assert.deepEqual(failed, [], "the home's lock keeps every visit but the first from writing");
});

test("a bot's first [Message]s at once make one direct chat, and the home's first everyone chats one", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, ben, as, bot } = await seedHome(knex, context);
  const chef = await bot("Chef");

  const direct = await Promise.all(Array.from({ length: AT_ONCE }, () => kit.chats.direct(chef, as("ben"))));
  assert.equal(ids(direct).length, 1, "every [Message] opens the one direct chat");
  assert.equal((await knex("conversations").where({ workspace_id: homeId, direct_bot_id: chef, direct_user_id: ben })).length, 1);

  const everyone = await Promise.all(Array.from({ length: AT_ONCE }, () =>
    kit.records.chats.makeEveryoneChat({ title: "Rossi", bots: [chef] }, as("anna"))));
  assert.equal(new Set(everyone.map((chat) => String(chat.id))).size, 1);
  const [row] = await knex("conversations").where({ workspace_id: homeId, everyone: true });
  const people = (await knex("chat_people").where({ conversation_id: row.id })).map((person) => String(person.user_id)).sort();
  assert.deepEqual(people, [anna, ben].sort(), "made once, with everyone in the home once");
});
