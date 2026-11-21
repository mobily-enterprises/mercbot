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
