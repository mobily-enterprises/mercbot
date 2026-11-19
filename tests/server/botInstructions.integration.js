import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles, turnDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotRecords } from "../support/botRecords.mjs";

// A bot's own instructions (D-95), written in its Details panel or by the bot on a card the person approves. Renaming
// and labels are open to everyone in the home; instructions only to the bot's maker and the home's owners and admins.

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
  const origin = { slug: "weekly-meal-planner", name: "Pantry", creator: "the Mercbot team", kind: "gallery", addedAt: new Date().toISOString() };
  const bot = await testBot(knex, pat, { name: `Pantry ${stamp}`, instructions: "Plan the week's meals.", origin: JSON.stringify(origin) });
  const scratch = await testBot(knex, pat, { name: `Scratch ${stamp}` });
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
  const stored = async (botId) => knex("bots").where({ id: botId }).first("instructions", "origin");
  return { knex, records, bots, as, stored, homeId, elsewhere: elsewhere.id, pat, kim: kim.id, ada: ada.id, sam: sam.id, bot, scratch, origin };
}

test("Details: its maker and the home's admins change a bot's instructions; another member and another home can't", async (context) => {
  const { bots, as, stored, pat, kim, ada, sam, elsewhere, scratch } = await setup(context);
  assert.deepEqual(await bots.instructionsOf(scratch.id, as(pat)), { instructions: "", canChange: true, changedFromTemplate: false }, "a scratch bot has none");
  assert.equal((await bots.instructionsOf(scratch.id, as(kim))).canChange, false, "another member reads them but can't change them");
  assert.equal((await bots.instructionsOf(scratch.id, as(ada, { manages: true }))).canChange, true, "an admin can");

  // Renaming is everyone's in the home, as it was; instructions aren't.
  await bots.updateBot(scratch.id, { name: "Renamed by Kim" }, as(kim));
  await assert.rejects(bots.updateBot(scratch.id, { instructions: "Kim's rules" }, as(kim)), (error) => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, "bots_instructions_forbidden");
    assert.equal(error.message, "Only the person who made Renamed by Kim and the home's owners and admins can change its instructions.");
    return true;
  });
  await assert.rejects(bots.updateBot(scratch.id, { instructions: "Sam's rules" }, as(sam, { home: elsewhere, manages: true })), /Bot not found/u,
    "an owner of another home can't reach it");
  await assert.rejects(bots.instructionsOf(scratch.id, as(sam, { home: elsewhere, manages: true })), /Bot not found/u);
  assert.equal((await stored(scratch.id)).instructions, null, "nothing was written");

  await bots.updateBot(scratch.id, { instructions: "  Keep replies short.\nAsk before booking anything.  " }, as(pat));
  assert.equal((await stored(scratch.id)).instructions, "Keep replies short.\nAsk before booking anything.", "its maker's, trimmed");
  assert.deepEqual(await bots.instructionsOf(scratch.id, as(kim)), { instructions: "Keep replies short.\nAsk before booking anything.", canChange: false, changedFromTemplate: false });
  await bots.updateBot(scratch.id, { instructions: "An admin's rules." }, as(ada, { manages: true }));
  assert.equal((await stored(scratch.id)).instructions, "An admin's rules.");
  await bots.updateBot(scratch.id, { instructions: "" }, as(pat));
  assert.deepEqual(await stored(scratch.id), { instructions: null, origin: null }, "emptied, it's none again, as a scratch bot's");
});

test("Details: instructions past 20,000 characters are refused with the reason, and nothing is written", async (context) => {
  const { bots, as, stored, pat, scratch } = await setup(context);
  await bots.updateBot(scratch.id, { instructions: "x".repeat(20000) }, as(pat));
  assert.equal((await stored(scratch.id)).instructions.length, 20000);
  await assert.rejects(bots.updateBot(scratch.id, { instructions: "y".repeat(20001) }, as(pat)), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "bots_instructions_too_long");
    assert.match(error.message, /^Instructions can be up to 20,000 characters, and these are 20,001\./u);
    return true;
  });
  assert.equal((await stored(scratch.id)).instructions, "x".repeat(20000));
});

test("a template bot keeps where it came from, and says once its instructions are changed from the template's", async (context) => {
  const { bots, as, stored, pat, bot, origin } = await setup(context);
  assert.equal((await bots.instructionsOf(bot.id, as(pat))).changedFromTemplate, false);
  const { origin: shown } = await bots.updateBot(bot.id, { instructions: "Plan the week's meals for four." }, as(pat));
  assert.deepEqual(shown, { ...origin, instructionsChanged: true }, "Came from stays, with the change noted");
  assert.deepEqual((await stored(bot.id)).origin, { ...origin, instructionsChanged: true });
  assert.deepEqual(await bots.instructionsOf(bot.id, as(pat)), { instructions: "Plan the week's meals for four.", canChange: true, changedFromTemplate: true });
});

