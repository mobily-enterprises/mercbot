// Collaborators for tests that build the bots service, its turns in chats (chatTurns.js) or one reply's tools without
// the features around them. Each neutral double stands for a home with nothing set up: no computer, nothing connected,
// no files, no apps, no other bot to ask. A test passes the parts it exercises (a real file store, a computer that
// answers) and the rest are filled in, member by member.
import { estimateAtProvider } from "../../packages/account/src/server/cost.js";
import { createMediaGuard } from "../../packages/account/src/server/mediaCheck.js";
import { createMeter } from "../../packages/account/src/server/meter.js";
import { createBackgroundWork } from "../../packages/bots/src/server/backgroundWork.js";
import { createCommonKnowledge } from "../../packages/bots/src/server/commonKnowledge.js";
import { createRoomsMemory } from "../../packages/bots/src/server/roomsMemory.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { createChatMembers } from "../../packages/bots/src/server/chatMembers.js";
import { createChatTurns } from "../../packages/bots/src/server/chatTurns.js";
import { NO_TEMPLATE_LINKS } from "../../packages/bots/src/server/botTemplates.js";
import { createChatModel } from "../../packages/bots/src/server/model.js";
import { createMediaChecks } from "../../packages/files/src/server/mediaChecks.js";
import { isPagePath } from "../../packages/files/src/server/pageDocument.js";
import { memberOptions, startBotParts } from "./botRecords.mjs";
import { cleanupStack } from "./cleanupStack.mjs";
import { connectTestDatabase } from "./testDatabase.mjs";

/** A recorder that records nothing and refuses nothing. */
export const FREE_RECORDER = Object.freeze({
  open: async () => ({ id: "0" }),
  finish: async () => true,
  release: async () => true,
  startComputerDay: async () => null,
  countComputerDay: async () => true,
  computerDay: async () => true,
  startComputation: async () => ({ id: "0" }),
  renewComputation: async () => true,
  finishComputation: async () => true
});

const missing = (what) => async () => {
  throw new Error(`There's no ${what} in this test.`);
};

const neutral = {
  // What work uses is recorded nowhere and the home is never paused.
  meter: () => ({
    ...createMeter({ recorder: FREE_RECORDER }),
    pausedMessage: async () => null,
    // What some tokens would cost, at the provider's list prices, as Mercbot's own recorder answers (D-107).
    estimateNano: estimateAtProvider,
    // A recurring task's runs and costs (D-131) are counted nowhere.
    countTaskRun: async () => true,
    taskCosts: async () => []
  }),
  notices: () => ({ publish: async () => {}, publishEach: async () => {}, subscribe: () => () => {}, onMissed: () => () => {} }),
  // The chats' computers, keyed by the bot's seat in a chat (chat_bots.id, D-112).
  computer: () => ({
    hold: async () => {},
    // No computer is awake, so none is put to sleep, none is left behind by a deleted chat, and no sign-in is noted.
    sleepHome: async () => {},
    chatRemoved: async () => {},
    noteSignIn: async () => {},
    status: async () => null,
    screenshot: async () => null,
    act: missing("computer"),
    browse: missing("computer"),
    fill: missing("computer"),
    code: missing("computer"),
    takeOver: missing("computer"),
    handBack: missing("computer"),
    startRecording: missing("computer"),
    stopRecording: missing("computer")
  }),
  integrations: () => ({
    skills: async () => [],
    skillNames: async () => [],
    reachableAccounts: async () => [],
    namesOf: async () => new Map(),
    hasConnected: async () => false,
    accountLabels: async () => [],
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [], connected: [] }),
    app: () => null,
    appName: (id) => id,
    appNamed: () => null,
    // No sign-in finishes here, so no connect follow-up is ever marked by one.
    // No GitHub App here (D-128): commands never sign in to GitHub.
    connections: { accessToken: missing("connected account"), whenConnected: () => () => {}, github: { ready: () => false } },
    // No app that hosts its own connection point (D-34) is in the catalogue.
    connectors: { apps: () => [], actions: missing("connected app"), use: missing("connected app") },
    createSkill: missing("skill store"),
    updateSkill: missing("skill store"),
    deleteSkill: missing("skill store")
  }),
  files: () => ({
    store: {
      // A place no neutral member reads (there are no files here), not a copy of the store's own.
      placeFor: () => ({}),
      list: async () => ({}),
      existingFile: missing("file"),
      resolve: missing("file store"),
      widened: missing("file store"),
      settle: async () => {},
      move: missing("file store")
    },
    commandOutput: missing("command line"),
    apps: {
      session: () => ({ help: async () => "", call: missing("office app"), close: async () => {} }),
      textOf: missing("office app"),
      voiceMemo: missing("office app"),
      chartImage: missing("office app")
    },
    shell: {
      available: () => false,
      start: missing("command line"),
      check: missing("command line"),
      wholeOutputOf: missing("command line"),
      startSweeping: () => {},
      onEnd: () => () => {}
    },
    // Pages (D-74): which paths are pages, as the files feature says; no page is saved or changed here.
    pages: {
      isPagePath,
      save: missing("pages"),
      edited: async () => null,
      pathChanged: async () => {},
      standalone: missing("pages")
    },
    // No copy's check of pictures and videos (D-90): everything is allowed, and nothing is queued.
    media: createMediaChecks({ guard: createMediaGuard(null), mediaChecks: null, systemContext: null, store: null })
  }),
  apps: () => ({
    // No apps in the home: none found by id (a Builder room) or by a search.
    apps: { builder: async () => null, findApp: async () => null, searchViews: async () => [], queueTask: missing("apps") },
    // A template's tables (D-130) aren't made: a test that needs them passes the real catalog.
    catalog: { ensureTable: async () => ({ table: null, made: [] }), ensureOwnTable: async () => ({ table: null, made: [] }) },
    registry: {},
    gate: {},
    // No watches, so none pauses (an archived bot's, or those of a person who left the home).
    watches: { pauseIn: async () => [] },
    scripts: {}
  })
};

