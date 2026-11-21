// The bots' turns in chats (chatTurns.js) on the test database, for the turn tests: the bots' records and what
// BotsFeature gives beside them (startBotParts), knowledge that knows nothing, the chat routes' chats (chatMembers.js),
// and neutral stand-ins for the rest: a home with no computer awake, nothing connected, no files and no apps. A test
// passes the parts it exercises, member by member. Self-contained, so it builds no bots service: the integrator folds
// it into tests/support/botDoubles.mjs as startChatTurns.
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { createBackgroundWork } from "../../packages/bots/src/server/backgroundWork.js";
import { createChatMembers } from "../../packages/bots/src/server/chatMembers.js";
import { createChatTurns } from "../../packages/bots/src/server/chatTurns.js";
import { createChatModel } from "../../packages/bots/src/server/model.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { isPagePath } from "../../packages/files/src/server/pageDocument.js";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

const missing = (what) => async () => {
  throw new Error(`There's no ${what} in this test.`);
};

// The neutral collaborators: each a function, so no test shares another's.
const NEUTRAL = {
  approvals: () => ({ decide: async () => "allow" }),
  notices: () => ({ publish: async () => {}, publishEach: async () => {}, subscribe: () => () => {} }),
  knowledge: () => ({ forTurn: async () => null, stateLines: async () => [], toolsFor: () => ({}) }),
  computer: () => ({
    status: async () => null,
    hold: async () => {},
    screenshot: async () => null,
    noteSignIn: async () => {},
    act: missing("computer"),
    browse: missing("computer"),
    fill: missing("computer"),
    code: missing("computer")
  }),
  integrations: () => ({
    skills: async () => [],
    skillNames: async () => [],
    reachableAccounts: async () => [],
    namesOf: async () => new Map(),
    hasConnected: async () => false,
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [], connected: [] }),
    app: () => null,
    appName: (id) => id,
    appNamed: () => null,
    connections: { accessToken: missing("connected account"), whenConnected: () => () => {} },
    connectors: { apps: () => [], actions: missing("connected app"), use: missing("connected app") },
    createSkill: missing("skill store"),
    updateSkill: missing("skill store"),
    deleteSkill: missing("skill store")
  }),
  files: () => ({
    store: {
      placeFor: () => ({}),
      list: async () => ({}),
      existingFile: missing("file"),
      resolve: missing("file store"),
      widened: missing("file store"),
      settle: async () => {},
      move: missing("file store")
    },
    commandOutput: missing("command line"),
    apps: { session: () => ({ help: async () => "", call: missing("office app"), close: async () => {} }), textOf: missing("office app") },
    shell: { available: () => false, start: missing("command line"), check: missing("command line"), wholeOutputOf: missing("command line") },
    pages: { isPagePath, save: missing("pages"), edited: async () => null, pathChanged: async () => {}, standalone: missing("pages") },
    // No copy's check of pictures and videos (D-90): everything is allowed, and nothing is queued.
    media: createMediaChecks({ guard: createMediaGuard(null), mediaChecks: null, systemContext: null, store: null })
  }),
  apps: () => ({
    apps: { builder: async () => null, findApp: async () => null, searchViews: async () => [], queueTask: missing("apps") },
    watches: { pauseIn: async () => [] }
  })
};

/** A collaborator: the test's own members over the neutral ones. */
const complete = (name, given) => (given ? { ...NEUTRAL[name](), ...given } : NEUTRAL[name]());

/**
 * The turns, a test's own database connection, and its cleanups (newest first): add the rows a test makes to
 * `cleanup` after this, so they go before the connection closes. Drain the background work before reading what the
 * bots said: a reply that outlives its request goes on in it.
 * @param {import("node:test").TestContext} context
 * @param {object} [options] createChatTurns's collaborators over the neutral ones; `reply` stands in for the model
 */
export async function startChatTurns(context, options = {}) {
  const cleanup = cleanupStack(context);
  const knex = await connectTestDatabase();
  cleanup.after(() => knex.destroy());
  const parts = await startBotParts(knex, cleanup);
  const filled = { env: process.env, model: createChatModel(process.env), ...parts, ...options };
  for (const name of Object.keys(NEUTRAL)) filled[name] = complete(name, options[name]);
  const background = createBackgroundWork();
  cleanup.after(() => background.drain(10000));
  const chats = createChatMembers({ records: filled.records, notices: filled.notices, computer: { chatRemoved: async () => {} }, systemContext: filled.systemContext });
  const turns = createChatTurns({ ...filled, chats, background });
  return {
    knex,
    cleanup,
    turns,
    records: filled.records,
    meter: filled.meter,
    drain: (ms = 10000) => background.drain(ms),
    /** A member's request in a home, as the chat routes make it. */
    as: (userId, homeId) => memberOptions({ userId, homeId })
  };
}

/**
 * People of a test's own, with names, and a home of its own they are members of (owner first), removed with it.
 * @param {{ knex: import("knex").Knex, cleanup: { after: (work: () => unknown) => void } }} kit
 * @param {string[]} names
 * @returns {Promise<{ homeId: string, people: string[] }>}
 */
export async function homeOfPeople({ knex, cleanup }, names) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const rows = await knex("users").insert(names.map((name) => ({
    auth_provider: "test",
    auth_provider_user_sid: `${name}-${stamp}`,
    email: `${name.toLowerCase()}-${stamp}@example.com`,
    username: `${name.toLowerCase()}${stamp}`,
    display_name: name
  }))).returning("id");
  const people = rows.map((row) => String(row.id));
  const [home] = await knex("workspaces").insert({ slug: `turns-${stamp}`, name: "Turns test", owner_user_id: people[0], is_personal: false }).returning("id");
  await knex("workspace_memberships").insert(people.map((userId, index) => ({
    workspace_id: home.id, user_id: userId, role_sid: index ? "member" : "owner", status: "active"
  })));
  await knex("workspace_settings").insert({ workspace_id: home.id });
  cleanup.after(async () => {
    await knex("workspaces").where({ id: home.id }).del();
    await knex("users").whereIn("id", people).del();
  });
  return { homeId: String(home.id), people };
}

/** Bots of a home, made by `madeBy`, in the order named; their ids. */
export async function botsOf({ knex }, homeId, madeBy, names) {
  const rows = await knex("bots").insert(names.map((name) => ({ made_by: madeBy, workspace_id: homeId, name, color: "#1E86FC" }))).returning("id");
  return rows.map((row) => String(row.id));
}
