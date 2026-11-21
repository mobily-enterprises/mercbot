import { unsupportedClaims } from "@jskit-ai/agent/server";
import { GOAL_LIMITS } from "@jskit-ai/agent-runtime/server";
import { currentWork } from "@local/account/meter";
import { generateReply } from "./botAgent.js";
import { describeActivity } from "./botWriting.js";
import { REQUEST_LIMITS, createBotRequests } from "./botRequests.js";
import { createBotHistory } from "./botHistory.js";
import { createBotCards } from "./botCards.js";
import { createBotTurns } from "./botTurns.js";
import { createBotReplies } from "./botReplies.js";
import { createBotChat } from "./botChat.js";
import { createBackgroundRuns } from "./backgroundRuns.js";
import { createConnectFollowUps } from "./connectFollowUps.js";
import { createChatSeats } from "./chatSeats.js";
import { createWorkPause } from "./workPause.js";
import { createJoiningIn } from "./joiningIn.js";
import { createDiscussions } from "./discussions.js";

/**
 * The turns of the bots in chats (D-112, step 2's A): who speaks (R3), what each bot reads (D12, R5) and may use (R4),
 * its replies, cards, requests to other bots (O22), goals, routines, Apps tasks, connect follow-ups and the chats'
 * summaries, composed once for botsService.js. Every turn runs through the model's reader for its bot's seat and the
 * person it works for; background work runs as the person who set it up.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context (BotsFeature's systemScope)
 * @param {{ findById: (userId: string, options: object) => Promise<object | null> }} dependencies.profiles users.profiles
 * @param {import("@local/account/server/types").Account} dependencies.account mercbot.account: the home's Vault
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").ChatModel} dependencies.model the chat model every bot call uses
 * @param {import("./types.js").Approvals} dependencies.approvals
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("@local/files/server/types").Files} dependencies.files
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {object} dependencies.knowledge what each bot knows (botKnowledge.js): forTurn, toolsFor, stateLines
 * @param {{ get: (chatId: string, options: object) => Promise<{ chat: object }> }} dependencies.chats chatMembers: a chat
 *   as its page shows it, which the chat's answers carry
 * @param {{ add: (work: Promise<unknown>) => void, drain: (ms: number) => Promise<void> }} dependencies.background the
 *   service's background work (backgroundWork.js), which a stopping server waits for
 * @param {{ afterMessage: Function, choiceAnswered: Function }} dependencies.onboarding the welcome chat's steps (B)
 * @param {typeof generateReply} [dependencies.reply] one bot's reply
 * @param {((text: string, record: string) => Promise<string[]>) | null} [dependencies.checkClaims] the final-reply check
 * @param {(bot: object, userMessage: object) => Promise<{ status: string, emoji: string | null }>} [dependencies.activity]
 *   the status line and the bot's reaction
 * @param {(input: { previous: string, text: string }) => Promise<string>} [dependencies.summarize] replaces the summary's model call
 * @param {import("./types.js").SummaryLimits} [dependencies.compactionLimits]
 * @param {Partial<typeof REQUEST_LIMITS>} [dependencies.requestLimits]
 * @param {Partial<typeof GOAL_LIMITS>} [dependencies.goalLimits]
 * @param {Partial<typeof import("./discussions.js").DISCUSSION_LIMITS>} [dependencies.discussionLimits] a discussion's limits (tests)
 */
