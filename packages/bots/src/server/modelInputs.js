// Every path that builds a model's input (R12, D-112), in one table: the file, how many of each model call it makes,
// what the model reads there and its reach. tests/server/modelInputPaths.test.js scans the source for model calls and
// fails on a call site that has no row here, or a row whose counts no longer match: a new model call starts here.
//
// Reach is what decides privacy, and the model's reader decides it in one place (records/rowPolicies.js):
// - "reader": it reads through the model's reader for one bot in one chat, so it reaches the chats in
//   `readable_from(chat)` and the home's own things, never another chat because of who asked;
// - "public": made for the whole home (a template draft), it reads as a public chat does: public chats only;
// - "none": it reads no chat, only what its caller hands it (the asker's words, one picture, the bot's instructions).
// Step 2 of D-112 (agent A) moves every "reader" path onto `records.readers.forBot`; the canary
// (tests/server/glassWall.integration.js) proves each.

/** The calls the scan counts: each a model call whose input a path builds. */
export const MODEL_CALLS = Object.freeze(["generateOnce", "generateText", "streamText", "runLoop", "createSummaries", "createGoals", "chat/completions"]);

/**
 * @typedef {{ file: string, calls: Readonly<Record<string, number>>, path: string, reads: string, reach: "reader" | "public" | "none" }} ModelInput
 * @type {ReadonlyArray<ModelInput>}
 */
export const MODEL_INPUTS = Object.freeze([
  {
    file: "packages/bots/src/server/botAgent.js",
    calls: { generateOnce: 1, runLoop: 1 },
    path: "A bot's reply in a chat (generateReply, one builder for a chat of one bot or several), its checks and closing account; lookAtPicture",
    reads: "the chat's messages and summary, the state note, Knowledge, and every tool result; one picture the turn already has",
    reach: "reader"
  },
  {
    file: "packages/bots/src/server/joiningIn.js",
    calls: { generateOnce: 1 },
    path: "Bots joining in when useful (D-115): one judgement on a person's message that calls no bot, in a chat of several people with the setting on",
    reads: "the chat's latest text messages, clipped, and its bots' names and jobs, through the chat's own reader",
    reach: "reader"
  },
  {
    file: "packages/bots/src/server/botHistory.js",
    calls: { createSummaries: 1 },
    path: "Compaction: a chat's summary between turns, one per chat",
    reads: "the chat's own messages and its earlier summary",
    reach: "reader"
  },
  {
    file: "packages/bots/src/server/chatTurns.js",
    calls: { createGoals: 1 },
    path: "Goal rounds of a bot in a chat",
    reads: "the goal and the chat it belongs to, as a reply does",
    reach: "reader"
  },
  {
    file: "packages/bots/src/server/records/BotRecordsFeature.js",
    calls: { createSummaries: 1, createGoals: 1 },
    path: "agent-runtime's summary and goal stores, built for botHistory.js and chatTurns.js",
    reads: "nothing itself: the stores' owners above build the input",
    reach: "reader"
  },
  {
    file: "packages/bots/src/server/roomsMemory.js",
    calls: { generateOnce: 1 },
    path: "A bot's rooms memory: its digest of the home's public chats it's in (D-113), refreshed in the background",
    reads: "the bot's earlier digest and its public chats' new lines, through the memory's reader (records.readers.forHome)",
    reach: "public"
  },
  {
    file: "packages/bots/src/server/approvals.js",
    calls: { generateOnce: 1 },
    path: "The approvals rule matcher",
    reads: "the action asked for and the asker's own rules in the home",
    reach: "none"
  },
  {
    file: "packages/bots/src/server/botWriting.js",
    calls: { generateOnce: 3 },
    path: "A new bot's greeting and first question, a step's activity line, answerAsBot (a copy's template descriptions)",
    reads: "the bot's instructions and the words its caller hands it",
    reach: "none"
  },
  {
    file: "packages/bots/src/server/scriptWriter.js",
    calls: { generateOnce: 1 },
    path: "An app script's writing rounds",
    reads: "the app's tables and the bot's request for the script",
    reach: "none"
  },
  {
    file: "packages/bots/src/server/templateDrafts.js",
    calls: { generateOnce: 1 },
    path: "Template drafts from a bot, for the whole home",
    reads: "the bot's instructions, Knowledge and public chats, never a private chat's summary",
    reach: "public"
  },
  {
    file: "packages/bots/src/server/handOverNotes.js",
    calls: { generateOnce: 1 },
    path: "Continue with others…: the hand-over note a direct chat's bot writes for a new chat (D-114)",
    reads: "the direct chat's newest page as people see it (text, a card's one line, attachments by name), never a " +
      "tool result, a routine's prompt or the chat's summary",
    reach: "reader"
  },
  {
    file: "packages/computer/src/server/stagehandModel.js",
    calls: { "chat/completions": 1 },
    path: "Stagehand's model driving a chat's computer",
    reads: "the page on the computer of the bot in that chat, and the step the bot asked for",
    reach: "none"
  }
]);
