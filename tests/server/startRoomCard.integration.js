import assert from "node:assert/strict";
import test from "node:test";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { memberOptions } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";

// A bot's start_room (D-122): a room with the home's bots and people, proposed on a card for the person the bot works
// for, made only on their yes, as them, with exactly the card's members and the bot's brief as its first message after
// the start line; the card then names the room to open. Nobody else answers it, "Don't do it" makes nothing, a bot or a
// person outside the home is refused, and the brief (this private chat's words) is nowhere but on the card until the
// yes. The state note names the home's Builder. A stand-in for the model; no provider.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("start_room asks on a card, makes the room with exactly its members and brief on the yes, and nothing otherwise", async (context) => {
  // What each turn's stand-in model calls, what the tools answered, and each turn's state note.
  let calls = [];
  const answers = [];
  const states = [];
  // Which bot each turn was, and its prompt.
  const turns = [];
  const home = { builder: null };
  const kit = await startChatTurns(context, {
    apps: { apps: { builder: async () => home.builder } },
    reply: async (bot, _history, tools, state, prompt) => {
      states.push(state);
      turns.push({ bot: bot.name, prompt });
      for (const [tool, input] of calls) answers.push(tools[tool] ? await tools[tool].execute(input) : { missing: tool });
      calls = [];
      return { text: "Asked.", transcript: [] };
    }
  });
  const { homeId, people: [anna, ben, cleo] } = await homeOfPeople(kit, ["Anna", "Ben", "Cleo"]);
  const { people: [zed] } = await homeOfPeople(kit, ["Zed"]);
  const [whiskers, mercbot, retired] = await botsOf(kit, homeId, anna, ["Whiskers", "Mercbot", "Retired"]);
  await kit.knex("bots").where({ id: retired }).update({ archived_at: new Date() });
  const plans = await seedChat(kit.knex, { homeId, kind: "private", title: "Plans", people: [anna, ben], bots: [whiskers] });
  const as = (person) => memberOptions({ userId: person, homeId });
  /** Anna asks Whiskers in Plans, whose turn calls `tools`; the newest card there. */
  const ask = async (tools) => {
    calls = tools;
    const sent = await kit.turns.chat.sendMessage(plans.id, { text: "Whiskers?" }, as(anna));
    await kit.turns.chat.reply(plans.id, { afterMessageId: sent.messages.at(-1).id }, undefined, as(anna));
    await kit.drain();
    return kit.knex("messages").where({ conversation_id: plans.id, kind: "choice" }).orderBy("id", "desc").first();
  };
  const rooms = () => kit.knex("conversations").where({ workspace_id: homeId }).whereNot({ id: plans.id }).orderBy("id");
  const brief = "Mercbot, please build a database of Anna's cats: Tom is 3 and sees the vet in May.";

  // With no Builder set, the state note says so; then it names the Builder, and the Builder hears it's itself.
  await ask([]);
  assert.match(states.at(-1), /^- This home has no Builder set: .*Settings, under Main bot and Builder\.$/mu);
  home.builder = { id: mercbot, name: "Mercbot", color: "#1E86FC" };
  await ask([]);
  assert.match(states.at(-1), /^- This home's Builder: Mercbot\.$/mu);

  // Names outside the home, or an archived bot, are the model's to fix: no card.
  const newestCard = async () => (await kit.knex("messages").where({ conversation_id: plans.id, kind: "choice" }).orderBy("id", "desc").first())?.id ?? null;
  const noCard = await newestCard();
  await ask([["startRoom", { title: "Cats", bots: ["Nobody"], brief }]]);
  assert.match(answers.at(-1).error, /no bot called "Nobody"/u);
  await ask([["startRoom", { title: "Cats", bots: ["Retired"], brief }]]);
  assert.match(answers.at(-1).error, /Retired is archived/u);
  await ask([["startRoom", { title: "Cats", bots: ["Mercbot"], people: ["Zed"], brief }]]);
  assert.match(answers.at(-1).error, /Nobody called "Zed" is in this home/u);
  assert.equal(await newestCard(), noCard);
  assert.ok(zed, "Zed is someone of another home");

  // A card for Anna: private by default, Whiskers and Anna always in it, and nothing made yet.
  const card = await ask([["startRoom", { title: "Cats database", bots: ["mercbot"], people: ["Cleo"], brief }]]);
  const addressed = `@${brief}`;
  assert.equal(answers.at(-1).status, "waiting_for_approval");
  assert.equal(card.body.for.id, anna);
  assert.equal(card.body.action.id, "start_room");
  assert.deepEqual(card.body.action.args, {
    title: "Cats database",
    kind: "private",
    bots: [{ id: whiskers, name: "Whiskers" }, { id: mercbot, name: "Mercbot" }],
    people: [{ id: anna, name: "Anna" }, { id: cleo, name: "Cleo" }],
    // The brief is for the Builder, which it @-mentions: "Mercbot, …" reads "@Mercbot, …".
    brief: addressed,
    to: mercbot
  });
  assert.equal(card.body.question, "Start the private room \"Cats database\" with you, Cleo, Whiskers and Mercbot?");
  assert.deepEqual(await rooms(), [], "nothing is made until the yes");
  // The brief carries this private chat's words: until the yes, it's only on the card Anna sees.
  const holding = await kit.knex("messages").whereRaw("body::text like ?", ["%Tom is 3%"]).select("conversation_id", "kind");
  assert.deepEqual(holding.map((row) => [String(row.conversation_id), row.kind]), [[plans.id, "choice"]]);

  // Ben is in the chat, but the card is Anna's.
  await assert.rejects(kit.turns.chat.answerChoice(plans.id, String(card.id), ["Go ahead"], as(ben)), { statusCode: 403, code: "bots_waiting_for_other" });
  assert.deepEqual(await rooms(), []);

  // Anna's yes: the room, its people and bots exactly the card's, the start line by Anna, then Whiskers' brief, then
  // the Builder's own answer to it, once, with no word from Anna and none from Whiskers.
  const before = turns.length;
  const answered = await kit.turns.chat.answerChoice(plans.id, String(card.id), ["Go ahead"], as(anna));
  await kit.drain();
  const [room] = await rooms();
  assert.deepEqual([room.kind, room.title, String(room.made_by)], ["private", "Cats database", anna]);
  const seated = await kit.knex("chat_people").where({ conversation_id: room.id }).pluck("user_id");
  assert.deepEqual(seated.map(String).sort(), [anna, cleo].sort());
  const bots = await kit.knex("chat_bots").where({ conversation_id: room.id }).pluck("bot_id");
  assert.deepEqual(bots.map(String).sort(), [whiskers, mercbot].sort());
  const lines = await kit.knex("messages").where({ conversation_id: room.id }).orderBy("id");
  const briefText = brief.replace(/^Mercbot/u, `<@bot:${mercbot}>`);
  assert.deepEqual(lines.map((line) => [line.kind, line.role, line.body.text]), [
    ["event", "user", "Anna started this room."],
    ["text", "bot", briefText],
    ["text", "bot", "Asked."]
  ]);
  assert.deepEqual(lines.slice(1).map((line) => String(line.author_bot_id)), [whiskers, mercbot]);
  assert.deepEqual(lines[1].body.mentions, [{ id: mercbot, name: "Mercbot" }]);
  assert.equal(lines[2].body.answersBot, whiskers, "a reply to Whiskers' brief, which counts toward the bots' limit");
  assert.deepEqual(turns.slice(before).map((turn) => turn.bot), ["Mercbot"], "one turn, the Builder's; none from Whiskers");
  assert.match(turns.at(-1).prompt, /^\(Whiskers started this room with the person, and its brief above is for you/u);
  // The card names the room, and the chat hears it was started.
  assert.deepEqual(answered.messages[0].body.done, { chatId: String(room.id) });
  const said = await kit.knex("messages").where({ conversation_id: plans.id, kind: "event" }).orderBy("id", "desc").first();
  assert.deepEqual([said.body.text, said.body.name], ["Started the room", "Cats database"]);

  // "Don't do it" makes nothing.
  const declined = await ask([["startRoom", { title: "Dogs", kind: "public", bots: ["Mercbot"], brief: "Dogs, please." }]]);
  assert.equal(declined.body.question, "Start the public room \"Dogs\" with you, Whiskers and Mercbot?");
  await kit.turns.chat.answerChoice(plans.id, String(declined.id), ["Don't do it"], as(anna));
  assert.equal((await rooms()).length, 1);

  // A bot archived, or a person who left the home, since the card: said on the yes, and nothing is made.
  const later = await ask([["startRoom", { title: "Later", bots: ["Mercbot"], people: ["Ben"], brief: "Later, please." }]]);
  await kit.knex("bots").where({ id: mercbot }).update({ archived_at: new Date() });
  await kit.turns.chat.answerChoice(plans.id, String(later.id), ["Go ahead"], as(anna));
  let refused = await kit.knex("messages").where({ conversation_id: plans.id, kind: "event" }).orderBy("id", "desc").first();
  assert.deepEqual([refused.body.text, refused.body.detail], ["The room wasn't started", "Mercbot is archived. Unarchive it to continue. The room wasn't started."]);
  await kit.knex("bots").where({ id: mercbot }).update({ archived_at: null });
  const gone = await ask([["startRoom", { title: "Gone", people: ["Cleo"], brief: "Gone, please." }]]);
  await kit.knex("workspace_memberships").where({ workspace_id: homeId, user_id: cleo }).del();
  await kit.turns.chat.answerChoice(plans.id, String(gone.id), ["Go ahead"], as(anna));
  refused = await kit.knex("messages").where({ conversation_id: plans.id, kind: "event" }).orderBy("id", "desc").first();
  assert.deepEqual([refused.body.text, refused.body.detail], ["The room wasn't started", "Someone on the card isn't in this home any more. The room wasn't started."]);
  assert.equal((await rooms()).length, 1);
});
