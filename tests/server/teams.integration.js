import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { createServer } from "../../server.js";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { DEFAULT_BOT_NAME } from "../../packages/bots/src/server/onboarding.js";
import { LIBRARY } from "../../packages/bots/src/server/templates.js";
import { TEAMS } from "../../packages/bots/src/server/teams.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { buildSidebarModel } from "../../src/components/mercbot/botDirectory.js";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// Teams (D-105), against the disposable test database, each test in homes of its own: Add a team makes the bots chosen
// together, each on its template with its greeting and none doing AI work, in a section named after the team, shared as
// the home's new bots are (Mixed, Shared, Private); a template the home's bots already follow is left out, and choosing
// only those is refused; if any write fails, none of the bots is made; an unknown team, an empty choice and a template
// the team hasn't got are refused 400, and someone outside the home 403 through the app's real routes, where anyone in
// it may add a team; a new home's first conversation offers a team after its default for new bots; and adding a team
// makes the same statements for 1 bot as for 6, whether the home has 4 bots or 60.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];
const COLOR = "#1E86FC";
const FAMILY = TEAMS.find((team) => team.id === "family-home");
const SHOP = TEAMS.find((team) => team.id === "shop");
const FRONT_DESK = TEAMS.find((team) => team.id === "front-desk");

/**
 * Pat (the test database's first person) and the bots service, with homes of the test's own, as homeDefault's tests
 * have them; `replies` counts the AI replies asked for. `records` replaces the bots' records (a write made to fail).
 */
async function setup(context, { records } = {}) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const homes = [];
  context.after(async () => {
    await knex("bots").whereIn("workspace_id", homes).del();
    await knex("bot_sections").whereIn("workspace_id", homes).del();
    await knex("workspace_settings").whereIn("workspace_id", homes).del();
    await knex("workspace_memberships").whereIn("workspace_id", homes).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const replies = { count: 0 };
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    ...(records ? { records: records(parts.records) } : {}),
    approvals: { decide: async () => "allow" },
    reply: async () => {
      replies.count += 1;
      return { text: "Noted.", transcript: [] };
    }
  }));
  context.after(() => bots.drain(10000));
  const newHome = async () => {
    const [home] = await knex("workspaces")
      .insert({ slug: `teams-${stamp}-${homes.length}`, name: `Home ${homes.length}`, owner_user_id: pat, is_personal: false })
      .returning("id");
    homes.push(String(home.id));
    await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: pat, role_sid: "owner", status: "active" });
    await knex("workspace_settings").insert({ workspace_id: home.id });
    return String(home.id);
  };
  const as = (userId, homeId, role = "owner") => memberOptions({ userId, homeId, role, permissions: role === "member" ? [] : MANAGE });
  const botsOf = (homeId) => knex("bots").where({ workspace_id: homeId }).orderBy("id");
  return { knex, bots, pat, newHome, as, botsOf, replies };
}

