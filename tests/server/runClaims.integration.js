import assert from "node:assert/strict";
import test from "node:test";
import { seedChat } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// A bot's reply slot in a chat (D-48 runs, D-124): claiming one that's already running answers "busy" without an insert
// the database refuses. agent-runtime's claim inserts the run and reads a refused duplicate as busy, but json-rest-api
// logs every refused insert at error level ("Error in POST method") before the claim handles it, and a request's step
// or a goal round retries a busy bot every few seconds: Preview's log showed one every ~10 s while a bot worked. A run
// whose server stopped beating is still taken over, and a free slot is claimed as before.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("a running reply's slot is busy with no refused insert; a stale one is taken over, a free one claimed", async (context) => {
  const kit = await startChatTurns(context, { reply: async () => ({ text: "Hi.", transcript: [] }) });
  const { homeId, people: [pat] } = await homeOfPeople(kit, ["Pat"]);
  const [ada] = await botsOf(kit, homeId, pat, ["Ada"]);
  const { id: chat } = await seedChat(kit.knex, { homeId, people: [pat], bots: [ada] });
  const { id: seat } = await kit.knex("chat_bots").where({ conversation_id: chat }).first();
  const runs = kit.records.agent.createRuns();
  const owner = { bot_id: ada, user_id: pat };
  const inserts = (work) => queriesDuring(kit.knex, work, { matching: /^insert into "agent_runs"/u });

  assert.equal(await runs.claim(seat, owner), true);
  let claimed;
  assert.equal(await inserts(async () => { claimed = await runs.claim(seat, owner); }), 0, "no insert the database refuses");
  assert.equal(claimed, false, "busy");

  await kit.knex("agent_runs").where({ conversation_id: seat }).update({ heartbeat_at: kit.knex.raw("now() - interval '5 minutes'") });
  assert.equal(await runs.claim(seat, owner), true, "a run whose server stopped is taken over");

  await runs.release(seat);
  assert.equal(await inserts(async () => { claimed = await runs.claim(seat, owner); }), 1);
  assert.equal(claimed, true, "a free slot is claimed");
});
