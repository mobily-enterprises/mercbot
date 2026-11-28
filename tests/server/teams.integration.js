import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createBotTeams } from "../../packages/bots/src/server/botTeams.js";
import { teamById } from "../../packages/bots/src/server/teams.js";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// Teams (D-105) on chats (D-112, plan 5.2): Add a team makes its bots together, members of the home on Team that open
// no chats of their own; the main bot introduces them in the person's welcome chat with a [Message] for each. A
// template the home's bots follow isn't added again, all or none, and the same statements however many.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const FAMILY = teamById("family-home");
const madeIn = (homeId) => knex("bots").where({ workspace_id: homeId, is_main: false }).orderBy("id");

test("Add a team makes its bots together, in no chat, and the main bot introduces them in the welcome chat", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, anna, ben, as } = await seedHome(knex, context);
  const { chat: welcome } = await kit.onboarding.welcome(as("anna"));
  const chosen = FAMILY.templates.slice(0, 3);

  const added = await kit.teams.addTeam("family-home", chosen.toReversed(), as("anna"));
  const bots = await madeIn(homeId);
  assert.deepEqual(bots.map((bot) => bot.library_template), chosen, "in the team's order, whatever order they were ticked in");
  assert.deepEqual(added.added, bots.map((bot) => String(bot.id)));
  assert.ok(bots.every((bot) => String(bot.made_by) === anna), "Anna made them");
  assert.deepEqual(await knex("chat_bots").whereIn("bot_id", added.added), [], "no burst of chats: they're on Team");
  assert.deepEqual(added.skipped, []);
  assert.equal(added.chatId, welcome.id);
  assert.deepEqual(added.bots.filter((bot) => added.added.includes(bot.id)).map((bot) => bot.template.source), ["library", "library", "library"]);

  const [intro] = await knex("messages").where({ conversation_id: welcome.id, kind: "text" }).orderBy("id", "desc").limit(1);
  assert.equal(String(intro.author_bot_id), welcome.directBotId, "Mercbot says it");
  assert.match(intro.body.text, new RegExp(`^Your home's new bots are here: ${bots[0].name}, ${bots[1].name} and ${bots[2].name}\\.`, "u"));
  assert.deepEqual(intro.body.team.map((entry) => entry.botId), added.added, "with a [Message] for each");
  assert.deepEqual(Object.keys(intro.body.team[0]).sort(), ["botId", "color", "name", "shape"]);

  const created = kit.calls.told.filter((notice) => notice.event.type === "bot" && notice.event.change === "created");
  assert.deepEqual(created.map((notice) => notice.event.botId).filter((id) => added.added.includes(id)), added.added);
  assert.deepEqual(created.at(-1).keys.sort(), [anna, ben].sort(), "everyone in the home hears of each");
  assert.ok(kit.calls.told.some((notice) => notice.event.type === "messages" && notice.event.chatId === welcome.id && notice.keys.includes(anna)));
  assert.equal(await knex("bot_routines").whereIn("chat_bot_id", knex("chat_bots").select("id").whereIn("bot_id", added.added)).first(), undefined);
});

test("a template the home's bots follow is left out, an archived one too, and a team of only those is refused", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, as, bot } = await seedHome(knex, context);
  const [chores, meals] = FAMILY.templates;
  await bot("Sweep", { library_template: chores });
  await bot("Old Pantry", { library_template: meals, archived_at: new Date() });

  const screen = await kit.teams.teamFor("family-home", as("ben"));
  const shown = new Map(screen.bots.map((entry) => [entry.slug, entry]));
  assert.deepEqual([shown.get(chores).inHome, shown.get(chores).archivedInHome], [true, undefined]);
  assert.deepEqual([shown.get(meals).inHome, shown.get(meals).archivedInHome], [true, true], "an archived bot is still in the home");

  await assert.rejects(kit.teams.addTeam("family-home", [chores, meals], as("ben")), { statusCode: 409, code: "bots_team_all_in_home" });
  const added = await kit.teams.addTeam("family-home", FAMILY.templates.slice(0, 3), as("ben"));
  assert.deepEqual(added.skipped, [chores, meals]);
  assert.equal(added.added.length, 1);
  assert.equal(added.chatId, null, "a home with no main bot yet has no welcome chat to say it in");
  assert.equal((await madeIn(homeId)).length, 3);
});