test("Add a team makes its bots together in a section named after it, each greeting, Mixed, and none doing AI work", async (context) => {
  const { bots, pat, newHome, as, botsOf, replies } = await setup(context);
  const homeId = await newHome();
  const owner = as(pat, homeId);
  const main = await bots.ensureFirstBot(owner);

  const screen = await bots.teamFor("family-home", owner);
  assert.deepEqual([screen.name, screen.description], [FAMILY.name, FAMILY.description]);
  assert.deepEqual(screen.bots.map((bot) => [bot.slug, bot.name, bot.inHome]), FAMILY.templates.map((slug) => [slug, LIBRARY.get(slug).name, false]));
  assert.ok(screen.bots.every((bot) => bot.color && bot.shape && bot.tag && bot.description), "each with its look, tag and line");

  const added = await bots.addTeam("family-home", [...FAMILY.templates].reverse(), "Pat Example", owner);
  assert.equal(added.added.length, 6);
  assert.deepEqual(added.skipped, []);
  const section = added.sections.find((entry) => entry.id === added.sectionId);
  assert.equal(section?.name, "Busy household", "a section named after the team");
  const made = added.added.map((id) => added.bots.find((bot) => bot.id === id));
  assert.deepEqual(made.map((bot) => bot.name), FAMILY.templates.map((slug) => LIBRARY.get(slug).name), "in the team's order");
  assert.ok(made.every((bot) => bot.sectionId === added.sectionId && bot.sharing === "mixed" && bot.unread), "in it, Mixed, each with news");
  assert.ok(made.every((bot) => bot.template.source === "library" && bot.onboardingStep === null), "on its template, nothing pending");
  // Made last to first, so the sidebar, newest first, shows the team in its own order, its first bot on top: the one a
  // new home opens on.
  const rows = await botsOf(homeId);
  assert.deepEqual(rows.filter((row) => !row.is_main).map((row) => [row.library_template, row.sharing, row.color]),
    FAMILY.templates.map((slug) => [slug, "mixed", LIBRARY.get(slug).color]).toReversed());
  const { visualOrder } = buildSidebarModel({ bots: added.bots, sections: added.sections });
  assert.deepEqual(visualOrder.map((id) => added.bots.find((bot) => bot.id === id).name),
    [...FAMILY.templates.map((slug) => LIBRARY.get(slug).name), main.name], "the sidebar reads in the team's order");
  for (const bot of made) {
    const { messages } = await bots.messages(bot.id, null, {}, owner);
    assert.deepEqual(messages.map((message) => message.kind), ["timestamp", "text"]);
    assert.match(messages[1].body.text, new RegExp(`^Hi\\b.*I'm ${bot.name}\\.`, "u"), "its template's greeting, as itself");
  }
  assert.equal(replies.count, 0, "no AI turn: each greeting is its template's own");
  assert.equal((await bots.listBots(owner)).bots.find((bot) => bot.id === main.id)?.sectionId, null, "the main bot stays where it was");

  // On the team screen they're all in the home now.
  assert.ok((await bots.teamFor("family-home", owner)).bots.every((bot) => bot.inHome));
});

test("a team's bots are shared as the home's new bots are: Shared ones get General and You only, Private none", async (context) => {
  const { bots, pat, newHome, as, botsOf } = await setup(context);
  const shared = await newHome();
  await bots.chooseHomeDefault("shared", as(pat, shared));
  const sharedAdded = await bots.addTeam("shop", SHOP.templates, "Pat", as(pat, shared));
  const sharedBots = sharedAdded.added.map((id) => sharedAdded.bots.find((bot) => bot.id === id));
  assert.ok(sharedBots.every((bot) => bot.sharing === "shared"));
  assert.deepEqual(sharedBots.map((bot) => bot.rooms.map((room) => [room.title, Boolean(room.own)])),
    sharedBots.map(() => [["General", false], ["You only", true]]), "General for everyone, then the person's own");
  assert.ok(sharedBots.every((bot) => bot.roomId === bot.rooms.at(-1).id), "You only open, where the greeting is");

  const personal = await newHome();
  await bots.chooseHomeDefault("private", as(pat, personal));
  await bots.addTeam("shop", SHOP.templates, "Pat", as(pat, personal));
  assert.deepEqual((await botsOf(personal)).map((row) => row.sharing), SHOP.templates.map(() => "private"));
});

