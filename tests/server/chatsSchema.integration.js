import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { seedChat, seedMessage } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// D-112's migration (20261122120000_chats_core.cjs) on the migrated test database: the old chat tables and bot modes
// are gone, chats and their members keep their rules in the database itself, and readable_from(chat) is D12's one
// reading rule. Each test makes its own home, so it runs beside any other file.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

// One connection pool for the file, closed after every test's own cleanup has run.
const knex = await connectTestDatabase();
after(() => knex.destroy());

/** A home of its own with the three test people in it, and a bot; removed when the test ends. */
async function home(knex, context, name) {
  const people = (await knex("users").orderBy("id").limit(3).pluck("id")).map(String);
  assert.equal(people.length, 3, "the test database needs three users");
  const [row] = await knex("workspaces").insert({ slug: `${name}-${randomBytes(5).toString("hex")}`, name, owner_user_id: people[0], is_personal: false }).returning("id");
  const homeId = String(row.id);
  await knex("workspace_memberships").insert(people.map((id, index) => ({ workspace_id: homeId, user_id: id, role_sid: index ? "member" : "owner", status: "active" })));
  const [bot] = await knex("bots").insert({ workspace_id: homeId, made_by: people[0], name: "Chef", color: "#1E86FC" }).returning("id");
  context.after(async () => {
    await knex("workspaces").where({ id: homeId }).del();
  });
  return { homeId, people, botId: String(bot.id) };
}

/** The error a statement fails with, for its constraint's name. */
async function refused(statement) {
  try {
    await statement;
  } catch (error) {
    return error.constraint || error.code || error.message;
  }
  assert.fail("the statement was accepted");
}

test("the old chat tables and the bots' modes are gone, and bots name who made them", async () => {
  const tables = new Set(await knex("information_schema.tables").where({ table_schema: "public" }).pluck("table_name"));
  for (const gone of ["bot_conversations", "bot_messages", "bot_group_members", "bot_group_people", "conversation_reads", "bot_sections",
    "bot_notebook", "person_memories", "home_settings", "bots_before_templates"]) {
    assert.equal(tables.has(gone), false, `${gone} is gone`);
  }
  for (const made of ["conversations", "chat_people", "chat_bots", "messages", "conversation_sections"]) assert.ok(tables.has(made), `${made} exists`);
  const columns = async (table) => new Set(await knex("information_schema.columns").where({ table_schema: "public", table_name: table }).pluck("column_name"));
  const bots = await columns("bots");
  for (const gone of ["kind", "sharing", "label", "instructions", "skills", "origin", "user_id"]) assert.equal(bots.has(gone), false, `bots.${gone} is gone`);
  assert.ok(bots.has("made_by"));
  assert.deepEqual([...await columns("bot_routines")].filter((name) => ["bot_id", "conversation_id", "chat_bot_id", "made_by"].includes(name)).sort(), ["chat_bot_id", "made_by"]);
  assert.ok((await columns("vault_items")).has("workspace_id"), "the vault is the home's");
  assert.equal((await columns("vault_items")).has("user_id"), false);
  assert.equal((await columns("plugin_actions_off")).has("user_id"), false, "the actions a home turned off are the home's");
  assert.equal((await columns("connect_follow_ups")).has("personal"), false, "a chat's sign-ins are the chat's (D14): no personal reach");
});

test("a chat keeps its rules in the database: kinds, the everyone chat, direct chats, members in its home, authors", async (context) => {
  const { homeId, people: [anna, ben], botId } = await home(knex, context, "schema-rules");
  const chat = (columns) => knex("conversations").insert({ workspace_id: homeId, kind: "public", ...columns });

  assert.equal(await refused(chat({ kind: "group" })), "conversations_kind_check");
  assert.equal(await refused(chat({ kind: "private", everyone: true })), "conversations_everyone_check");
  assert.equal(await refused(chat({ direct_user_id: anna })), "conversations_direct_check", "a direct chat names its person and its bot");
  assert.equal(await refused(chat({ direct_user_id: anna, direct_bot_id: botId, title: "Hi" })), "conversations_direct_title_check");
  assert.equal(await refused(chat({ kind: "private", app_id: "app1" })), "conversations_app_check");
  // A direct chat is Public by default (D15), one per person and bot.
  const direct = await seedChat(knex, { homeId, direct: { userId: anna, botId } });
  assert.equal((await knex("conversations").where({ id: direct.id }).first("kind")).kind, "public");
  assert.equal(await refused(chat({ direct_user_id: anna, direct_bot_id: botId })), "ux_conversations_direct");
  await chat({ everyone: true, title: "Family" });
  assert.equal(await refused(chat({ everyone: true, title: "Again" })), "ux_conversations_everyone");

  // Members belong to the chat's home: a row naming another home is refused by the chat's own key.
  const [other] = await knex("workspaces").insert({ slug: `schema-other-${randomBytes(5).toString("hex")}`, name: "Other", owner_user_id: anna, is_personal: false }).returning("id");
  context.after(() => knex("workspaces").where({ id: other.id }).del());
  assert.equal(await refused(knex("chat_people").insert({ conversation_id: direct.id, workspace_id: other.id, user_id: ben })), "chat_people_conversation_foreign");
  assert.equal(await refused(knex("chat_bots").insert({ conversation_id: direct.id, workspace_id: homeId, bot_id: botId, position: 1 })), "chat_bots_bot_unique");
  assert.equal(await refused(knex("chat_people").insert({ conversation_id: direct.id, workspace_id: homeId, user_id: anna })), "chat_people_person_unique");

  // A message's author matches its role, and a change stamps it for catch-up.
  const said = (columns) => knex("messages").insert({ conversation_id: direct.id, workspace_id: homeId, kind: "text", body: {}, ...columns });
  assert.equal(await refused(said({ role: "user", author_bot_id: botId })), "messages_author_check");
  assert.equal(await refused(said({ role: "system", author_user_id: anna })), "messages_author_check");
  const messageId = await seedMessage(knex, { homeId, chatId: direct.id, userId: anna, body: { text: "hello" } });
  const before = (await knex("messages").where({ id: messageId }).first(knex.raw("changed::text as changed"))).changed;
  await knex("messages").where({ id: messageId }).update({ body: { text: "hello again" } });
  const after = (await knex("messages").where({ id: messageId }).first(knex.raw("changed::text as changed"))).changed;
  assert.ok(BigInt(after) > BigInt(before), "an update moves the message's change stamp");

  // The agent engine's runs are keyed by a bot's seat in a chat, which must exist.
  assert.equal(await refused(knex("agent_runs").insert({ conversation_id: "999999999", bot_id: botId, user_id: anna })), "agent_runs_chat_bot_foreign");
});

