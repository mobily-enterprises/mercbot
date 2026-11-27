import assert from "node:assert/strict";
import test from "node:test";
import { ROOMS_MEMORY_LIMITS } from "../../packages/bots/src/server/roomsMemory.js";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { moduleClock } from "../support/moduleClock.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// When a bot's rooms memory is refreshed, and how (D-113; B2's test 3): soon once a public chat's new words pass the
// threshold, else a day after the last; one server at a time, whose lease is renewed while it writes; never over a
// digest written meanwhile; again later, waiting longer each time, when it fails; and made again from the chats
// themselves once a public chat is deleted, without it, at once on a serving server. A stand-in writes every digest;
// no provider is called.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

/** A promise and its resolve, for a stand-in to wait on. */
function gate() {
  let open;
  const opened = new Promise((resolve) => { open = resolve; });
  return { opened, open };
}

/** A home with Anna, Ben, Chef, and Garden, a public chat of theirs with Chef; `write` stands in for the digest's writer. */
async function gardenHome(context, write, memoryLimits = {}) {
  const kit = await startChatTurns(context, { writeMemory: (...args) => write(...args), memoryLimits });
  const { homeId, people: [anna, ben] } = await homeOfPeople(kit, ["Anna", "Ben"]);
  const [chef] = await botsOf(kit, homeId, anna, ["Chef"]);
  const garden = await seedChat(kit.knex, { homeId, title: "Garden", people: [anna, ben], bots: [chef], madeBy: anna });
  const home = { context: kit.systemContext("memory refresh test").forWorkspace(homeId) };
  const row = () => kit.knex("rooms_memory_queue").where({ bot_id: chef }).first();
  /** Minutes until the bot's refresh is due, by the database's clock, or null when none is asked for. */
  const dueIn = async () => {
    const { rows: [found] } = await kit.knex.raw("select extract(epoch from due_at - now()) / 60 as minutes from rooms_memory_queue where bot_id = ?", [chef]);
    return found ? Number(found.minutes) : null;
  };
  const digest = () => kit.knex("rooms_memories").where({ bot_id: chef }).first();
  const due = () => kit.records.roomsMemory.ask([{ botId: chef, minutes: 0 }], {}, home);
  return { kit, homeId, anna, ben, chef, garden, home, row, dueIn, digest, due };
}

test("a public chat's words ask for a refresh: soon past the threshold, else a day after the last", async (context) => {
  const f = await gardenHome(context, async () => "## Garden\n- [Garden · Anna] tomatoes", { threshold: 20 });
  const say = (text) => seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text, authorName: "Anna" } });
  const near = (minutes, expected, what) => assert.ok(Math.abs(minutes - expected) < 2, `${what}: due in ${minutes} minutes, not ${expected}`);

  // No digest yet: a few words wait a day; words past the threshold (20 tokens, about 80 characters) are due now.
  await say("Tomatoes on the fourteenth");
  await f.kit.roomsMemory.noticed(f.homeId, f.garden.id);
  near(await f.dueIn(), ROOMS_MEMORY_LIMITS.dailyMinutes, "a few words");
  await say("We agreed: the tomatoes go in on the fourteenth, the beans a week later, and Ben brings the stakes on Saturday");
  await f.kit.roomsMemory.noticed(f.homeId, f.garden.id);
  near(await f.dueIn(), 0, "past the threshold, with no digest");
  assert.equal((await f.row()).asks, 2, "each ask counts");

  // Refreshed: the asks it ran for are done.
  assert.equal(await f.kit.roomsMemory.runner.runOne(), true);
  assert.equal(await f.row(), undefined, "nothing more asked");
  assert.equal((await f.digest()).text, "## Garden\n- [Garden · Anna] tomatoes");

  // Just refreshed: a few words wait a day from it; past the threshold, the spacing from it (30 minutes).
  await say("And the basil");
  await f.kit.roomsMemory.noticed(f.homeId, f.garden.id);
  near(await f.dueIn(), ROOMS_MEMORY_LIMITS.dailyMinutes, "a few words after a refresh");
  await say("Then the courgettes, which Anna wants by the fence this year, and the peppers by the wall where it's warm");
  await f.kit.roomsMemory.noticed(f.homeId, f.garden.id);
  near(await f.dueIn(), ROOMS_MEMORY_LIMITS.spacingMinutes, "past the threshold, just after a refresh");

  // A private chat's words never go in a digest: they ask for nothing.
  await f.kit.knex("rooms_memory_queue").where({ bot_id: f.chef }).del();
  const plans = await seedChat(f.kit.knex, { homeId: f.homeId, kind: "private", title: "Plans", people: [f.anna, f.ben], bots: [f.chef] });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: plans.id, userId: f.anna, body: { text: "A surprise for Carla ".repeat(20), authorName: "Anna" } });
  await f.kit.roomsMemory.noticed(f.homeId, plans.id);
  assert.equal(await f.row(), undefined, "a private chat asks for no refresh");
});

