import { describeActivity, writeSkillFromDemo } from "./botWriting.js";
import { createBackgroundWork } from "./backgroundWork.js";
import { createChatMembers } from "./chatMembers.js";
import { createOnboarding } from "./onboarding.js";
import { createChatTurns } from "./chatTurns.js";
import { createChatRoutines } from "./chatRoutines.js";
import { createBotKnowledge } from "./botKnowledge.js";
import { createBotList } from "./botList.js";
import { createBotTemplates } from "./botTemplates.js";
import { createBotSettings } from "./botSettings.js";
import { createBotArchive } from "./botArchive.js";
import { createBotTeams } from "./botTeams.js";
import { createBotLibrary } from "./botLibrary.js";
import { createBotPlans } from "./botPlans.js";
import { createTemplateDrafts, writeWith } from "./templateDrafts.js";
import { createBotTeaching } from "./botTeaching.js";

/**
 * The bots service (`mercbot.bots`): the home's bots and its chats, and everything said and done in them (D-112),
 * composed from one factory per concern: the chats and their members (chatMembers.js), the welcome chat's steps
 * (onboarding.js), the turns (chatTurns.js: messages, replies, cards, requests, goals, routines and background runs),
 * the Team page's surfaces (the bot list, templates, settings, archive, teams, the Library, knowledge, Add bots'
 * plans, drafted templates), the routines lists (chatRoutines.js) and teaching (botTeaching.js). Every read and write
 * goes through mercbot.bots.records and the other owners' capabilities with the call's options; background work
 * (requests, goals, routines, Apps tasks, resumed replies) runs as a job for one person in its home, from the bots'
 * system context.
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
 * @param {typeof import("./botAgent.js").generateReply} [dependencies.reply] a bot's reply in a chat (the turns')
 * @param {((text: string, record: string) => Promise<string[]>) | null} [dependencies.checkClaims] the final-reply check, or null
 * @param {(bot: object, userMessage: object) => Promise<{ status: string, emoji: string | null }>} [dependencies.activity] the status line
 *   and the bot's reaction
 * @param {(lines: string[]) => Promise<object>} [dependencies.writeSkill] the skill a demonstration teaches
 * @param {(system: string, messages: Array<{ role: string, content: string }>) => Promise<string>} [dependencies.writeTemplate]
 *   the model's answer to one call drafting a template
 * @param {(system: string, messages: Array<{ role: string, content: string }>) => Promise<string>} [dependencies.writePlan]
 *   the model's answer to one call suggesting bots (D-109)
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
  reply,
  checkClaims,
  activity = (bot, userMessage) => describeActivity(model, bot, userMessage),
  writeSkill = (lines) => writeSkillFromDemo(model, lines),
  writeTemplate = writeWith(model),
  writePlan = writeWith(model),
  summarize,
  compactionLimits,
  requestLimits,
  goalLimits
}) {
  // One queue of work left running after a request answers (summaries, teaching, indexing): drain waits for all of it.
  const background = createBackgroundWork();
  // Chats and their members (D-112, R2): the chat routes' service, and every chat a turn answers with.
  // Archiving a chat pauses its work with the turns' pauseWork; the turns are made after, as they answer with these chats.
  const chats = createChatMembers({ records, notices, computer, systemContext, pauseWork: (...args) => turns.pauseWork(...args) });
  // The welcome chat's steps and a new bot's greeting (B): the turns tell it of messages and answers in such a chat.
  const onboarding = createOnboarding({ records, chats, model, meter, notices, workspaces });
  // What each bot knows (D-107): its Details section, and what its turns keep in mind and search.
  const knowledge = createBotKnowledge({ records, files, meter, env, systemContext });
  const turns = createChatTurns({
    records,
    systemContext,
    profiles,
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
    knowledge,
    chats,
    background,
    onboarding,
    // Left out (undefined), each takes the turns' own default: the agent's reply, and its claims check.
    reply,
    checkClaims,
    activity,
    summarize,
    compactionLimits,
    requestLimits,
    goalLimits
  });
  // A sign-in finishing on this server marks the connect follow-ups it reaches, as it is saved, and starts them here.
  integrations.connections.whenConnected(turns.connectFollowUps.connected);

  // The Team page: the home's bots, made from templates or described, changed, archived, in teams, and what they made.
  const botList = createBotList({ records, apps, notices });
  const templates = createBotTemplates({ records, profiles, integrations, env, templateLinks, botList });
  const settings = createBotSettings({ records, computer, notices, tellHome: botList.tellHome, listedBot: botList.listedBot });
  const archive = createBotArchive({
    records,
    apps,
    computer,
    pauseWork: turns.pauseWork,
    tellHome: botList.tellHome,
    listedBot: botList.listedBot
  });
  const teams = createBotTeams({ records, botList, templates, onboarding, notices });
  const library = createBotLibrary({ records, apps, files });
  // Add bots' suggestions (D-109): what the home has, and the chat model's plan.
  const plans = createBotPlans({ records, workspaces, meter, write: writePlan });
  // A template drafted from a bot reads the newest summary of a chat it's in that the person may read.
  const drafts = createTemplateDrafts({ records, meter, summaryOf: turns.summaryOf, write: writeTemplate });
  const routines = createChatRoutines({ records });
  // Teaching a bot on its computer in a chat (C): a recording, then the skill it teaches.
  const teaching = createBotTeaching({ records, computer, integrations, notices, background, writeSkill });

  /**
   * A change of the home's people (BotsFeature, as members join and leave): who joined is seated in its everyone chat
   * and who left is out of its chats (chatMembers.js homeChanged, R2), and the routines and watches they made there
   * pause, with a line in each chat, since they ran as them (R4).
   * @param {string} homeId
   */
  async function homeChanged(homeId) {
    return chats.homeChanged(homeId, { leaving: (userId, home) => pauseWhatTheyMade(userId, homeId, home) });
  }

  // All of it or none, so a failure leaves it to the next change, with its line.
  async function pauseWhatTheyMade(userId, homeId, home) {
    const name = (await profiles.findById(userId, home))?.displayName || "Someone";
    await records.chats.withTransaction(home, (txOptions) => turns.pauseMadeBy({ userId, homeId }, {
      text: "Paused: its maker left",
      detail: (paused) => `${name} left the home, so the ${paused} they made paused.`
    }, txOptions));
  }

  return Object.freeze({
    chats,
    homeChanged,
    // A chat's own routes (registerRoutes.js `bots.chat.*`): the turns', the welcome chat's, routines' and teaching's.
    chat: Object.freeze({
      ...turns.chat,
      welcome: onboarding.welcome,
      advanceOnboarding: onboarding.advance,
      chooseName: onboarding.chooseName,
      routinesIn: routines.routinesIn,
      routinesOf: routines.routinesOf,
      switchRoutine: routines.switchRoutine,
      deleteRoutine: routines.deleteRoutine,
      startTeaching: teaching.startTeaching,
      stopTeaching: teaching.stopTeaching
    }),
    skillsFor: turns.skillsFor,
    answerOnce: turns.answerOnce,
    cancelRequest: turns.cancelRequest,
    // The background loops' (botLoops.js).
    compaction: turns.compaction,
    requests: turns.requests,
    goals: turns.goals,
    startResumer: turns.startResumer,
    resumeStalled: turns.resumeStalled,
    connectFollowUps: turns.connectFollowUps,
    runRoutine: turns.runRoutine,
    runAppTask: turns.runAppTask,
    drain: background.drain,
    knowledge: Object.freeze({
      list: knowledge.list,
      read: knowledge.read,
      add: knowledge.add,
      change: knowledge.change,
      remove: knowledge.remove,
      retry: knowledge.retry,
      runDue: knowledge.indexer.runDue,
      start: knowledge.indexer.start
    }),
    listBots: botList.listBots,
    listedBot: botList.listedBot,
    createBot: templates.createBot,
    templateGallery: templates.templateGallery,
    templateChecks: templates.templateChecks,
    templateDetails: templates.templateDetails,
    addFromTemplate: templates.addFromTemplate,
    changeTemplate: templates.changeTemplate,
    instructionsOf: templates.instructionsOf,
    homeTemplates: templates.homeTemplates,
    homeTemplate: templates.homeTemplate,
    editHomeTemplate: templates.editHomeTemplate,
    deleteHomeTemplate: templates.deleteHomeTemplate,
    updateBot: settings.updateBot,
    deleteBot: settings.deleteBot,
    archiveBot: archive.archiveBot,
    unarchiveBot: archive.unarchiveBot,
    teamFor: teams.teamFor,
    addTeam: teams.addTeam,
    addBots: teams.addBots,
    proposeBots: plans.propose,
    draftTemplate: drafts.draftTemplate,
    library: library.library,
    pinItem: library.pinItem,
    deletePage: library.deletePage,
    search: library.search
  });
}