// What one reply's tools keep and read through their owners, with nothing kept: no routines, messages, chats or saved
// logins, a to-do card nobody wrote, nobody's name, and no other bot in the home. The model's reader is a plain
// context here: a test that reads the database passes its own records.
const turnNeutral = {
  records: () => ({
    work: {
      routinesOf: async () => [],
      routineNamed: async () => null,
      createRoutine: missing("routine store"),
      changeRoutine: missing("routine store"),
      deleteRoutine: missing("routine store"),
      patchCards: missing("card store")
    },
    turns: {
      messages: async () => [],
      latestMessage: async () => null,
      planning: () => ({ currentTodos: async () => undefined, mergeTodos: missing("to-do card"), jobNotes: async () => null, setJobNotes: missing("job notes") })
    },
    chats: { readableFrom: async () => [], people: async () => [], bots: async () => [] },
    readers: { forBot: () => ({}), of: () => null },
    directory: { findBot: async () => null, listHomeBots: async () => [], chatBotOf: async () => null }
  }),
  profiles: () => ({ findById: async () => null }),
  account: () => ({ savedLogins: async () => [], savedLogin: async () => null, saveLogin: missing("Vault") }),
  // A call with no one in it: the neutral members read nothing with it, and a test that reads the database passes its own.
  call: () => ({ context: {} })
};

// The bots service's other owners, as BotsFeature is given them, with no one and nothing in them.
const serviceNeutral = {
  profiles: () => ({ findById: async () => null }),
  workspaces: () => ({ findById: async () => null }),
  systemContext: () => () => {
    throw new Error("There's no background work in this test: pass startBotParts(knex, context).");
  }
};

// The service's own collaborators; the reply's turn callbacks and per-turn data come on top.
const SERVICE = ["meter", "notices", "computer", "integrations", "files", "apps"];
const TURN = {
  // Its rooms memory and the home's common knowledge (roomsMemoryTools.js, commonKnowledge.js): no recall, read_chat or
  // share_common_knowledge in a tools test.
  roomsMemoryTools: () => () => ({}),
  commonKnowledgeTools: () => () => ({}),
  handOff: () => async () => ({ error: "There's no other bot to ask in this test." }),
  requestTools: () => ({ ask: async () => ({ error: "There's no other bot to ask in this test." }), answer: null, askBack: null, answerBot: null }),
  settleDraft: () => missing("draft"),
  post: () => async () => {},
  botSkills: () => [],
  goalOperations: () => null,
  inbox: () => null,
  notebook: () => null,
  appsVia: () => null,
  workingRequestId: () => null
};

// One collaborator: the test's own members over the neutral ones (files, apps and connections one level down too).
function complete(name, given) {
  const base = neutral[name]();
  if (given === undefined || given === null) return base;
  const merged = { ...base, ...given };
  for (const part of ["store", "apps", "shell", "pages"]) {
    if (name === "files" && given[part]) merged[part] = { ...base[part], ...given[part] };
  }
  if (name === "apps" && given.apps) merged.apps = { ...base.apps, ...given.apps };
  if (name === "apps" && given.watches) merged.watches = { ...base.watches, ...given.watches };
  if (name === "integrations" && given.connections) merged.connections = { ...base.connections, ...given.connections };
  return merged;
}

/**
 * createBotsService's options with every collaborator the test leaves out (or passes as null) filled in.
 * @param {object} options
 */