test("two servers claim one refresh once, and a digest written meanwhile isn't written over", async (context) => {
  const writing = gate();
  const release = gate();
  let writes = 0;
  const f = await gardenHome(context, async () => {
    writes += 1;
    writing.open();
    await release.opened;
    return "## Garden\n- the first server's";
  });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text: "Tomatoes on the fourteenth", authorName: "Anna" } });
  await f.kit.records.roomsMemory.saveDigest(f.chef, null, { text: "## Garden\n- older", covers: {}, upTo: null, tokens: 3 }, f.home);
  await f.due();

  const first = f.kit.roomsMemory.runner.runOne();
  await writing.opened;
  assert.equal(await f.kit.roomsMemory.runner.runOne(), false, "the second server finds nothing to claim");
  // Meanwhile another digest is written over the one the first server read.
  const read = await f.digest();
  assert.equal(await f.kit.records.roomsMemory.saveDigest(f.chef, Number(read.version), { text: "## Garden\n- written meanwhile", covers: {}, upTo: null, tokens: 3 }, f.home), true);
  assert.equal(await f.kit.records.roomsMemory.saveDigest(f.chef, Number(read.version), { text: "## Garden\n- stale", covers: {}, upTo: null, tokens: 1 }, f.home), false, "one that follows an old version is refused");
  release.open();
  assert.equal(await first, true);
  assert.equal(writes, 1, "written once");
  const kept = await f.digest();
  assert.equal(kept.text, "## Garden\n- written meanwhile", "the first server's digest is refused");
  assert.equal(Number(kept.version), Number(read.version) + 1);
  const again = await f.row();
  assert.ok(again && again.claimed_by === null && (await f.dueIn()) <= 0, "and its refresh is due again, from the newer digest");
});

test("a deleted public chat is gone from the digest at once, and from the one made again", async (context) => {
  const inputs = [];
  const f = await gardenHome(context, async (_system, content) => {
    inputs.push(content);
    return content.split("\n").filter((line) => line.startsWith("[")).join("\n");
  });
  const shed = await seedChat(f.kit.knex, { homeId: f.homeId, title: "Shed", people: [f.anna, f.ben], bots: [f.chef], madeBy: f.anna });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text: "Tomatoes on the fourteenth", authorName: "Anna" } });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: shed.id, userId: f.ben, body: { text: "The mower's blade is blunt", authorName: "Ben" } });
  await f.due();
  assert.equal(await f.kit.roomsMemory.runner.runOne(), true);
  assert.match((await f.digest()).text, /Tomatoes[\s\S]*blade|blade[\s\S]*Tomatoes/u, "both chats are remembered");

  await f.kit.chats.remove(shed.id, f.kit.as(f.anna, f.homeId));
  assert.equal((await f.digest()).text, "", "forgotten at once: no turn reads it");
  const asked = await f.row();
  assert.ok(asked.rebuild && (await f.dueIn()) <= 0, "made again from the chats now");
  assert.equal(await f.kit.roomsMemory.runner.runOne(), true);
  assert.match(inputs.at(-1), /There is no earlier memory/u, "from the chats themselves, not the old digest");
  assert.ok(!inputs.at(-1).includes("blade") && !inputs.at(-1).includes("Shed"), "the deleted chat isn't read");
  const remade = await f.digest();
  assert.match(remade.text, /Tomatoes/u);
  assert.ok(!remade.text.includes("blade"), "nor remembered");
  assert.deepEqual(Object.keys(remade.covers), [String(f.garden.id)], "nor kept as read");
});

test("on a serving server, a refresh asked for now runs at once, not at its loop's next turn", async (context) => {
  const f = await gardenHome(context, async (_system, content) => content.split("\n").filter((line) => line.startsWith("[")).join("\n"));
  const loop = f.kit.roomsMemory.runner.start({ everyMs: 60 * 60 * 1000 });
  try {
    await f.kit.roomsMemory.runner.runDue();
    const shed = await seedChat(f.kit.knex, { homeId: f.homeId, title: "Shed", people: [f.anna], bots: [f.chef], madeBy: f.anna });
    await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text: "Tomatoes on the fourteenth", authorName: "Anna" } });
    await f.kit.chats.remove(shed.id, f.kit.as(f.anna, f.homeId));
    await f.kit.drain();
    const remade = await f.digest();
    assert.match(remade.text, /Tomatoes/u, "made again now, an hour before the loop's next turn");
    assert.deepEqual(Object.keys(remade.covers), [String(f.garden.id)]);
  } finally {
    await loop.drain(10000);
  }
});

