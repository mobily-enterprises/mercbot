import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { seedChat, seedMessages } from "../support/chatFixtures.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// Rooms, People and Bots, against the disposable test database, each test in a home of its own: a room is named and
// starts with its maker and their start line, which no bot answers or judges; writing in a public room joins it, a
// private one stays its people's; bots are invited into a public room by anyone in the home and into a private one by
// its people, never into a direct chat; a public room's news reaches everyone in the home; the public rooms a person
// isn't in come a page at a time; a person's chat with another person is private, made once, and takes nobody else;
// and the reads don't grow with the rooms or their messages.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];

/**
 * A home of Pat (its owner), Kim and Lee, with Pat's bots Ada and Bo; the turns, whose replies are counted, a model
 * that counts every call made to it, and every event sent to open pages (`news`, with who heard each).
 */
async function setup(context) {
  const calls = { model: 0, replies: 0 };
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls.model += 1;
      return { content: [{ type: "text", text: "{\"bot\": null}" }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };
    }
  });
  const news = [];
  const kit = await startChatTurns(context, {
    model,
    notices: { publishEach: async (_topic, people, event) => news.push({ ...event, people: [...people].map(String).sort((a, b) => a - b) }) },
    reply: async (bot) => {
      calls.replies += 1;
      return { text: `${bot.name} here.`, transcript: [] };
    }
  });
  const { homeId, people: [pat, kim, lee] } = await homeOfPeople(kit, ["Pat", "Kim", "Lee"]);
  const [ada, bo] = await botsOf(kit, homeId, pat, ["Ada", "Bo"]);
  const owner = memberOptions({ userId: pat, homeId, role: "owner", permissions: MANAGE });
  const as = (person) => (person === pat ? owner : kit.as(person, homeId));
  const everyone = [pat, kim, lee].sort((a, b) => a - b);
  return { kit, calls, news, homeId, pat, kim, lee, ada, bo, as, everyone };
}

const peopleOf = (chat) => chat.people.map((person) => person.userId).sort((a, b) => a - b);

test("a room needs a name and starts with its maker and their start line, which no bot answers or judges", async (context) => {
  const { kit, calls, news, pat, kim, lee, ada, as, everyone } = await setup(context);

  for (const title of [undefined, "", "   "]) {
    await assert.rejects(kit.chats.create({ title, bots: [ada] }, as(pat)), { statusCode: 400, code: "bots_chat_needs_title", message: "Give the room a name." });
  }
  assert.equal(Number((await kit.knex("conversations").where({ made_by: pat }).count("id as n").first()).n), 0, "nothing made");

  // A private room of its maker alone is a room too.
  const { chat: plans } = await kit.chats.create({ kind: "private", title: " Plans " }, as(pat));
  assert.equal(plans.kind, "private");
  assert.equal(plans.title, "Plans");
  assert.deepEqual(peopleOf(plans), [pat]);
  assert.deepEqual(news.pop(), { type: "chat", chatId: plans.id, change: "created", people: [pat] }, "a private room's people hear");

  // A public room with Kim and Ada: its start line is Pat's, one event line, and everyone in the home hears.
  const { chat: garden } = await kit.chats.create({ title: "Garden", people: [kim], bots: [ada] }, as(pat));
  assert.deepEqual(news.pop(), { type: "chat", chatId: garden.id, change: "created", people: everyone }, "Lee hears too: it's public");
  const lines = await kit.knex("messages").where({ conversation_id: garden.id }).orderBy("id");
  assert.equal(lines.length, 1);
  assert.deepEqual(
    { kind: lines[0].kind, role: lines[0].role, author: String(lines[0].author_user_id), event: lines[0].body.event, text: lines[0].body.text },
    { kind: "event", role: "user", author: pat, event: "room_started", text: "Pat started this room." }
  );
  assert.equal((await kit.chats.get(garden.id, as(lee))).chat.place, null, "Lee isn't in it");

  // A new room starts with its bots joining in when useful (D-129); asked for a reply, no bot answers the start line,
  // and the model isn't called.
  assert.equal(garden.botsJoinIn, true);
  const answer = await kit.turns.chat.reply(garden.id, {}, undefined, as(pat));
  await kit.drain();
  assert.deepEqual(answer.messages ?? [], []);
  assert.deepEqual(calls, { model: 0, replies: 0 });
});