test("a template the home's bots already follow is left out, by Add a team and by New bot alike", async (context) => {
  const { bots, pat, newHome, as, botsOf } = await setup(context);
  const homeId = await newHome();
  const owner = as(pat, homeId);
  // One from New bot, on Mercbot's website-enquiries template.
  await bots.createBot({ name: "Front door", color: COLOR, template: { library: "website-enquiries" } }, owner);
  const shop = await bots.addTeam("shop", ["shop-stock-keeper", "review-replies"], "Pat", owner);
  assert.equal(shop.added.length, 2);

  const desk = await bots.teamFor("front-desk", owner);
  const inHome = (slug) => desk.bots.find((bot) => bot.slug === slug).inHome;
  assert.deepEqual(FRONT_DESK.templates.filter(inHome), ["website-enquiries", "review-replies"]);
  const added = await bots.addTeam("front-desk", FRONT_DESK.templates, "Pat", owner);
  assert.deepEqual(added.skipped, ["website-enquiries", "review-replies"]);
  assert.equal(added.added.length, 4);
  const follow = (await botsOf(homeId)).map((row) => row.library_template);
  assert.equal(follow.length, new Set(follow).size, "never two bots on one template");

  // The same team again reuses its section; choosing only bots already there is refused, and nothing is made.
  const again = await bots.addTeam("shop", SHOP.templates, "Pat", owner);
  assert.equal(again.sectionId, shop.sectionId);
  assert.deepEqual(again.skipped, ["shop-stock-keeper", "review-replies", "receipts-and-invoices", "customer-follow-up"]);
  assert.equal(again.added.length, 1, "only social-post-calendar was missing");
  const before = (await botsOf(homeId)).length;
  await assert.rejects(bots.addTeam("shop", ["shop-stock-keeper"], "Pat", owner), { statusCode: 409, code: "bots_team_all_in_home" });
  assert.equal((await botsOf(homeId)).length, before);
});

test("if any write fails, none of the team's bots, seats, messages or its section is made", async (context) => {
  const failing = (records) => ({
    ...records,
    newBots: {
      ...records.newBots,
      // The last write of making bots: their first messages, after the bots and their seats are written.
      openWith: async () => {
        throw new Error("The database went away.");
      }
    }
  });
  const { knex, bots, pat, newHome, as, botsOf } = await setup(context, { records: failing });
  const homeId = await newHome();
  await assert.rejects(bots.addTeam("family-home", FAMILY.templates, "Pat", as(pat, homeId)), /The database went away\./u);
  assert.deepEqual(await botsOf(homeId), []);
  assert.deepEqual(await knex("bot_sections").where({ workspace_id: homeId }), []);
  assert.deepEqual(await knex("bot_conversations").where({ workspace_id: homeId }), []);
  assert.deepEqual(await knex("bot_messages").where({ workspace_id: homeId }), []);
});

test("an unknown team, an empty choice and a template the team hasn't got are refused 400, and nothing is made", async (context) => {
  const { bots, pat, newHome, as, botsOf } = await setup(context);
  const homeId = await newHome();
  const owner = as(pat, homeId);
  await assert.rejects(bots.teamFor("pirates", owner), { statusCode: 400, code: "bots_team_unknown" });
  await assert.rejects(bots.addTeam("pirates", ["habit-tracker"], "Pat", owner), { statusCode: 400, code: "bots_team_unknown" });
  for (const chosen of [[], undefined, "habit-tracker"]) {
    await assert.rejects(bots.addTeam("just-me", chosen, "Pat", owner), { statusCode: 400, code: "bots_team_empty" });
  }
  await assert.rejects(bots.addTeam("just-me", ["habit-tracker", "shop-stock-keeper"], "Pat", owner), {
    statusCode: 400,
    code: "bots_team_template_unknown"
  });
  assert.deepEqual(await botsOf(homeId), []);
});

