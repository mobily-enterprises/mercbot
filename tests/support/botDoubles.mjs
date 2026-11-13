// Collaborators for tests that build the bots service or one reply's tools without the features
// around them. Each neutral double stands for a home with nothing set up: no computer, nothing
// connected, no files, no apps, no other bot to ask. A test passes the parts it exercises (a real
// file store, a computer that answers) and the rest are filled in, member by member.
import { createMeter } from "../../packages/account/src/server/meter.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { NO_TEMPLATE_LINKS } from "../../packages/bots/src/server/botTemplates.js";
import { createChatModel } from "../../packages/bots/src/server/model.js";
import { isPagePath } from "../../packages/files/src/server/pageDocument.js";

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
    pausedMessage: async () => null
  }),
  notices: () => ({ publish: async () => {}, publishEach: async () => {}, subscribe: () => () => {} }),
  computer: () => ({
    hold: async () => {},
    status: async () => null,
    screenshot: async () => null,
    act: missing("computer"),
    browse: missing("computer"),
    fill: missing("computer"),
    startRecording: missing("computer"),
    stopRecording: missing("computer")
  }),
  integrations: () => ({
    skills: async () => [],
    skillNames: async () => [],
    reachableAccounts: async () => [],
    hasConnected: async () => false,
    accountLabels: async () => [],
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [] }),
    app: () => null,
    appName: (id) => id,
    appNamed: () => null,
    // No sign-in finishes here, so no connect follow-up is ever marked by one.
    connections: { accessToken: missing("connected account"), whenConnected: () => () => {} },
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
    }
  }),
  apps: () => ({
    // No apps in the home: none found by id (a Builder room) or by a search.
    apps: { builder: async () => null, findApp: async () => null, searchViews: async () => [], queueTask: missing("apps") },
    registry: {},
    gate: {},
    watches: {},
    scripts: {}
  })
};

// What one reply's tools keep and read through their owners, with nothing kept: no routines, memories, notes, messages,
// groups or saved logins, a to-do card nobody wrote, nobody's name, and no other bot in the home.
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
      memoryFacts: async () => [],
      rememberFact: missing("memory store"),
      forgetFact: missing("memory store"),
      addNote: missing("notebook"),
      recentNotes: async () => [],
      recentGroupsOf: async () => [],
      planning: () => ({ currentTodos: async () => undefined, mergeTodos: missing("to-do card"), jobNotes: async () => null, setJobNotes: missing("job notes") })
    },
    directory: { findBot: async () => null, listHomeBots: async () => [] }
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
