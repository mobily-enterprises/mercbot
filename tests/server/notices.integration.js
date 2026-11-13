import assert from "node:assert/strict";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createNotices } from "../../packages/notices/src/server/notices.js";
import { createBotConversations } from "../../packages/bots/src/server/botConversations.js";
import { startBotRecords } from "../support/botRecords.mjs";

// News for open pages (D-15) travels as PostgreSQL notifications. News for many people at once (a
// reply in a shared room reaches everyone in the home) goes out in one statement, however many
// people there are, and still reaches each of them on every server.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** Resolves once `heard` holds `count` events, failing past a coarse bound (a notice that never arrives). */
async function hearing(heard, count) {
  const deadline = Date.now() + 10_000;
  while (heard.length < count) {
    if (Date.now() > deadline) throw new Error(`heard ${heard.length} of ${count} notices`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("news for many people goes out in one statement and reaches each of them", async (context) => {
  const knex = await connectTestDatabase();
  const sender = createNotices({ knex });
  // Another server: its own listening connection.
  const elsewhere = createNotices({ knex });
  context.after(async () => {
    await sender.close();
    await elsewhere.close();
    await knex.destroy();
  });
  // Notifications stay within one database, and each test file has its own.
  const topic = "bots";

  // The listening connection connects in the background: wait until it hears something.
  let ready = false;
  elsewhere.subscribe(topic, "ready", () => (ready = true));
  const readyBy = Date.now() + 10_000;
  while (!ready) {
    if (Date.now() > readyBy) throw new Error("the notices connection never listened");
    await sender.publish(topic, "ready", {});
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const conversations = createBotConversations({ records: await startBotRecords(knex, context), notices: sender });
  const tellEveryone = async (count) => {
    const people = Array.from({ length: count }, (_, index) => `${count}-${index}`);
    const heard = [];
    for (const person of people) elsewhere.subscribe(topic, person, (event) => heard.push({ person, ...event }));
    const queries = await queriesDuring(knex, () => conversations.publish(people, { botId: "7", type: "messages" }));
    await hearing(heard, count);
    assert.deepEqual(heard.map((entry) => entry.person).sort(), [...people].sort(), "each person hears it once");
    assert.ok(heard.every((entry) => entry.botId === "7" && entry.type === "messages"));
    return queries;
  };
  const few = await tellEveryone(3);
  const many = await tellEveryone(40);
  assert.equal(few, 1);
  assert.equal(many, few, `telling 40 people took ${many} queries, 3 took ${few}`);
  assert.equal(await queriesDuring(knex, () => sender.publishEach(topic, [], {})), 0, "nobody to tell costs nothing");
});