test("writing in a public room joins it; a private room stays its people's; leaving keeps a public room and empties a private one", async (context) => {
  const { kit, news, homeId, pat, kim, lee, as } = await setup(context);
  const { chat: garden } = await kit.chats.create({ title: "Garden" }, as(pat));
  const { chat: plans } = await kit.chats.create({ kind: "private", title: "Plans", people: [kim] }, as(pat));

  // Lee writes in Garden without joining: seated by the message itself, named on it, and everyone in it hears.
  news.length = 0;
  const sent = await kit.turns.chat.sendMessage(garden.id, { text: "Tomatoes?" }, as(lee));
  assert.equal(sent.messages.at(-1).authorUserId, lee);
  assert.equal(sent.messages.at(-1).body.authorName, "Lee");
  assert.deepEqual(peopleOf(sent.chat), [pat, lee].sort((a, b) => a - b));
  assert.ok(sent.chat.place, "Lee has a place in it now");
  assert.ok(news.some((event) => event.type === "chat" && event.change === "members" && event.people.includes(lee)));
  await kit.turns.chat.sendMessage(garden.id, { text: "And beans." }, as(lee));
  assert.equal(Number((await kit.knex("chat_people").where({ conversation_id: garden.id, user_id: lee }).count("id as n").first()).n), 1, "seated once");

  // A private room Lee isn't in: as if it weren't there.
  await assert.rejects(kit.turns.chat.sendMessage(plans.id, { text: "Hi" }, as(lee)), { statusCode: 404 });

  // Everyone leaves Garden: it stays, for everyone in the home to open and list. The last of Plans deletes it.
  await kit.chats.leave(garden.id, as(lee));
  await kit.chats.leave(garden.id, as(pat));
  assert.ok((await kit.chats.get(garden.id, as(kim))).chat, "an empty public room stays");
  assert.ok((await kit.chats.publicRooms({}, as(pat))).chats.some((chat) => chat.id === garden.id), "and is listed for its maker too");
  assert.equal((await kit.chats.rename(garden.id, "Garden 2", as(pat))).chat.title, "Garden 2", "its maker still manages it");
  await kit.chats.leave(plans.id, as(kim));
  assert.deepEqual(await kit.chats.leave(plans.id, as(pat)), { deleted: true });
  assert.equal(await kit.knex("conversations").where({ id: plans.id, workspace_id: homeId }).first("id"), undefined);
});

test("bots are invited into a public room by anyone in the home, into a private one by its people, never into a direct chat", async (context) => {
  const { kit, pat, kim, lee, ada, bo, as } = await setup(context);
  const { chat: garden } = await kit.chats.create({ title: "Garden", bots: [ada] }, as(pat));
  const botsIn = (chat) => chat.bots.map((bot) => bot.botId);

  // Lee isn't in Garden, nor its maker or an admin: he still invites Bo and takes Ada out.
  assert.deepEqual(botsIn((await kit.chats.addBot(garden.id, bo, as(lee))).chat), [ada, bo]);
  assert.deepEqual(botsIn((await kit.chats.removeBot(garden.id, ada, as(lee))).chat), [bo]);

  // Plans is Pat's and Kim's: Lee can't open it; either of its people invites and takes out.
  const { chat: plans } = await kit.chats.create({ kind: "private", title: "Plans", people: [kim] }, as(pat));
  await assert.rejects(kit.chats.addBot(plans.id, ada, as(lee)), { statusCode: 404 });
  assert.deepEqual(botsIn((await kit.chats.addBot(plans.id, ada, as(pat))).chat), [ada]);
  assert.deepEqual(botsIn((await kit.chats.removeBot(plans.id, ada, as(kim))).chat), [], "Kim, not its maker, takes Ada out");

  // A direct chat takes no other bot, and none is taken out of it.
  const { chat: withAda } = await kit.chats.direct(ada, as(pat));
  await assert.rejects(kit.chats.addBot(withAda.id, bo, as(pat)), { statusCode: 409, code: "bots_chat_direct" });
  await assert.rejects(kit.chats.removeBot(withAda.id, ada, as(pat)), { statusCode: 409, code: "bots_chat_direct" });
});

