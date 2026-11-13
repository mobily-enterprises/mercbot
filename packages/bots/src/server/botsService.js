import { generateReply, generateGroupReply } from "./botAgent.js";
import { describeActivity, writeSkillFromDemo } from "./botWriting.js";
import { unsupportedClaims } from "@jskit-ai/agent/server";
import { currentWork } from "@local/account/meter";
import { GOAL_LIMITS } from "@jskit-ai/agent-runtime/server";
import { REQUEST_LIMITS, createBotRequests } from "./botRequests.js";
import { createBotConversations } from "./botConversations.js";
import { createBotHistory } from "./botHistory.js";
import { createBackgroundWork } from "./backgroundWork.js";
import { createBotCards } from "./botCards.js";
import { createBotTurns } from "./botTurns.js";
import { createGroupReplies } from "./groupReplies.js";
import { createBotReplies } from "./botReplies.js";
import { createBotList } from "./botList.js";
import { createBotSettings } from "./botSettings.js";
import { createBotChat } from "./botChat.js";
import { createBotTemplates } from "./botTemplates.js";
import { createBotTeaching } from "./botTeaching.js";
import { createBotGroups } from "./botGroups.js";
import { createBotLibrary } from "./botLibrary.js";
import { createBotMemory } from "./botMemory.js";

/**
 * The bots service (`mercbot.bots`): the person's bots and everything said and done in them, composed from one factory per
 * concern. Every read and write goes through mercbot.bots.records and the other owners' capabilities with the call's
 * options; background work (requests, goals, routines, Apps tasks, resumed replies) runs as a job for one person in
 * its home, from the bots' system context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records: the bots' tables
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context (BotsFeature's systemScope)
 * @param {{ findById: (userId: string, options: object) => Promise<object | null> }} dependencies.profiles users.profiles
 * @param {{ findById: (workspaceId: string, options: object) => Promise<object | null> }} dependencies.workspaces the workspaces' records
 * @param {import("@local/account/server/types").Account} dependencies.account mercbot.account: saved logins, the meter's spend
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").ChatModel} dependencies.model the chat model every bot call uses
 * @param {import("./types.js").Approvals} dependencies.approvals
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("@local/files/server/types").Files} dependencies.files
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("./types.js").TemplateLinks} dependencies.templateLinks the templates links open
 *   (`mercbot.template-links`, or NO_TEMPLATE_LINKS)
 * @param {typeof import("./botAgent.js").generateReply} [dependencies.reply] a bot's reply in its own chat
 * @param {typeof import("./botAgent.js").generateGroupReply} [dependencies.groupReply] a bot's reply in a group
 * @param {((text: string, record: string) => Promise<string[]>) | null} [dependencies.checkClaims] the final-reply check, or null
 * @param {(bot: object, userMessage: object) => Promise<{ status: string, emoji: string | null }>} [dependencies.activity] the status line
 *   and the bot's reaction
 * @param {(lines: string[]) => Promise<object>} [dependencies.writeSkill] the skill a demonstration teaches
 * @param {(input: { previous: string, text: string }) => Promise<string>} [dependencies.summarize] replaces the summary's model call
 * @param {import("./types.js").SummaryLimits} [dependencies.compactionLimits] replaces the summary limits
 * @param {Partial<typeof import("./botRequests.js").REQUEST_LIMITS>} [dependencies.requestLimits] limits over the requests' own
 * @param {Partial<typeof import("@jskit-ai/agent-runtime/server").GOAL_LIMITS>} [dependencies.goalLimits] limits over the goals' own
 */