test("if any write fails, none of the team's bots or its introduction is made", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, as } = await seedHome(knex, context);
  const { chat: welcome } = await kit.onboarding.welcome(as("anna"));
  // The last write of adding a team: the introduction, after the bots are written.
  const failing = createBotTeams({
    records: kit.records, botList: kit.botList, templates: kit.templates, notices: { publishEach: async () => {} },
    onboarding: { introduce: async () => { throw new Error("The database went away."); } }
  });
  await assert.rejects(failing.addTeam("family-home", FAMILY.templates, as("anna")), /The database went away\./u);
  assert.deepEqual(await madeIn(homeId), []);
  assert.deepEqual((await knex("messages").where({ conversation_id: welcome.id })).map((row) => row.kind), ["timestamp"]);
});

test("an unknown team, an empty choice and a template the team hasn't got are refused 400, and nothing is made", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, as } = await seedHome(knex, context);
  await assert.rejects(kit.teams.teamFor("pirates", as("anna")), { statusCode: 400, code: "bots_team_unknown" });
  await assert.rejects(kit.teams.addTeam("pirates", ["habit-tracker"], as("anna")), { statusCode: 400, code: "bots_team_unknown" });
  for (const chosen of [[], undefined, "habit-tracker"]) {
    await assert.rejects(kit.teams.addTeam("just-me", chosen, as("anna")), { statusCode: 400, code: "bots_team_empty" });
  }
  await assert.rejects(kit.teams.addTeam("just-me", ["habit-tracker", "shop-stock-keeper"], as("anna")), { statusCode: 400, code: "bots_team_template_unknown" });
  assert.deepEqual(await madeIn(homeId), []);
});

test("adding a team makes the same statements for 1 bot as for 6, in a home of 4 bots or of 60", async (context) => {
  const kit = await startSurfaces(knex, context);
  const statements = async (count, chosen) => {
    const { homeId, anna, as } = await seedHome(knex, context);
    await kit.onboarding.welcome(as("anna"));
    await knex("bots").insert(Array.from({ length: count }, (_, index) => ({ made_by: anna, workspace_id: homeId, name: `Bot ${index}`, color: "#1E86FC", library_template: "general" })));
    await kit.botList.listBots(as("anna"));
    let added;
    const counted = await queriesDuring(knex, async () => { added = await kit.teams.addTeam("family-home", chosen, as("anna")); });
    assert.equal(added.added.length, chosen.length);
    assert.equal(added.bots.length, count + 1 + chosen.length);
    return counted;
  };
  const counts = {
    "1 bot, 4 in the home": await statements(4, FAMILY.templates.slice(0, 1)),
    "6 bots, 4 in the home": await statements(4, FAMILY.templates),
    "1 bot, 60 in the home": await statements(60, FAMILY.templates.slice(0, 1)),
    "6 bots, 60 in the home": await statements(60, FAMILY.templates)
  };
  const [first] = Object.values(counts);
  assert.ok(Object.values(counts).every((count) => count === first), JSON.stringify(counts));
  context.diagnostic(JSON.stringify(counts));
});

// A ready-made app that comes with a bot (D-144): its library template's bot is made in the home the first time, as Add
// bots makes one, and the home's bot on that template is used every time after, so there's never a second; a home that
// has one already (even renamed) keeps it.
test("an app's bot is made once from the library, and a home's bot on its template is used after that", async (context) => {
  const kit = await startSurfaces(knex, context);
  const { homeId, as } = await seedHome(knex, context);
  const first = await kit.teams.appBot("learner", as("anna"));
  const again = await kit.teams.appBot("learner", as("ben"));
  const made = await madeIn(homeId);
  assert.deepEqual(made.map((row) => [String(row.id), row.name, row.library_template]), [[first.id, "Learner", "learner"]]);
  assert.deepEqual(again, first);

  const other = await seedHome(knex, context);
  const own = await other.bot("Miss Page", { library_template: "learner" });
  assert.deepEqual(await kit.teams.appBot("learner", other.as("anna")), { id: own, name: "Miss Page" });
  assert.equal((await madeIn(other.homeId)).length, 1, "no second copy");
  await assert.rejects(kit.teams.appBot("nobody", as("anna")), { statusCode: 400, code: "bots_add_template_unknown" });
});