test("a public room's news reaches everyone in the home; a private room's only its people", async (context) => {
  const { kit, news, pat, kim, as, everyone } = await setup(context);
  const { chat: garden } = await kit.chats.create({ title: "Garden" }, as(pat));
  const { chat: plans } = await kit.chats.create({ kind: "private", title: "Plans", people: [kim] }, as(pat));
  const heard = (chatId, change) => news.filter((event) => event.chatId === chatId && event.change === change).map((event) => event.people);

  await kit.chats.rename(garden.id, "Garden 2", as(pat));
  await kit.chats.archive(garden.id, as(pat));
  await kit.chats.unarchive(garden.id, as(pat));
  await kit.chats.rename(plans.id, "Plans 2", as(pat));
  for (const change of ["created", "renamed", "archived", "unarchived"]) assert.deepEqual(heard(garden.id, change), [everyone], change);
  assert.deepEqual(heard(plans.id, "renamed"), [[pat, kim].sort((a, b) => a - b)]);
  assert.deepEqual(await kit.chats.remove(garden.id, as(pat)), { deleted: true });
  assert.deepEqual(heard(garden.id, "deleted"), [everyone]);
});

test("the public rooms a person isn't in come newest first, a page at a time, without direct, private or archived chats", async (context) => {
  const { kit, pat, kim, lee, ada, as } = await setup(context);
  const made = [];
  for (const title of ["One", "Two", "Three"]) made.push((await kit.chats.create({ title }, as(pat))).chat.id);
  const { chat: joined } = await kit.chats.create({ title: "Joined" }, as(lee));
  await kit.chats.create({ kind: "private", title: "Secret" }, as(pat));
  const { chat: shelved } = await kit.chats.create({ title: "Shelved" }, as(pat));
  await kit.chats.archive(shelved.id, as(pat));
  await kit.chats.direct(ada, as(pat));
  await kit.chats.personDirect(kim, as(pat));

  const page = await kit.chats.publicRooms({}, as(lee));
  assert.deepEqual(page.chats.map((chat) => chat.id), [...made].reverse(), "Lee's own room, the private, archived and direct chats aren't in it");
  assert.equal(page.next, null);
  assert.ok(page.chats.every((chat) => chat.place === null && chat.directPerson === null && chat.directBotId === null));
  assert.ok(!(await kit.chats.publicRooms({}, as(lee))).chats.some((chat) => chat.id === joined.id));
});