export function createBotsService({
  records,
  systemContext,
  profiles,
  workspaces,
  account,
  env,
  model,
  approvals,
  meter,
  computer,
  notices,
  integrations,
  files,
  apps,
  templateLinks,
  reply = generateReply,
  groupReply = generateGroupReply,
  checkClaims = reply === generateReply ? (text, record) => unsupportedClaims({ model, reply: text, record }) : null,
  activity = (bot, userMessage) => describeActivity(model, bot, userMessage),
  writeSkill = (lines) => writeSkillFromDemo(model, lines),
  summarize,
  compactionLimits,
  requestLimits,
  goalLimits
}) {
  const conversations = createBotConversations({ records, notices });
  const background = createBackgroundWork();
  const chatHistory = createBotHistory({
    records,
    model,
    meter,
    notices,
    conversations,
    summarize,
    compactionLimits,
    background: background.add
  });
  /**
   * A background turn's call options: a job for the person in their home, from the bots' system context.
   * @param {object} system
   * @param {string} home
   * @param {string} person
   */
  const jobFor = (system, home, person) => ({
    context: system.forWorkspaceUser(String(home), String(person), { actorId: String(person) })
  });

  // Bots asking bots (D-46): botRequests.js keeps each request and runs its steps.
  const requests = createBotRequests({
    work: records.work,
    directory: records.directory,
    profiles,
    systemContext,
    notices,
    meter,
    rowOf: conversations.rowOf,
    append: conversations.append,
    tell: conversations.tell,
    claimReply: chatHistory.claimReply,
    runs: chatHistory.runs,
    // Late-bound, a cycle: the reply engine below works on requests, and a request's step replies through it.
    respond: (row, options) => replies.respond(row, options),
    background: background.add,
    ...(requestLimits ? { limits: { ...REQUEST_LIMITS, ...requestLimits } } : {})
  });

  // Goals and goal rounds (D-48, @jskit-ai/agent-runtime goals): a multi-step job carries on until it's done,
  // its events shown as goal lines in the chat.
  // A goal's rounds run for its person in its home; the rows they're handed are that person's (row.workspace_id, row.user_id).
  const goalCall = (home, person) => jobFor(systemContext("goal rounds"), home, person);
  const rowCall = (row) => goalCall(row.workspace_id, row.user_id);
  const goals = records.agent.createGoals({
    runs: chatHistory.runs,
    notices,
    find: (goal) => conversations.rowOf(String(goal.bot_id), String(goal.conversation_id), goalCall(goal.workspace_id, goal.user_id)),
    // Late-bound, a cycle: the reply engine below runs goals, and a goal round replies through it.
    respond: (row, options) => replies.respond(row, { ...options, call: rowCall(row) }),
    claim: chatHistory.claimReply,
    record: (row, { text, detail }) =>
      conversations.append(row, [{ kind: "event", role: "system", body: { text, icon: "goal", detail } }], rowCall(row)),
    notify: (row, event) => conversations.tell(row, event, rowCall(row)),
    owner: (row) => ({ workspace_id: row.workspace_id, bot_id: row.id, user_id: row.user_id }),
    // What a job has spent on the model: this person's use of this bot since the goal began.
    spent: async (goal) =>
      Number(await meter.spentSince(
        { workspaceId: String(goal.workspace_id), userId: String(goal.user_id), botId: String(goal.bot_id), since: goal.created_at },
        goalCall(goal.workspace_id, goal.user_id)
      )) || 0,
    track: (goal, run) => meter.track({ userId: goal.user_id, botId: String(goal.bot_id), work: "background" }, run),
    background: background.add,
    ...(goalLimits ? { limits: { ...GOAL_LIMITS, ...goalLimits } } : {})
  });

  const cards = createBotCards({ records, env, account, computer, integrations, conversations, requests });
  const turns = createBotTurns({
    records,
    profiles,
    workspaces,
    account,
    env,
    model,
    approvals,
    computer,
    integrations,
    files,
    apps,
    conversations,
    requests,
    cards
  });
  // Every reply, the stand-ins' too, is handed the chat model.
  const groupReplies = createGroupReplies({
    records,
    computer,
    conversations,
    chatHistory,
    turns,
    groupReply: (bot, options) => groupReply(bot, { ...options, languageModel: model })
  });
  const replies = createBotReplies({
    records,
    systemContext,
    meter,
    computer,
    conversations,
    chatHistory,
    background,
    requests,
    goals,
    turns,
    groupReplies,
    // The Builder making apps runs as "build" (D-59), unless it's already background work.
    reply: (bot, timeline, tools, state, prompt, options) =>
      meter.track({ work: bot.isBuilder && currentWork() === "chat" ? "build" : currentWork() }, () =>
        reply(bot, timeline, tools, state, prompt, { ...options, languageModel: model })),
    checkClaims,
    jobs: apps?.jobs ?? null
  });
  // A sign-in finishing on this server marks the connect follow-ups it reaches, as it is saved, and starts them here.
  integrations.connections.whenConnected(replies.connectFollowUps.connected);
  const botList = createBotList({ records, conversations });
  const settings = createBotSettings({ records, conversations, apps });
  const chat = createBotChat({ records, model, integrations, conversations, goals, activity, pausedMessage: meter.pausedMessage });
  const templates = createBotTemplates({ records, profiles, integrations, conversations, env, templateLinks });
  const teaching = createBotTeaching({ records, computer, integrations, conversations, background, writeSkill });
  const groups = createBotGroups({ records, conversations });
  const library = createBotLibrary({ records, conversations, apps, files });
  const memory = createBotMemory({ records, conversations });

  return Object.freeze({
    compaction: chatHistory.compaction,
    requests,
    goals,
    startResumer: replies.startResumer,
    resumeStalled: replies.resumeStalled,
    connectFollowUps: replies.connectFollowUps,
    connectFromCard: replies.connectFollowUps.connectFromCard,
    cancelRequest: cards.cancelRequest,
    listBots: botList.listBots,
    listedBot: botList.listedBot,
    ensureFirstBot: botList.ensureFirstBot,
    createBot: botList.createBot,
    answerChoice: cards.answerChoice,
    settleHandover: cards.settleHandover,
    templateGallery: templates.templateGallery,
    templateChecks: templates.templateChecks,
    templateDetails: templates.templateDetails,
    addFromTemplate: templates.addFromTemplate,
    messages: chat.messages,
    findOlder: chat.findOlder,
    advanceOnboarding: chat.advanceOnboarding,
    chooseName: chat.chooseName,
    sendMessage: chat.sendMessage,
    skillsFor: chat.skillsFor,
    settleDraft: cards.settleDraft,
    library: library.library,
    pinItem: library.pinItem,
    deletePage: library.deletePage,
    settleSecureForm: cards.settleSecureForm,
    memories: memory.memories,
    forgetMemory: memory.forgetMemory,
    replyTo: replies.replyTo,
    describeWork: chat.describeWork,
    answerOnce: chat.answerOnce,
    react: chat.react,
    updateBot: settings.updateBot,
    notebook: memory.notebook,
    removeNote: memory.removeNote,
    createRoom: settings.createRoom,
    roomForApp: settings.roomForApp,
    renameRoom: settings.renameRoom,
    deleteBot: settings.deleteBot,
    runRoutine: replies.runRoutine,
    runAppTask: replies.runAppTask,
    drain: background.drain,
    recordVoiceCall: chat.recordVoiceCall,
    search: library.search,
    createGroup: groups.createGroup,
    addMember: groups.addMember,
    removeMember: groups.removeMember,
    addPerson: groups.addPerson,
    removePerson: groups.removePerson,
    startTeaching: teaching.startTeaching,
    stopTeaching: teaching.stopTeaching,
    routines: memory.routines,
    // readable-check: allow setter-seam - not a slot: switches a routine off or on
    setRoutineEnabled: memory.setRoutineEnabled,
    deleteRoutine: memory.deleteRoutine,
    reorderPins: botList.reorderPins,
    createSection: botList.createSection,
    updateSection: botList.updateSection,
    moveSection: botList.moveSection,
    deleteSection: botList.deleteSection
  });
}
