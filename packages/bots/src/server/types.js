// The types of the `mercbot.bots` and `mercbot.bot-loops` capabilities, for features that require
// them, and of what the bot tool modules share.

/** @typedef {ReturnType<typeof import("./botsService.js").createBotsService>} Bots */
/** @typedef {ReturnType<typeof import("./botLoops.js").createBotLoops>} BotLoops */
/** @typedef {ReturnType<typeof import("./approvals.js").createApprovals>} Approvals */
/** @typedef {ReturnType<typeof import("./botRequests.js").createBotRequests>} BotRequests */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions the call's options: a request's, or a job's */

/**
 * Whose connected accounts a turn may use (D-37): the person's own and the home's, or in a shared
 * bot's room only the home's.
 * @typedef {{ userId: string, homeId: string, personal: boolean }} Reach
 */
/**
 * What a tool asks connectedKey() with: the integrations, whose accounts, the apps the person
 * switched this action off for, the turn's call options, and whether only the person's own
 * accounts count (not the home's).
 * @typedef {{ integrations: import("@local/integrations/server/types").Integrations, reach: Reach, skip?: string[], call: CallOptions, own?: boolean }} AppAccess
 */
/** @typedef {(toolId: string) => AppAccess} AppFor */
/** @typedef {(actionId: string, input: object, lead?: string) => Promise<object>} AttemptAction */
/** @typedef {(error: Error) => { error: string }} ToolFailure */
/** @typedef {<T>(work: Promise<T> | T, what: string) => Promise<T>} InTime */
/** @typedef {(what: string) => import("zod").ZodType} AccountField */

/** @typedef {{ homeId: string, botId: string, userId: string }} Place */
/** @typedef {ReturnType<import("@local/files/server/types").Files["apps"]["session"]>} OfficeSession */
/** @typedef {(text: string, once?: string) => Promise<void>} PostLead */
/** @typedef {(bot: string, task: string) => Promise<{ error?: string, target?: { name: string } }>} HandOff */
/** @typedef {(text: string) => Promise<object>} RequestReply */
/**
 * What a turn may do about requests between bots (D-46); answer and askBack are null unless the
 * bot is working on a request, answerBot unless it asked one that put a question back.
 * @typedef {{ ask: (bot: string, brief: string) => Promise<{ error?: string, target?: { name: string } }>,
 *   answer: RequestReply | null, askBack: RequestReply | null, answerBot: RequestReply | null }} RequestTools
 */
/** @typedef {(messageId: string, input: { action: string }) => Promise<{ messages: object[] }>} SettleDraft */
/** @typedef {{ home: string, note: (text: string) => Promise<{ id?: string, error?: string }> }} Notebook */

/** @typedef {ReturnType<typeof import("./records/directory.js").createBotDirectory>} BotDirectory */
/** @typedef {ReturnType<typeof import("./records/workRepository.js").createWorkRepository>} WorkRepository */
/** @typedef {ReturnType<typeof import("./records/policyRepository.js").createPolicyRepository>} PolicyRepository */
/** @typedef {ReturnType<typeof import("./records/followUpRepository.js").createFollowUpRepository>} FollowUpRepository */
/** @typedef {ReturnType<typeof import("./records/turnRepository.js").createTurnRepository>} TurnRepository */
/**
 * The bots' tables (`mercbot.bots.records`, records/BotRecordsFeature.js): the directory other features read, the
 * conversations' and messages' repositories, the bots a person made across homes, the bots' work (requests, routines,
 * cards) and policies, the connect follow-ups, what a turn reads beside its conversation, a bot made from a template
 * opening its chat, and agent-runtime's stores.
 * @typedef {{
 *   directory: BotDirectory,
 *   conversations: ReturnType<typeof import("./records/conversationRepository.js").createConversationRepository>,
 *   messages: ReturnType<typeof import("./records/messageRepository.js").createMessageRepository>,
 *   makers: ReturnType<typeof import("./records/makerRepository.js").createMakerRepository>,
 *   work: WorkRepository,
 *   followUps: FollowUpRepository,
 *   policies: PolicyRepository,
 *   turns: TurnRepository,
 *   templates: ReturnType<typeof import("./records/templateRepository.js").createTemplateRepository>,
 *   agent: { createRuns: Function, createSummaries: Function, createGoals: Function }
 * }} BotRecords
 */
/**
 * The templates links open, beside Mercbot's own (`mercbot.template-links`, optional: a copy built on Mercbot provides
 * it). `find` answers the template a link's code names, in the gallery's shape (templates.js: slug, name, color, shape,
 * description, creator, greeting, instructions, skills each with name, description and instructions, routines, apps,
 * updatedAt), or null; it reads with the request's own options, whose person may be no one.
 * @typedef {{ find: (code: string, options: CallOptions) => Promise<object | null> }} TemplateLinks
 */
/**
 * A skill a copy built on Mercbot adds beside Mercbot's own (`mercbot.added-skills`, optional: such a copy provides a list
 * of them): `file`, a Markdown file in the form of packages/bots/skills (skills.js), listed with them by its file name.
 * @typedef {{ file: string }} AddedSkill
 */
/** @typedef {ReturnType<typeof import("./botConversations.js").createBotConversations>} BotConversations */
/** @typedef {ReturnType<typeof import("./botHistory.js").createBotHistory>} BotHistory */
/** @typedef {ReturnType<typeof import("./backgroundWork.js").createBackgroundWork>} BackgroundWork */
/**
 * A routine's or an Apps task's run, held through its lease (runLease.js routineCheckpoint, jobCheckpoint): the steps an earlier
 * server saved, `save` to keep more, `givenUp` once its servers stopped too often, `signal`, which aborts when the run must
 * stop (its lease is lost or handed over), `end` to end it (null when it isn't this server's any more) and `settle`, the
 * same inside the transaction that posts the result, answering what ending it adds to the chat and throwing RunTakenOver
 * when another server holds it.
 * @typedef {{
 *   what: string,
 *   steps: object[],
 *   givenUp: boolean,
 *   signal: AbortSignal | null,
 *   save: (steps: object[]) => Promise<void>,
 *   end: (outcome: { failed: boolean }, options: object) => Promise<{ paused: boolean, messages: object[] } | null>,
 *   settle: (options: object, outcome: { failed: boolean }) => Promise<object[]>
 * }} RunCheckpoint
 */
/** @typedef {ReturnType<typeof import("./runLease.js").keepLease>} RunLease */
/**
 * A run a background runner has going (runLease.js handOverRuns): its lease, and how to end that
 * lease at once when the run is handed over.
 * @typedef {{ lease: RunLease, release: () => Promise<unknown> }} RunningRun
 */
/** @typedef {ReturnType<typeof import("./botTurns.js").createBotTurns>} BotTurns */
/** @typedef {ReturnType<typeof import("@jskit-ai/agent-runtime/server").createGoals>} Goals */
/** @typedef {typeof import("@jskit-ai/agent/server").SUMMARY_LIMITS} SummaryLimits */
/** @typedef {ReturnType<typeof import("./model.js").createChatModel>} ChatModel */

export {};
