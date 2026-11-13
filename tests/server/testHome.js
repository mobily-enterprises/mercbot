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

// A bot in the test home, with the test person's conversation with it (D-36).
export async function testBot(knex, userId, fields = {}) {
  const workspaceId = await testHome(knex, userId);
  const { onboarding_step: onboarding = null, ...rest } = fields;
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: workspaceId, name: "Disposable", color: "#1E86FC", ...rest }).returning("*");
  const [conversation] = await knex("bot_conversations").insert({ workspace_id: workspaceId, bot_id: bot.id, user_id: userId, onboarding_step: onboarding }).returning("*");
  return { ...bot, conversation_id: conversation.id };
}
