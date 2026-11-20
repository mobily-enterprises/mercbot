import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles, turnDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// A bot's additions (D-98, D-95's instructions before them), written in its Details panel or by the bot on a card the
// person approves, and its template, changed in Details. Renaming is open to everyone in the home; additions and the
// template only to the bot's maker and the home's owners and admins.

async function setup(context) {
  const knex = await connectTestDatabase();
  const pat = (await knex("users").first()).id;
  const stamp = Date.now();
  const person = (name) => ({ auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email: `${name}-${stamp}@example.com`, username: `${name}${stamp}`, display_name: name });
  const [kim, ada, sam] = await knex("users").insert([person("kim"), person("ada"), person("sam")]).returning("id");
  const homeId = await testHome(knex, pat);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: kim.id, role_sid: "member", status: "active" },
    { workspace_id: homeId, user_id: ada.id, role_sid: "admin", status: "active" }
  ]);
  // Sam's own home: a member of another home.
  const [elsewhere] = await knex("workspaces").insert({ slug: `sam-${stamp}`, name: "Sam's home", owner_user_id: sam.id, is_personal: true }).returning("id");
  await knex("workspace_memberships").insert({ workspace_id: elsewhere.id, user_id: sam.id, role_sid: "owner", status: "active" });
  const bot = await testBot(knex, pat, { name: `Pantry ${stamp}`, library_template: "weekly-meal-planner", additions: "Plan the week's meals." });
  const scratch = await testBot(knex, pat, { name: `Scratch ${stamp}`, library_template: "general" });
  context.after(async () => {
    await knex("bots").whereIn("id", [bot.id, scratch.id]).del();
    await knex("workspace_memberships").whereIn("user_id", [kim.id, ada.id, sam.id]).del();
    await knex("workspaces").where({ id: elsewhere.id }).del();
    await knex("users").whereIn("id", [kim.id, ada.id, sam.id]).del();
    await knex.destroy();
  });
  const records = await startBotRecords(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, records, approvals: { decide: async () => "allow" } }));
  const as = (userId, { home = homeId, manages = false } = {}) =>
    memberOptions({ userId, homeId: home, role: manages ? "admin" : "member", permissions: manages ? ["workspace.settings.update"] : [] });
  const stored = async (botId) => knex("bots").where({ id: botId }).first("additions", "library_template", "home_template_id");
  return { knex, records, bots, as, stored, homeId, elsewhere: elsewhere.id, pat, kim: kim.id, ada: ada.id, sam: sam.id, bot, scratch };
}

test("Details: its maker and the home's admins change a bot's additions; another member and another home can't", async (context) => {
  const { bots, as, stored, pat, kim, ada, sam, elsewhere, scratch } = await setup(context);
  const read = await bots.instructionsOf(scratch.id, as(pat));
  assert.deepEqual([read.template.source, read.template.slug, read.template.tag, read.additions, read.canChange], ["library", "general", "general", "", true],
    "a bot made with nothing in mind is Mercbot's general one, with no additions");
  assert.equal((await bots.instructionsOf(scratch.id, as(kim))).canChange, false, "another member reads them but can't change them");
  assert.equal((await bots.instructionsOf(scratch.id, as(ada, { manages: true }))).canChange, true, "an admin can");

  // Renaming is everyone's in the home, as it was; additions aren't.
  await bots.updateBot(scratch.id, { name: "Renamed by Kim" }, as(kim));
  await assert.rejects(bots.updateBot(scratch.id, { additions: "Kim's rules" }, as(kim)), (error) => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, "bots_additions_forbidden");
    assert.equal(error.message, "Only the person who made Renamed by Kim and the home's owners and admins can change its template or additions.");
    return true;
  });
  await assert.rejects(bots.updateBot(scratch.id, { additions: "Sam's rules" }, as(sam, { home: elsewhere, manages: true })), /Bot not found/u,
    "an owner of another home can't reach it");
  await assert.rejects(bots.instructionsOf(scratch.id, as(sam, { home: elsewhere, manages: true })), /Bot not found/u);
  assert.equal((await stored(scratch.id)).additions, "", "nothing was written");

  const changed = await bots.updateBot(scratch.id, { additions: "  Keep replies short.\nAsk before booking anything.  " }, as(pat));
  assert.equal((await stored(scratch.id)).additions, "Keep replies short.\nAsk before booking anything.", "its maker's, trimmed");
  assert.deepEqual([changed.hasAdditions, changed.additionsLine, changed.template.tag], [true, "Keep replies short.", "general"], "its chip says it has additions");
  assert.equal((await bots.instructionsOf(scratch.id, as(kim))).additions, "Keep replies short.\nAsk before booking anything.");
  await bots.updateBot(scratch.id, { additions: "An admin's rules." }, as(ada, { manages: true }));
  assert.equal((await stored(scratch.id)).additions, "An admin's rules.");
  const emptied = await bots.updateBot(scratch.id, { additions: "" }, as(pat));
  assert.deepEqual([(await stored(scratch.id)).additions, emptied.hasAdditions], ["", false], "emptied, it has none again");
  // Labels are gone (D-98): a patch naming one changes nothing, and no bot carries one.
  assert.equal("label" in (await bots.updateBot(scratch.id, { label: "Kitchen" }, as(pat))), false);
});

