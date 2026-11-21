import { seedChat } from "../support/chatFixtures.mjs";

// The test person's home (D-36): bots belong to a home, so tests create theirs in it. The test
// database's user gets one the first time it's needed.
export async function testHome(knex, userId) {
  const existing = await knex("workspace_memberships").where({ user_id: userId, status: "active" }).orderBy("workspace_id").first();
  if (existing) return existing.workspace_id;
  const [home] = await knex("workspaces").insert({ slug: `test-home-${userId}`, name: "Test home", owner_user_id: userId, is_personal: true }).returning("id");
  await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: userId, role_sid: "owner", status: "active" });
  await knex("workspace_settings").insert({ workspace_id: home.id });
  return home.id;
}

// A bot in the test home, made by the test person, with their direct chat with it: Public, as every new chat is
// (D-112, D15). `conversation_id` is the chat, `chat_bot_id` the bot's seat in it.
export async function testBot(knex, userId, fields = {}) {
  const workspaceId = await testHome(knex, userId);
  const { onboarding_step: onboarding = null, ...rest } = fields;
  const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: workspaceId, name: "Disposable", color: "#1E86FC", ...rest }).returning("*");
  const chat = await seedChat(knex, { homeId: workspaceId, direct: { userId, botId: bot.id }, onboardingStep: onboarding });
  return { ...bot, conversation_id: chat.id, chat_bot_id: chat.chatBotIds.get(String(bot.id)) };
}

/**
 * A home of the test's own (not anyone's first home), which `ownerId` owns and each of `members` belongs to as a
 * member, so the accounts a test connects there are its alone (D-111: every account of a home is everyone's in it).
 * Deleting the home removes its memberships and accounts with it. Its id.
 */
export async function separateHome(knex, ownerId, members = []) {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const [home] = await knex("workspaces").insert({ slug: `accounts-${stamp}`, name: "Accounts test", owner_user_id: ownerId, is_personal: false }).returning("id");
  await knex("workspace_memberships").insert([
    { workspace_id: home.id, user_id: ownerId, role_sid: "owner", status: "active" },
    ...members.map((userId) => ({ workspace_id: home.id, user_id: userId, role_sid: "member", status: "active" }))
  ]);
  await knex("workspace_settings").insert({ workspace_id: home.id });
  return String(home.id);
}

/** A bot `userId` made in `workspaceId`, with their conversation with it, as testBot makes one in their first home. */
export async function botIn(knex, workspaceId, userId, fields = {}) {
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Disposable", color: "#1E86FC", ...fields }).returning("*");
  const [conversation] = await knex("bot_conversations").insert({ workspace_id: workspaceId, bot_id: bot.id, user_id: userId }).returning("*");
  return { ...bot, conversation_id: conversation.id };
}