test("a bot or a chat going takes what hangs off it; a person's account going leaves the bots they made", async (context) => {
  const { homeId, people: [anna, ben], botId } = await home(knex, context, "schema-cascades");
  const chat = await seedChat(knex, { homeId, kind: "private", people: [anna, ben], bots: [botId], title: "Plans" });
  const seat = chat.chatBotIds.get(botId);
  await seedMessage(knex, { homeId, chatId: chat.id, botId, body: { text: "menu" } });
  await knex("bot_routines").insert({ workspace_id: homeId, chat_bot_id: seat, made_by: anna, name: "Daily", schedule: "every day", instructions: "x" });

  await knex("bots").where({ id: botId }).del();
  assert.equal((await knex("chat_bots").where({ conversation_id: chat.id }).count({ n: "*" }))[0].n, "0", "the bot's seat goes with it");
  assert.equal((await knex("bot_routines").where({ chat_bot_id: seat }).count({ n: "*" }))[0].n, "0", "its routines in the chat too");
  const message = await knex("messages").where({ conversation_id: chat.id }).first("author_bot_id", "role");
  assert.deepEqual(message, { author_bot_id: null, role: "bot" }, "what it said stays, its author gone");

  await knex("conversations").where({ id: chat.id }).del();
  for (const table of ["chat_people", "messages"]) {
    assert.equal((await knex(table).where({ conversation_id: chat.id }).count({ n: "*" }))[0].n, "0", `${table} go with their chat`);
  }

  // made_by is SET NULL: checked on the constraint, since the test's users are shared by every file.
  const [rule] = await knex.raw(`
    select confdeltype from pg_constraint where conrelid = 'bots'::regclass and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'bots'::regclass and attname = 'made_by')]`).then((result) => result.rows);
  assert.equal(rule.confdeltype, "n", "bots.made_by is ON DELETE SET NULL");
});

test("readable_from(chat) is D12: a chat reads itself, public chats, and private chats whose people include all of its own", async (context) => {
  const { homeId, people: [anna, ben, carla], botId } = await home(knex, context, "schema-reading");
  const make = (kind, people, title) => seedChat(knex, { homeId, kind, people, bots: [botId], title }).then((chat) => chat.id);
  const family = await make("public", [anna, ben], "Family");
  const garden = await make("public", [carla], "Garden");
  const annaAlone = await make("private", [anna], "Anna's");
  const annaBen = await make("private", [anna, ben], "Anna and Ben");
  const annaBenCarla = await make("private", [anna, ben, carla], "All three");
  const annaCarla = await make("private", [anna, carla], "Anna and Carla");
  const [empty] = await knex("conversations").insert({ workspace_id: homeId, kind: "private", title: "Nobody" }).returning("id");
  const readable = async (chat) => (await knex.raw("select readable_from(?) as id", [chat])).rows.map((row) => String(row.id)).sort((a, b) => a - b);
  const sorted = (...ids) => ids.map(String).sort((a, b) => a - b);

  // A public chat is opened by everyone in the home, now and later: it reads only public chats.
  assert.deepEqual(await readable(family), sorted(family, garden));
  // A private chat reads public chats and the private chats every one of its people is in.
  assert.deepEqual(await readable(annaAlone), sorted(family, garden, annaAlone, annaBen, annaBenCarla, annaCarla));
  assert.deepEqual(await readable(annaBen), sorted(family, garden, annaBen, annaBenCarla));
  assert.deepEqual(await readable(annaBenCarla), sorted(family, garden, annaBenCarla));
  assert.deepEqual(await readable(annaCarla), sorted(family, garden, annaBenCarla, annaCarla));
  // A private chat with nobody in it never counts as "everyone": it reads itself and the public chats only.
  assert.deepEqual(await readable(empty.id), sorted(family, garden, empty.id));
  // Another home's chats are never read, and a chat that isn't there reads nothing.
  const [other] = await knex("workspaces").insert({ slug: `schema-far-${randomBytes(5).toString("hex")}`, name: "Far", owner_user_id: anna, is_personal: false }).returning("id");
  context.after(() => knex("workspaces").where({ id: other.id }).del());
  const far = await seedChat(knex, { homeId: other.id, kind: "public", title: "Far away" });
  assert.equal((await readable(family)).includes(far.id), false);
  assert.deepEqual(await readable("999999999"), []);
});