test("a person's chat with another person is private, made once for the pair in each home, and takes nobody else", async (context) => {
  const { kit, news, homeId, pat, kim, lee, ada, as } = await setup(context);

  await assert.rejects(kit.chats.personDirect(pat, as(pat)), { statusCode: 400, code: "bots_direct_self", message: "That's you." });
  const elsewhere = await homeOfPeople(kit, ["Stranger"]);
  for (const someone of [elsewhere.people[0], "999999999", "nobody"]) {
    await assert.rejects(kit.chats.personDirect(someone, as(pat)), { statusCode: 404, code: "bots_person_not_found" });
  }

  // Pat and Kim open it at once: one chat, theirs alone, each seeing the other.
  news.length = 0;
  const [fromPat, fromKim] = await Promise.all([kit.chats.personDirect(kim, as(pat)), kit.chats.personDirect(pat, as(kim))]);
  assert.equal(fromPat.chat.id, fromKim.chat.id);
  assert.equal((await kit.chats.personDirect(kim, as(pat))).chat.id, fromPat.chat.id, "and again later");
  const chat = fromPat.chat;
  assert.equal(chat.kind, "private");
  assert.equal(chat.title, null);
  assert.deepEqual(peopleOf(chat), [pat, kim].sort((a, b) => a - b));
  assert.deepEqual(chat.bots, []);
  assert.deepEqual(chat.directPerson, { userId: kim, name: "Kim" });
  assert.deepEqual(fromKim.chat.directPerson, { userId: pat, name: "Pat" });
  assert.equal(chat.directBotId, null);
  assert.ok(news.some((event) => event.chatId === chat.id && event.people.includes(kim) && event.people.includes(pat)), "both hear of it");
  assert.equal(Number((await kit.knex("conversations").where({ workspace_id: homeId }).whereNotNull("direct_person_id").count("id as n").first()).n), 1);
  // Made by one of them, both are in it at once: Pat opens a chat with Lee, who hasn't opened it.
  assert.deepEqual(peopleOf((await kit.chats.personDirect(lee, as(pat))).chat), [pat, lee].sort((a, b) => a - b));

  // Lee can't open it; nobody is added to it, nor is it renamed, Kim (who didn't open it first) included.
  await assert.rejects(kit.chats.get(chat.id, as(lee)), { statusCode: 404 });
  const nobodyElse = { statusCode: 409, code: "bots_chat_direct", message: "A private chat between two people takes nobody else." };
  await assert.rejects(kit.chats.addPerson(chat.id, lee, as(pat)), nobodyElse);
  await assert.rejects(kit.chats.addBot(chat.id, ada, as(kim)), nobodyElse);
  await assert.rejects(kit.chats.rename(chat.id, "Us", as(kim)), nobodyElse);
  await assert.rejects(kit.chats.change(chat.id, { title: "Us" }, as(pat)), nobodyElse);
  // Nor does either take the other out, Pat (who opened it first) included: only leaving is theirs.
  await assert.rejects(kit.chats.removePerson(chat.id, kim, as(pat)), nobodyElse);
  await assert.rejects(kit.chats.removePerson(chat.id, pat, as(kim)), nobodyElse);

  // In another home they share, the pair has a chat of its own there.
  const [other] = await kit.knex("workspaces").insert({ slug: `rooms-${Date.now().toString(36)}`, name: "Other", owner_user_id: pat, is_personal: false }).returning("id");
  kit.cleanup.after(() => kit.knex("workspaces").where({ id: other.id }).del());
  await kit.knex("workspace_memberships").insert([pat, kim].map((userId) => ({ workspace_id: other.id, user_id: userId, role_sid: "member", status: "active" })));
  const there = await kit.chats.personDirect(kim, memberOptions({ userId: pat, homeId: String(other.id) }));
  assert.notEqual(there.chat.id, chat.id);

  // Kim leaves: Pat keeps it, and opening it again doesn't bring Kim back; Kim's own opening does. Both gone, it's gone.
  await kit.chats.leave(chat.id, as(kim));
  assert.deepEqual(peopleOf((await kit.chats.personDirect(kim, as(pat))).chat), [pat]);
  assert.deepEqual(peopleOf((await kit.chats.personDirect(pat, as(kim))).chat), [pat, kim].sort((a, b) => a - b));
  await kit.chats.leave(chat.id, as(kim));
  assert.deepEqual(await kit.chats.leave(chat.id, as(pat)), { deleted: true });
});