export function createChatTurns({
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
  reply = generateReply,
  checkClaims = reply === generateReply ? (text, record) => unsupportedClaims({ model, reply: text, record }) : null,
  activity = (bot, userMessage) => describeActivity(model, bot, userMessage),
  summarize,
  compactionLimits,
  requestLimits,
  goalLimits,
  discussionLimits
}) {
  const seats = createChatSeats({ records, systemContext, notices });
  const workPause = createWorkPause({ records, apps, seats });
  const chatHistory = createBotHistory({
    records,
    systemContext,
    model,
    meter,
    notices,
    summarize,
    compactionLimits,
    background: background.add
  });

  // Bots asking bots (O22): botRequests.js keeps each request and runs its steps.
  const requests = createBotRequests({
    records,
    systemContext,
    notices,
    meter,
    seats,
    claimReply: chatHistory.claimReply,
    runs: chatHistory.runs,
    // Late-bound, a cycle: the replies below work on requests, and a request's step replies through them.
    respond: (seat, options) => replies.respond(seat, options),
    background: background.add,
    ...(requestLimits ? { limits: { ...REQUEST_LIMITS, ...requestLimits } } : {})
  });

  // Goals and goal rounds (D-48, @jskit-ai/agent-runtime goals), one per bot in a chat (its chat_bots id, the runtime's
  // conversation), each for the person who opened it, in its home, through the model's reader.
  const goalSeat = async (goal) =>
    (await seats.backgroundSeat({ chatBotId: goal.conversation_id, homeId: goal.workspace_id, userId: goal.user_id }, "goal rounds"))?.seat ?? null;
  const goals = records.agent.createGoals({
    runs: chatHistory.runs,
    notices,
    find: goalSeat,
    // Late-bound, a cycle: the replies below run goals, and a goal round replies through them.
    respond: (seat, options) => replies.respond(seat, { ...options, call: seats.readerOf(seat) }),
    claim: chatHistory.claimReply,
    record: (seat, { text, detail }) => seats.say(seat, [{ kind: "event", role: "system", body: { text, icon: "goal", detail } }], seats.readerOf(seat)),
    // Its "working" events name the seat's bot, as every working event does (seats.working).
    notify: (seat, event) => (event.type === "working"
      ? seats.working(seat, event.working, event.status, seats.readerOf(seat))
      : seats.tell(seat.chat_id, event, seats.readerOf(seat))),
    owner: (seat) => ({ workspace_id: seat.workspace_id, bot_id: seat.id, user_id: seat.user_id }),
    // What a job has spent on the model: this person's use of this bot since the goal began.
    spent: async (goal) =>
      Number(await meter.spentSince(
        { workspaceId: String(goal.workspace_id), userId: String(goal.user_id), botId: String(goal.bot_id), since: goal.created_at },
        { context: systemContext("goal rounds").forWorkspaceUser(String(goal.workspace_id), String(goal.user_id), { actorId: String(goal.user_id) }) }
      )) || 0,
    track: (goal, run) =>
      meter.track({ userId: String(goal.user_id), botId: String(goal.bot_id), workspaceId: String(goal.workspace_id), work: "background" }, run),
    background: background.add,
    ...(goalLimits ? { limits: { ...GOAL_LIMITS, ...goalLimits } } : {})
  });

  const cards = createBotCards({ records, account, env, computer, integrations, requests, files, seats, chats, onboarding });
  const turns = createBotTurns({
    records,
    knowledge,
    profiles,
    account,
    env,
    model,
    approvals,
    computer,
    integrations,
    files,
    apps,
    requests,
    cards
  });
  const replies = createBotReplies({
    records,
    systemContext,
    meter,
    computer,
    seats,
    chatHistory,
    background,
    requests,
    goals,
    turns,
    // The Builder making apps runs as "build" (D-59), unless it's already background work.
    reply: (bot, timeline, tools, state, prompt, options) =>
      meter.track({ work: bot.isBuilder && currentWork() === "chat" ? "build" : currentWork() }, () =>
        reply(bot, timeline, tools, state, prompt, { ...options, languageModel: model })),
    checkClaims,
    // Late-bound, a cycle: a follow-up replies through the replies, and a reply's end starts a waiting follow-up.
    followUps: () => connectFollowUps,
    // Bots joining in when useful, in a chat that says so (D-115).
    joiningIn: createJoiningIn({ records, meter, model })
  });
  // Discuss (D-115): the bots of a chat talk a question over in rounds, each round from a person's press.
  const discussions = createDiscussions({
    records,
    systemContext,
    meter,
    env,
    seats,
    chatHistory,
    replies,
    background,
    ...(discussionLimits ? { limits: discussionLimits } : {})
  });
  const connectFollowUps = createConnectFollowUps({
    records,
    systemContext,
    seats,
    turns,
    chatHistory,
    meter,
    background,
    runReply: replies.runReply,
    chats
  });
  const runs = createBackgroundRuns({ records, systemContext, meter, seats, jobs: apps?.jobs ?? null, respond: replies.respond });
  const chat = createBotChat({ records, model, integrations, goals, replies, seats, chats, activity, onboarding });

  /** A chat's newest summary, "" for none (templateDrafts.js). */
  async function summaryOf(chatId) {
    return (await chatHistory.compaction.current(String(chatId)))?.summary || "";
  }

  return Object.freeze({
    // The chat routes' turns (registerRoutes.js `bots.chat.*`).
    chat: Object.freeze({
      messages: chat.messages,
      findOlder: chat.findOlder,
      sendMessage: chat.sendMessage,
      reply: chat.reply,
      describeWork: chat.describeWork,
      react: chat.react,
      answerChoice: cards.answerChoice,
      settleHandover: cards.settleHandover,
      settleSecureForm: cards.settleSecureForm,
      connectFromCard: connectFollowUps.connectFromCard,
      settleDraft: cards.settleDraft,
      recordVoiceCall: chat.recordVoiceCall,
      discuss: discussions.propose,
      startDiscussion: discussions.start,
      discussMore: discussions.nextRound,
      wrapUpDiscussion: discussions.wrapUp,
      cancelDiscussion: discussions.cancel,
      stopDiscussion: discussions.stop
    }),
    skillsFor: chat.skillsFor,
    answerOnce: chat.answerOnce,
    cancelRequest: cards.cancelRequest,
    // The background loops' (botLoops.js).
    compaction: chatHistory.compaction,
    requests,
    goals,
    startResumer: replies.startResumer,
    resumeStalled: replies.resumeStalled,
    connectFollowUps,
    runRoutine: runs.runRoutine,
    runAppTask: runs.runAppTask,
    summaryOf,
    // The routines and watches of some bots in chats paused, with a line in each chat (B's archive), and those of a
    // person who left the home (the bots service's homeChanged).
    pauseWork: workPause.pauseWork,
    pauseMadeBy: workPause.pauseMadeBy
  });
}