test("Details: additions past 20,000 characters are refused with the reason, and nothing is written", async (context) => {
  const { bots, as, stored, pat, scratch } = await setup(context);
  await bots.updateBot(scratch.id, { additions: "x".repeat(20000) }, as(pat));
  assert.equal((await stored(scratch.id)).additions.length, 20000);
  await assert.rejects(bots.updateBot(scratch.id, { additions: "y".repeat(20001) }, as(pat)), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "bots_additions_too_long");
    assert.match(error.message, /^Additions can be up to 20,000 characters, and these are 20,001\./u);
    return true;
  });
  assert.equal((await stored(scratch.id)).additions, "x".repeat(20000));
});

/** The approval card a turn of `bot` for `userId` (in `conversationId`) leaves when the bot is asked to change its additions. */
async function cardFromTurn({ knex, records, bot, userId, conversationId, call }, additions) {
  const { tools, after } = buildTools(turnDoubles({
    call, records, approvals: { decide: async () => "allow" }, computer: {}, homeId: String(bot.workspace_id), userId: String(userId), botId: String(bot.id), conversationId: String(conversationId)
  }));
  assert.equal((await tools.changeAdditions.execute({ additions })).status, "waiting_for_approval");
  const [card] = await knex("bot_messages")
    .insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: after[0].kind, role: after[0].role, body: after[0].body })
    .returning("*");
  return card;
}

test("asked in its chat, a bot changes its additions only once the card is approved, from the next reply on; never its template", async (context) => {
  const { knex, records, bots, as, stored, pat, bot } = await setup(context);
  const card = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: bot.conversation_id, call: as(pat) }, "Plan meals for two, no fish.");
  assert.deepEqual(card.body.change, { before: "Plan the week's meals.", after: "Plan meals for two, no fish." });
  assert.equal((await stored(bot.id)).additions, "Plan the week's meals.", "the card alone changes nothing");

  const answered = await bots.answerChoice(bot.id, card.id, ["Go ahead"], as(pat));
  assert.equal(answered.messages[1].body.text, `Changed ${bot.name}'s additions`);
  assert.deepEqual(await stored(bot.id), { additions: "Plan meals for two, no fish.", library_template: "weekly-meal-planner", home_template_id: null },
    "its template stays Mercbot's");
  // What the next reply reads (botReplies.js reads the bot's row for each reply).
  assert.equal((await records.conversations.botOf(String(bot.id), as(pat))).additions, "Plan meals for two, no fish.");

  const declined = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: bot.conversation_id, call: as(pat) }, "Something else.");
  await bots.answerChoice(bot.id, declined.id, ["Don't do it"], as(pat));
  assert.equal((await stored(bot.id)).additions, "Plan meals for two, no fish.", "declined, nothing changes");

  // A card made before another change never overwrites it.
  const stale = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: bot.conversation_id, call: as(pat) }, "From the old card.");
  await bots.updateBot(bot.id, { additions: "Changed in Details meanwhile." }, as(pat));
  const late = await bots.answerChoice(bot.id, stale.id, ["Go ahead"], as(pat));
  assert.equal(late.messages[1].body.text, `${bot.name}'s additions changed after this card was made, so they were left as they are.`);
  assert.equal((await stored(bot.id)).additions, "Changed in Details meanwhile.");
});

test("in a shared bot, a member who may not change its additions gets a polite no, on the card and in the chat", async (context) => {
  const { knex, records, bots, as, stored, pat, kim, ada, bot } = await setup(context);
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const { roomId } = (await bots.listBots(as(kim))).bots.find((entry) => entry.id === String(bot.id));

  // Kim asks in the shared conversation: the bot is told to say no, and leaves no card.
  const { tools, after } = buildTools(turnDoubles({
    call: as(kim), records, approvals: { decide: async () => "allow" }, computer: {}, homeId: String(bot.workspace_id), userId: String(kim), botId: String(bot.id), conversationId: String(roomId), personal: false
  }));
  assert.equal((await tools.changeAdditions.execute({ additions: "Kim's rules." })).error,
    `Only the person who made ${bot.name} and the home's owners and admins can change its template or additions. Say so politely: nothing was changed.`);
  assert.deepEqual(after, []);

  // A card Pat's turn left there, which Kim presses: refused, as the person saying yes.
  const card = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: roomId, call: as(pat) }, "Pat's rules.");
  const refused = await bots.answerChoice(bot.id, card.id, ["Go ahead"], as(kim));
  assert.equal(refused.messages[1].body.text, `Only the person who made ${bot.name} and the home's owners and admins can change its template or additions.`);
  assert.equal((await stored(bot.id)).additions, "Plan the week's meals.");

  // An admin's yes on the same kind of card does it.
  const again = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: roomId, call: as(pat) }, "Pat's rules.");
  await bots.answerChoice(bot.id, again.id, ["Go ahead"], as(ada, { manages: true }));
  assert.equal((await stored(bot.id)).additions, "Pat's rules.");
});