test("the public rooms' page, a bot's invitation and a first message cost the same at small and realistic sizes", async (context) => {
  const { kit, homeId, pat, lee, ada, as } = await setup(context);
  const count = (work) => queriesDuring(kit.knex, work);

  // The public rooms Lee isn't in: 3, then 300 (three pages of 100).
  const rooms = async (n) => {
    const rows = Array.from({ length: n }, (_, index) => ({ workspace_id: homeId, kind: "public", title: `Room ${index}`, made_by: pat }));
    for (let start = 0; start < rows.length; start += 100) await kit.knex("conversations").insert(rows.slice(start, start + 100));
  };
  await rooms(3);
  const few = await count(() => kit.chats.publicRooms({}, as(lee)));
  await rooms(297);
  let page = null;
  const many = await count(async () => { page = await kit.chats.publicRooms({}, as(lee)); });
  assert.equal(page.chats.length, 100);
  assert.equal(many, few, `the first page of 300 rooms: ${many} statements, against ${few} for 3`);
  const seen = new Set(page.chats.map((chat) => chat.id));
  let pages = 1;
  for (; page.next && pages < 10; pages += 1) {
    assert.equal(page.next, page.chats.at(-1).id, "a page's next is its last room's id");
    page = await kit.chats.publicRooms({ after: page.next }, as(lee));
    for (const chat of page.chats) seen.add(chat.id);
  }
  assert.deepEqual([seen.size, pages, page.next], [300, 3, null], "every room once, in three pages");

  // A page costs the same whatever the person's own history: in 3 chats of the home, then in 3,000, the first page
  // sends the same statements with the same number of values, and leaves out every room the person has a place in.
  const sent = async (work) => {
    let values = 0;
    const counted = (query) => { values += (query.bindings || []).length; };
    kit.knex.on("query", counted);
    try {
      return { statements: await count(work), values };
    } finally {
      kit.knex.removeListener("query", counted);
    }
  };
  const seat = async (n) => {
    const made = Array.from({ length: n }, (_, index) => ({ workspace_id: homeId, kind: "private", title: `Lee's ${index}`, made_by: lee }));
    for (let start = 0; start < made.length; start += 500) {
      const ids = await kit.knex("conversations").insert(made.slice(start, start + 500)).returning("id");
      await kit.knex("chat_people").insert(ids.map(({ id }) => ({ conversation_id: id, workspace_id: homeId, user_id: lee })));
    }
  };
  const joined = [...seen].slice(0, 2);
  await kit.knex("chat_people").insert(joined.map((id) => ({ conversation_id: id, workspace_id: homeId, user_id: lee })));
  await seat(1);
  const short = await sent(() => kit.chats.publicRooms({}, as(lee)));
  await seat(2997);
  let opened = null;
  const long = await sent(async () => { opened = await kit.chats.publicRooms({}, as(lee)); });
  assert.deepEqual(long, short, `a page for someone in 3,000 chats: ${JSON.stringify(long)}, against ${JSON.stringify(short)} in 3`);
  assert.equal(opened.chats.length, 100);
  assert.ok(!opened.chats.some((chat) => joined.includes(chat.id)), "a room the person is in isn't offered");

  // A bot invited into a room of 5 messages and of 30 (it reads them all), and of 31 and of 3,000 (it reads the last 30,
  // with its joined line).
  const roomWith = async (n) => {
    const { id } = await seedChat(kit.knex, { homeId, title: `With ${n}`, people: [pat], madeBy: pat });
    for (let start = 0; start < n; start += 500) {
      await seedMessages(kit.knex, { homeId, chatId: id, rows: Array.from({ length: Math.min(500, n - start) }, (_, index) => ({ userId: pat, body: { text: `m${start + index}` } })) });
    }
    return id;
  };
  const [small, whole, past, large] = [await roomWith(5), await roomWith(30), await roomWith(31), await roomWith(3000)];
  const invite = (chatId) => count(() => kit.chats.addBot(chatId, ada, as(pat)));
  // A process's first seat reads the table's unique keys once (the insert that skips a bot already there).
  await invite(await roomWith(2));
  const [intoSmall, intoWhole, intoPast, intoLarge] = [await invite(small), await invite(whole), await invite(past), await invite(large)];
  assert.equal(intoWhole, intoSmall, `inviting into 30 messages: ${intoWhole}, against ${intoSmall} into 5`);
  assert.equal(intoLarge, intoPast, `inviting into 3,000 messages: ${intoLarge}, against ${intoPast} into 31`);

  // A first message by someone not in the room, in a room of 5 messages and of 3,000.
  // Each counted with the background work it starts (the bots' memory hears of a public room's words), after a first
  // one that warms the process.
  const first = (chatId) => count(async () => {
    await kit.turns.chat.sendMessage(chatId, { text: "hello" }, as(lee));
    await kit.drain();
  });
  await first(whole);
  const firstSmall = await first(small);
  const firstLarge = await first(large);
  assert.equal(firstLarge, firstSmall, `a first message in 3,000: ${firstLarge}, against ${firstSmall} in 5`);
});