test("a new home's first conversation offers a team after its default, and not once the home has other bots", async (context) => {
  const { bots, pat, newHome, as } = await setup(context);
  const user = { displayName: "Pat" };
  const named = async (homeId) => {
    const owner = as(pat, homeId);
    const main = await bots.ensureFirstBot(owner);
    await bots.advanceOnboarding(main.id, "start", user, owner);
    await bots.chooseName(main.id, DEFAULT_BOT_NAME, owner);
    await bots.advanceOnboarding(main.id, "confirm", user, owner);
    const renamed = await bots.advanceOnboarding(main.id, "rename", user, owner);
    return { owner, main, renamed, card: renamed.messages.find((message) => message.kind === "choice") };
  };
  const options = [...TEAMS.map((team) => team.name), "Not now"];

  // The default unchosen: its card, then the team's.
  const asked = await named(await newHome());
  const answered = await bots.answerChoice(asked.main.id, asked.card.id, ["Just me"], asked.owner);
  assert.equal(answered.bot.onboardingStep, "team-offer");
  const offered = await bots.advanceOnboarding(asked.main.id, "team-offer", user, asked.owner);
  const card = offered.messages.find((message) => message.kind === "choice");
  assert.deepEqual([card.body.purpose, card.body.question, card.body.options], ["team", "Want a ready-made team?", options]);
  assert.equal(offered.bot.onboardingStep, "team", "it waits for the answer");
  const chosen = await bots.answerChoice(asked.main.id, card.id, ["Busy household"], asked.owner);
  assert.deepEqual([chosen.team, chosen.bot.onboardingStep], ["family-home", "about"], "the page opens its team screen");
  assert.deepEqual(await bots.listBots(asked.owner).then((list) => list.bots.length), 1, "choosing adds nothing by itself");

  // Chosen already (the New home form): straight to the team's card; Not now carries on.
  const formed = await newHome();
  await bots.chooseHomeDefault("mixed", as(pat, formed));
  const quiet = await named(formed);
  assert.deepEqual([quiet.card.body.purpose, quiet.renamed.bot.onboardingStep], ["team", "team"]);
  const later = await bots.answerChoice(quiet.main.id, quiet.card.id, ["Not now"], quiet.owner);
  assert.deepEqual([later.team, later.bot.onboardingStep], [null, "about"]);

  // Typing past it skips it.
  const typed = await newHome();
  await bots.chooseHomeDefault("mixed", as(pat, typed));
  const busy = await named(typed);
  const sent = await bots.sendMessage(busy.main.id, { text: "Hello there" }, busy.owner);
  assert.equal(sent.messages.find((message) => message.id === busy.card.id)?.body.inactive, true);
  assert.equal(sent.bot.onboardingStep, "about");

  // A home that has its team's bots already (the New home form made it for one) isn't offered one.
  const teamed = await newHome();
  await bots.chooseHomeDefault("mixed", as(pat, teamed));
  const owner = as(pat, teamed);
  await bots.ensureFirstBot(owner);
  await bots.addTeam("family-home", FAMILY.templates, "Pat", owner);
  const settled = await named(teamed);
  assert.deepEqual([settled.card, settled.renamed.bot.onboardingStep], [undefined, "about"]);
});

test("adding a team makes the same statements for 1 bot as for 6, in a home of 4 bots or of 60, Mixed or Shared", async (context) => {
  const { knex, bots, pat, newHome, as } = await setup(context);
  const homeWith = async (count, sharing) => {
    const homeId = await newHome();
    await bots.chooseHomeDefault(sharing, as(pat, homeId));
    await knex("bots").insert(Array.from({ length: count }, (_, index) => ({ user_id: pat, workspace_id: homeId, name: `Bot ${index}`, color: COLOR })));
    return homeId;
  };
  const statements = async (count, sharing, chosen) => {
    const owner = as(pat, await homeWith(count, sharing));
    await bots.listBots(owner);
    let added;
    const counted = await queriesDuring(knex, async () => {
      added = await bots.addTeam("family-home", chosen, "Pat", owner);
    });
    assert.equal(added.added.length, chosen.length);
    assert.equal(added.bots.length, count + chosen.length);
    return counted;
  };
  for (const sharing of ["mixed", "shared"]) {
    const counts = {
      "1 bot, 4 in the home": await statements(4, sharing, FAMILY.templates.slice(0, 1)),
      "6 bots, 4 in the home": await statements(4, sharing, FAMILY.templates),
      "1 bot, 60 in the home": await statements(60, sharing, FAMILY.templates.slice(0, 1)),
      "6 bots, 60 in the home": await statements(60, sharing, FAMILY.templates)
    };
    const [first] = Object.values(counts);
    assert.ok(Object.values(counts).every((count) => count === first), `${sharing}: ${JSON.stringify(counts)}`);
    context.diagnostic(`${sharing}: ${JSON.stringify(counts)}`);
  }
});