/** The approval card a turn of `bot` for `userId` (in `conversationId`) leaves when the bot is asked to change its instructions. */
async function cardFromTurn({ knex, records, bot, userId, conversationId, call }, instructions) {
  const { tools, after } = buildTools(turnDoubles({
    call, records, approvals: { decide: async () => "allow" }, computer: {}, homeId: String(bot.workspace_id), userId: String(userId), botId: String(bot.id), conversationId: String(conversationId)
  }));
  assert.equal((await tools.changeInstructions.execute({ instructions })).status, "waiting_for_approval");
  const [card] = await knex("bot_messages")
    .insert({ workspace_id: bot.workspace_id, bot_id: bot.id, conversation_id: conversationId, kind: after[0].kind, role: after[0].role, body: after[0].body })
    .returning("*");
  return card;
}

test("asked in its chat, a bot changes its instructions only once the card is approved, from the next reply on", async (context) => {
  const { knex, records, bots, as, stored, pat, bot, origin } = await setup(context);
  const card = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: bot.conversation_id, call: as(pat) }, "Plan meals for two, no fish.");
  assert.deepEqual(card.body.change, { before: "Plan the week's meals.", after: "Plan meals for two, no fish." });
  assert.equal((await stored(bot.id)).instructions, "Plan the week's meals.", "the card alone changes nothing");

  const answered = await bots.answerChoice(bot.id, card.id, ["Go ahead"], as(pat));
  assert.equal(answered.messages[1].body.text, `Changed ${bot.name}'s instructions`);
  assert.deepEqual(await stored(bot.id), { instructions: "Plan meals for two, no fish.", origin: { ...origin, instructionsChanged: true } });
  // What the next reply reads (botReplies.js reads the bot's row for each reply).
  assert.equal((await records.conversations.botOf(String(bot.id), as(pat))).instructions, "Plan meals for two, no fish.");

  const declined = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: bot.conversation_id, call: as(pat) }, "Something else.");
  await bots.answerChoice(bot.id, declined.id, ["Don't do it"], as(pat));
  assert.equal((await stored(bot.id)).instructions, "Plan meals for two, no fish.", "declined, nothing changes");

  // A card made before another change never overwrites it.
  const stale = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: bot.conversation_id, call: as(pat) }, "From the old card.");
  await bots.updateBot(bot.id, { instructions: "Changed in Details meanwhile." }, as(pat));
  const late = await bots.answerChoice(bot.id, stale.id, ["Go ahead"], as(pat));
  assert.equal(late.messages[1].body.text, `${bot.name}'s instructions changed after this card was made, so they were left as they are.`);
  assert.equal((await stored(bot.id)).instructions, "Changed in Details meanwhile.");
});

test("in a shared bot, a member who may not change its instructions gets a polite no, on the card and in the chat", async (context) => {
  const { knex, records, bots, as, stored, pat, kim, ada, bot } = await setup(context);
  await bots.updateBot(bot.id, { sharing: "shared" }, as(pat));
  const { roomId } = (await bots.listBots(as(kim))).bots.find((entry) => entry.id === String(bot.id));

  // Kim asks in the shared conversation: the bot is told to say no, and leaves no card.
  const { tools, after } = buildTools(turnDoubles({
    call: as(kim), records, approvals: { decide: async () => "allow" }, computer: {}, homeId: String(bot.workspace_id), userId: String(kim), botId: String(bot.id), conversationId: String(roomId), personal: false
  }));
  assert.equal((await tools.changeInstructions.execute({ instructions: "Kim's rules." })).error,
    `Only the person who made ${bot.name} and the home's owners and admins can change its instructions. Say so politely: nothing was changed.`);
  assert.deepEqual(after, []);

  // A card Pat's turn left there, which Kim presses: refused, as the person saying yes.
  const card = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: roomId, call: as(pat) }, "Pat's rules.");
  const refused = await bots.answerChoice(bot.id, card.id, ["Go ahead"], as(kim));
  assert.equal(refused.messages[1].body.text, `Only the person who made ${bot.name} and the home's owners and admins can change its instructions.`);
  assert.equal((await stored(bot.id)).instructions, "Plan the week's meals.");

  // An admin's yes on the same kind of card does it.
  const again = await cardFromTurn({ knex, records, bot, userId: pat, conversationId: roomId, call: as(pat) }, "Pat's rules.");
  await bots.answerChoice(bot.id, again.id, ["Go ahead"], as(ada, { manages: true }));
  assert.equal((await stored(bot.id)).instructions, "Pat's rules.");
});
