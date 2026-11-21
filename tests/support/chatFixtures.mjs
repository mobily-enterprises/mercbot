// Chats seeded straight into a test database (D-112), as records.chats makes them: a chat row, its people and its
// bots. For tests that need a chat to exist before the code under test runs; the chats' own behaviour is tested
// through records.chats (tests/server/chatMembers.integration.js).

/**
 * A chat in a home: Public unless `kind` is "private" (D15), with its people and bots in the order given. A direct
 * chat names `direct` (the person and the bot); it has no title.
 * @param {import("knex").Knex} knex
 * @param {{ homeId: string | number, kind?: "public" | "private", title?: string | null, people?: Array<string | number>,
 *   bots?: Array<string | number>, direct?: { userId: string | number, botId: string | number }, everyone?: boolean,
 *   appId?: string | null, onboardingStep?: string | null, madeBy?: string | number | null, botsJoinIn?: boolean }} chat
 * @returns {Promise<{ id: string, chatBotIds: Map<string, string> }>} the chat's id and each bot's seat in it, by bot id
 */
export async function seedChat(knex, { homeId, kind = "public", title = null, people = [], bots = [], direct = null, everyone = false, appId = null, onboardingStep = null, madeBy = null, botsJoinIn = false }) {
  const [chat] = await knex("conversations").insert({
    workspace_id: homeId,
    kind,
    title: direct ? null : title,
    everyone,
    bots_join_in: botsJoinIn,
    app_id: appId,
    onboarding_step: onboardingStep,
    made_by: madeBy ?? people[0] ?? null,
    direct_user_id: direct?.userId ?? null,
    direct_bot_id: direct?.botId ?? null
  }).returning("id");
  const peopleIds = [...new Set([...(direct ? [direct.userId] : []), ...people].map(String))];
  if (peopleIds.length) {
    await knex("chat_people").insert(peopleIds.map((userId) => ({ conversation_id: chat.id, workspace_id: homeId, user_id: userId })));
  }
  const botIds = [...new Set([...(direct ? [direct.botId] : []), ...bots].map(String))];
  const seats = botIds.length
    ? await knex("chat_bots").insert(botIds.map((botId, position) => ({ conversation_id: chat.id, workspace_id: homeId, bot_id: botId, position }))).returning(["id", "bot_id"])
    : [];
  return { id: String(chat.id), chatBotIds: new Map(seats.map((seat) => [String(seat.bot_id), String(seat.id)])) };
}

/**
 * A message in a chat, as messages.append writes one: a person's (`userId`), a bot's (`botId`) or Mercbot's own.
 * @param {import("knex").Knex} knex
 * @param {{ homeId: string | number, chatId: string | number, kind?: string, body: object, userId?: string | number, botId?: string | number }} message
 */
export async function seedMessage(knex, { homeId, chatId, ...message }) {
  const [id] = await seedMessages(knex, { homeId, chatId, rows: [message] });
  return id;
}

/**
 * Many messages in one chat, in the order given, written in one statement: each `{ kind = "text", body, userId, botId }`
 * as seedMessage takes one. Their ids, in that order.
 */
export async function seedMessages(knex, { homeId, chatId, rows }) {
  const inserted = await knex("messages").insert(rows.map(({ kind = "text", body, userId = null, botId = null }) => ({
    workspace_id: homeId,
    conversation_id: chatId,
    author_user_id: userId,
    author_bot_id: botId,
    role: userId != null ? "user" : botId != null ? "bot" : "system",
    kind,
    body: JSON.stringify(body)
  }))).returning("id");
  return inserted.map((row) => String(row.id));
}