test("through the app's routes anyone in the home adds a team, someone outside it is refused 403, and a bad team 400", async (context) => {
  const runtimeEnv = {
    ...process.env,
    AUTH_LOCAL_SESSION_SECRET: "teams-test-only-secret",
    AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
    DB_CLIENT: "pg",
    HOST: "127.0.0.1",
    NODE_ENV: "test",
    APP_ENV: "test",
    PORT: "3001",
    SERVER_SURFACE: "all"
  };
  const app = await createServer({ runtimeEnv });
  context.after(() => app.close());
  const knex = await connectTestDatabase();
  const made = [];
  context.after(async () => {
    await knex("workspaces").whereIn("id", made).del();
    await knex.destroy();
  });
  /** Someone registered and signed in: their requests, with the session's cookies and CSRF token. */
  const person = async (label) => {
    const cookies = new Map();
    let csrfToken;
    const request = async (method, url, payload, contentType = "application/json") => {
      const response = await app.inject({
        method,
        url,
        payload,
        headers: {
          ...(payload ? { "content-type": contentType } : {}),
          cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {})
        }
      });
      for (const cookie of response.cookies) cookies.set(cookie.name, cookie.value);
      const body = response.body ? response.json() : null;
      if (body?.csrfToken) csrfToken = body.csrfToken;
      return { status: response.statusCode, body };
    };
    const email = `${label}-${randomUUID()}@example.test`;
    await request("GET", "/api/session");
    assert.equal((await request("POST", "/api/register", { email, password: "Teams-test-password-2026!" })).status, 201);
    await request("GET", "/api/session");
    return { request, id: String((await knex("users").where({ email }).first()).id) };
  };
  const ann = await person("ann");
  const ben = await person("ben");
  const sam = await person("sam");
  const created = await ann.request("POST", "/api/workspaces", { data: { type: "workspaces", attributes: { name: "Corner shop" } } }, "application/vnd.api+json");
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const slug = created.body.data.attributes.slug;
  made.push(String(created.body.data.id));
  await knex("workspace_memberships").insert({ workspace_id: created.body.data.id, user_id: ben.id, role_sid: "member", status: "active" });
  const teamRoute = (teamId) => `/api/w/${encodeURIComponent(slug)}/teams/${teamId}`;

  const bySam = await sam.request("POST", teamRoute("shop"), { templates: SHOP.templates });
  // JSKIT answers a workspace someone isn't in as one that isn't there: 404 workspaces.workspace.notFound.
  assert.equal(bySam.status, 404, JSON.stringify(bySam.body));
  assert.equal((await sam.request("GET", teamRoute("shop"))).status, 404);
  assert.equal(await knex("bots").where({ workspace_id: created.body.data.id }).first(), undefined, "nothing made");
  assert.equal(await knex("bot_sections").where({ workspace_id: created.body.data.id }).first(), undefined, "no section either");

  assert.deepEqual([(await ben.request("GET", teamRoute("pirates"))).status, (await ben.request("POST", teamRoute("shop"), { templates: [] })).status], [400, 400]);
  const byBen = await ben.request("POST", teamRoute("shop"), { templates: SHOP.templates });
  assert.equal(byBen.status, 200, JSON.stringify(byBen.body));
  assert.equal(byBen.body.added.length, 5, "a member may add a team, as a bot");
  const read = await ann.request("GET", teamRoute("shop"));
  assert.deepEqual([read.status, read.body.bots.every((bot) => bot.inHome)], [200, true]);
});