export function serviceDoubles(options) {
  // The process's own env, the live object (tests change it), and the chat model made from it, as the feature passes them.
  const filled = { env: process.env, model: createChatModel(process.env), templateLinks: NO_TEMPLATE_LINKS, ...options };
  for (const name of SERVICE) filled[name] = complete(name, options[name]);
  // Without startBotParts (tests/support/botRecords.mjs): nobody's name, no home's name, and no background work.
  for (const [name, make] of Object.entries(serviceNeutral)) if (options[name] === undefined || options[name] === null) filled[name] = make();
  return filled;
}

/**
 * The bots service made from serviceDoubles(options), its background work drained when the test ends and before its
 * database closes, as BotsFeature's shutdown drains it (D-19). A reply leaves work behind it, such as its compaction
 * check: left running, its next query asks the closing Knex pool for a connection, which waits out the pool's 60 s
 * acquire timeout and keeps the file's process alive.
 * @param {{ after: (work: () => unknown) => void }} cleanup the test's cleanups, newest first (cleanupStack), with the
 *   database connection added before this
 * @param {object} options as serviceDoubles takes them
 */
export function startBotsService(cleanup, options) {
  const bots = createBotsService(serviceDoubles(options));
  cleanup.after(() => bots.drain(10000));
  return bots;
}

/**
 * buildTools's options likewise, with the turn callbacks and per-turn data (null when absent) too, and the records,
 * profiles, account and call options the tools read and write through (a test that reads the database passes its own).
 * @param {object} options
 */
export function turnDoubles(options) {
  const filled = { env: process.env, model: createChatModel(process.env), ...options };
  for (const name of ["computer", "integrations", "files", "apps"]) filled[name] = complete(name, options[name]);
  for (const [name, make] of Object.entries({ ...turnNeutral, ...TURN })) if (options[name] === undefined || options[name] === null) filled[name] = make();
  return filled;
}

// What the turns are given beside the service's collaborators, with nothing in them: every action allowed, knowledge
// that knows nothing, and no welcome chat's steps (a test's chats have none).
const turnsNeutral = {
  approvals: () => ({ decide: async () => "allow" }),
  knowledge: () => ({ forTurn: async () => null, stateLines: async () => [], toolsFor: () => ({}) }),
  onboarding: () => ({ afterMessage: async () => ({}), choiceAnswered: async () => ({}) })
};

/**
 * The bots' turns in chats (chatTurns.js) on the test database, for the turn tests: the bots' records and what
 * BotsFeature gives beside them (startBotParts), the chat routes' chats (chatMembers.js), and the neutral doubles for
 * the rest. Also a test's own database connection and its cleanups (newest first): add the rows a test makes to
 * `cleanup` after this, so they go before the connection closes. Drain the background work before reading what the
 * bots said: a reply that outlives its request goes on in it.
 * The bots' rooms memory (roomsMemory.js, D-113) is the real one on the test's records: `writeMemory` stands in for a
 * digest's model call (none is made without it), and `memoryLimits` replaces its limits; `roomsMemory` (the turns' and
 * the chats') is answered for the test to refresh and forget with, and `commonKnowledge` (the home's, which the turns
 * read) for it to list and remove with.
 * @param {import("node:test").TestContext} context
 * @param {object} [options] createChatTurns's collaborators over the neutral ones; `reply` stands in for the model
 */
export async function startChatTurns(context, options = {}) {
  const cleanup = cleanupStack(context);
  const knex = await connectTestDatabase();
  cleanup.after(() => knex.destroy());
  const parts = await startBotParts(knex, cleanup);
  const filled = { env: process.env, model: createChatModel(process.env), ...parts, ...options };
  for (const name of ["notices", "computer", "integrations", "files", "apps"]) filled[name] = complete(name, options[name]);
  for (const [name, make] of Object.entries(turnsNeutral)) filled[name] = options[name] ? { ...make(), ...options[name] } : make();
  const background = createBackgroundWork();
  cleanup.after(() => background.drain(10000));
  const { records, notices, computer, systemContext } = filled;
  const roomsMemory = createRoomsMemory({
    records,
    systemContext,
    workspaces: filled.workspaces,
    model: filled.model,
    meter: filled.meter,
    background,
    write: options.writeMemory ?? (async () => { throw new Error("There's no model in this test: pass writeMemory."); }),
    limits: options.memoryLimits
  });
  // Archiving a chat pauses its work with the turns' pauseWork, and deleting a public chat forgets it, as the bots
  // service wires them.
  const chats = createChatMembers({
    records,
    notices,
    computer,
    systemContext,
    pauseWork: (...args) => turns.pauseWork(...args),
    forget: (botIds, callOptions) => roomsMemory.forget({ botIds }, callOptions)
  });
  const commonKnowledge = createCommonKnowledge({ records });
  const turns = createChatTurns({ ...filled, roomsMemory, commonKnowledge, chats, background });
  return {
    knex,
    cleanup,
    turns,
    chats,
    roomsMemory,
    commonKnowledge,
    records: filled.records,
    meter: filled.meter,
    systemContext: filled.systemContext,
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