test("a slow write keeps its lease, renewed past its first end, so no other server takes it over", async (context) => {
  const lease = { seconds: 2, heartbeatMs: 200 };
  // The server's beats and its own steady clock (runLease.js) move with this test, a beat at a time once the last
  // renewal has reached the database, so a busy machine's slow queries never make it give the run up; the lease itself
  // ends on the database's clock, in real time.
  const clock = moduleClock(context, "bots/src/server/runLease.js");
  let checked = null;
  const f = await gardenHome(context, async () => {
    // Waits, renewing, until the lease it was first given has run out by the database's clock.
    const { rows: [first] } = await f.kit.knex.raw("select claimed_until from rooms_memory_queue where bot_id = ?", [f.chef]);
    let renewedTo = first.claimed_until;
    let landed = true;
    const deadline = Date.now() + 15000;
    for (;;) {
      if (landed) {
        await clock.advance(lease.heartbeatMs);
        landed = false;
      }
      const { rows: [now] } = await f.kit.knex.raw("select now() > ?::timestamptz as past, claimed_until > now() as held, claimed_until from rooms_memory_queue where bot_id = ?", [first.claimed_until, f.chef]);
      if (now.past) {
        checked = { held: now.held, other: await f.kit.records.roomsMemory.claim("another server", 60, { context: f.kit.systemContext("memory refresh test") }) };
        break;
      }
      // A renewal moves the lease's end on: the next beat comes once it has.
      if (now.claimed_until > renewedTo) [renewedTo, landed] = [now.claimed_until, true];
      assert.ok(Date.now() < deadline, "the first lease ends within the test's time");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return "## Garden\n- slow";
  }, { lease });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text: "Tomatoes on the fourteenth", authorName: "Anna" } });
  await f.due();
  assert.equal(await f.kit.roomsMemory.runner.runOne(), true);
  assert.equal(checked.held, true, "the lease was renewed past its first end");
  assert.equal(checked.other, null, "and no other server could claim the refresh");
  assert.equal((await f.digest()).text, "## Garden\n- slow", "the slow write is saved");
});

test("a refresh that fails is tried again later, waiting longer each time", async (context) => {
  let tries = 0;
  const f = await gardenHome(context, async () => {
    tries += 1;
    throw new Error(`The model is down (${tries})`);
  });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text: "Tomatoes on the fourteenth", authorName: "Anna" } });
  await f.due();
  const waits = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(await f.kit.roomsMemory.runner.runOne(), true);
    const failed = await f.row();
    assert.equal(failed.attempts, attempt);
    assert.equal(failed.claimed_by, null, "its lease is given up");
    assert.equal(failed.last_error, `The model is down (${attempt})`);
    waits.push(Math.round(await f.dueIn()));
    await f.kit.knex("rooms_memory_queue").where({ bot_id: f.chef }).update({ due_at: f.kit.knex.fn.now() });
  }
  assert.deepEqual(waits, [1, 2, 4], "1, 2, then 4 minutes");
  assert.equal(await f.digest(), undefined, "no digest is written by a failed refresh");
});

test("forgetting costs the same for one bot as for many", async (context) => {
  const f = await gardenHome(context, async () => "## Garden");
  const [shopper, ...many] = await botsOf(f.kit, f.homeId, f.anna, ["Shopper", "Cleaner", "Gardener", "Tutor", "Planner", "Driver", "Banker", "Cook"]);
  const forgetting = (botIds) => queriesDuring(f.kit.knex, () => f.kit.roomsMemory.forget({ botIds }, f.kit.as(f.anna, f.homeId)));
  // The first forgetting of a run also loads what the records read once (their resources' columns), so it isn't counted.
  await forgetting([f.chef]);
  const one = await forgetting([shopper]);
  const seven = await forgetting(many);
  assert.equal(seven, one, `${one} statements for one bot, ${seven} for seven`);
  const all = [f.chef, shopper, ...many];
  const rows = await f.kit.knex("rooms_memory_queue").whereIn("bot_id", all);
  assert.equal(rows.length, 9);
  assert.ok(rows.every((row) => row.rebuild), "each is made again from the chats");
  assert.equal((await f.kit.knex("rooms_memories").whereIn("bot_id", all).where({ text: "" })).length, 9, "and emptied at once");
});

test("an archived bot keeps what it remembers, and remembers nothing new until it's back", async (context) => {
  let writes = 0;
  const f = await gardenHome(context, async () => {
    writes += 1;
    return "## Garden\n- remembered";
  });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.anna, body: { text: "Tomatoes on the fourteenth", authorName: "Anna" } });
  await f.due();
  assert.equal(await f.kit.roomsMemory.runner.runOne(), true);
  assert.equal(writes, 1);
  await f.kit.knex("bots").where({ id: f.chef }).update({ archived_at: f.kit.knex.fn.now() });
  await seedMessage(f.kit.knex, { homeId: f.homeId, chatId: f.garden.id, userId: f.ben, body: { text: "Ben bought the stakes", authorName: "Ben" } });
  await f.due();
  assert.equal(await f.kit.roomsMemory.runner.runOne(), true, "its refresh is taken");
  assert.equal(writes, 1, "and nothing is written");
  assert.equal(await f.row(), undefined, "nor asked again");
  assert.equal((await f.digest()).text, "## Garden\n- remembered", "what it remembered is kept");
});
