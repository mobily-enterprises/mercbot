// The types of the `mercbot.bots` and `mercbot.bot-loops` capabilities, for features that require
// them, and of what the bot tool modules share.

/** @typedef {ReturnType<typeof import("./botsService.js").createBotsService>} Bots */
/** @typedef {ReturnType<typeof import("./botLoops.js").createBotLoops>} BotLoops */
/** @typedef {ReturnType<typeof import("./approvals.js").createApprovals>} Approvals */
/** @typedef {ReturnType<typeof import("./botRequests.js").createBotRequests>} BotRequests */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions the call's options: a request's, or a job's */

/**
 * Whose connected accounts a turn uses: the home's, in any chat (D-111, D-112), as the person who asked.
 * @typedef {{ userId: string, homeId: string }} Reach
 */
/**
 * What a tool asks connectedKey() with: the integrations, where the turn runs, the apps the person
 * switched this action off for, the turn's call options, and whether only the accounts the person
 * whose turn it is connected count.
 * @typedef {{ integrations: import("@local/integrations/server/types").Integrations, reach?: Reach, skip?: string[], call: CallOptions, own?: boolean }} AppAccess
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
/** @typedef {ReturnType<typeof import("./records/homeTemplateRepository.js").createHomeTemplateRepository>} HomeTemplateRepository */
/** @typedef {ReturnType<typeof import("./records/chatRepository.js").createChatRepository>} ChatRepository */
/** @typedef {ReturnType<typeof import("./records/botRepository.js").createBotRepository>} BotRepository */
/** @typedef {ReturnType<typeof import("./records/messageRepository.js").createMessageRepository>} MessageRepository */
/** @typedef {ReturnType<typeof import("./records/rowPolicies.js").createChatRules>} ChatRules */
/**
 * The chats' service behind the chat routes (D-112, R2: chatMembers.js), `bots.chats`: the chat list, one chat, New chat,
 * joining and leaving, members, renaming, archiving, deleting, a person's place, pins, sections and a bot's direct chat;
 * and `homeChanged(homeId)`, which BotsFeature runs when a home's people change.
 * @typedef {ReturnType<typeof import("./chatMembers.js").createChatMembers>} ChatMembers
 */
/**
 * A chat as every chat route answers it (`{ chat }`, and each of `{ chats }`), the page's one shape for a chat. The
 * everyone chat (`everyone`) counts as pinned for everyone in it, first in the list, with no `pinPosition` (O9). The
 * place's `mentioned` is the chat list's "@": someone's message there mentions the person and they haven't read it since
 * (D-114). A direct chat names its bot (`directBotId`), or the other person of a chat between two people
 * (`directPerson`, as the caller sees it: the one of the two who isn't them); a room has neither.
 * @typedef {{
 *   id: string, kind: "public" | "private", title: string | null, everyone: boolean, directBotId: string | null,
 *   directPerson: { userId: string, name: string } | null, appId: string | null, madeBy: string | null,
 *   onboardingStep: string | null, archivedAt: string | null,
 *   lastActivityAt: string, people: Array<{ userId: string, name: string }>,
 *   bots: Array<{
 *     chatBotId: string, botId: string, name: string, color: string, shape: string, archived: boolean,
 *     waitingTask: string | null
 *   }>,
 *   place: {
 *     readUpTo: string | null, unread: boolean, mentioned: boolean, pinPosition: number | null,
 *     sectionId: string | null, hidden: boolean, muted: boolean
 *   } | null,
 *   latest: {
 *     id: string, kind: string, role: string, authorUserId: string | null, authorBotId: string | null,
 *     body: object, createdAt: string, preview: string
 *   } | null
 * }} ChatView
 */
/**
 * A chat event (`bot-events`, event name `chat`), told to everyone in the chat and to anyone a change took out of it; a
 * public room's created, renamed, archived, unarchived and deleted to every active member of its home.
 * @typedef {{ chatId: string, change: "created" | "members" | "renamed" | "archived" | "unarchived" | "deleted" }} ChatEvent
 */
/**
 * A typing event (`bot-events`, event name `typing`), told to a chat's other people when one of them starts or stops
 * typing there (chatMembers.js typing); never stored.
 * @typedef {{ chatId: string, userId: string, typing: boolean }} TypingEvent
 */
/**
 * The model's reader (R1, D-112): the context every model-facing read of one bot's turn in one chat passes. It reads
 * `readable_from(chatId)`, the chats everyone who can open its chat can open too, and everything keyed to them, never
 * more because of who asked. `forBot` makes one for a bot's turn, acting for the asker; `forChat` one for the chat
 * itself, acting for no one (its summary); `forHome` one for a bot's memory of the home (D-113), acting for no one and
 * reading the home's public chats only; `of` answers the reader a context is, or null.
 * @typedef {{
 *   forBot: (reader: { homeId: string, botId: string, chatId: string, askerId: string }) => object,
 *   forChat: (chat: { homeId: string, chatId: string }) => object,
 *   forHome: (memory: { homeId: string, botId: string }) => object,
 *   of: (context: unknown) => Readonly<{
 *     homeId: string, botId: string | null, chatId: string | null, askerId: string | null, publicOnly?: boolean
 *   }> | null
 * }} ModelReaders
 */
/**
 * Each bot's rooms memory of the home's public chats (roomsMemory.js, D-113): a turn's state lines, its tools' reads,
 * the refreshes' runner, forgetting, and the card's read.
 * @typedef {ReturnType<typeof import("./roomsMemory.js").createRoomsMemory>} RoomsMemory
 */
/**
 * The home's common knowledge (commonKnowledge.js, D-113): a turn's state lines, and Settings' list and removal.
 * @typedef {ReturnType<typeof import("./commonKnowledge.js").createCommonKnowledge>} CommonKnowledge
 */
/**
 * The bots' tables (`mercbot.bots.records`, records/BotRecordsFeature.js), D-112's records contract: the directory
 * other features read; the home's bots; chats with their people, bots and each person's place, sections and the
 * home's joins and leaves (`chats.personJoined`, `chats.personLeft`); a chat's messages; bots archived (D-108); the
 * bots a person made and the chats they're in across homes; the bots' work (requests, routines, cards) and policies;
 * the connect follow-ups; what a turn reads beside its chat; a bot made from a template opening a chat; new bots made
 * together (D-105); the home's own templates (D-98); what each bot knows (D-107), its rooms memory and the home's common
 * knowledge (D-113); the model's reader; the chat rules
 * other features' row policies apply; and agent-runtime's stores, keyed by the bot's seat in a chat (chat_bots.id)
 * for runs, goals and commands, and by the chat for summaries.
 * @typedef {{
 *   directory: BotDirectory,
 *   bots: BotRepository,
 *   chats: ChatRepository,
 *   messages: MessageRepository,
 *   archives: ReturnType<typeof import("./records/archiveRepository.js").createArchiveRepository>,
 *   makers: ReturnType<typeof import("./records/makerRepository.js").createMakerRepository>,
 *   work: WorkRepository,
 *   followUps: FollowUpRepository,
 *   policies: PolicyRepository,
 *   turns: TurnRepository,
 *   newBots: ReturnType<typeof import("./records/newBotRepository.js").createNewBotRepository>,
 *   homeTemplates: HomeTemplateRepository,
 *   knowledge: ReturnType<typeof import("./records/knowledgeRepository.js").createKnowledgeRepository>,
 *   roomsMemory: ReturnType<typeof import("./records/roomsMemoryRepository.js").createRoomsMemoryRepository>,
 *   commonKnowledge: ReturnType<typeof import("./records/commonKnowledgeRepository.js").createCommonKnowledgeRepository>,
 *   readers: ModelReaders,
 *   rules: ChatRules,
 *   agent: { createRuns: Function, createSummaries: Function, createGoals: Function }
 * }} BotRecords
 */
/**
 * The templates links open, beside Mercbot's own (`mercbot.template-links`, optional: a copy built on Mercbot provides
 * it). `find` answers the template a link's code names, in the gallery's shape (templates.js: slug, name, color, shape,
 * description, creator, greeting, instructions, skills each with name, description and instructions, routines, apps,
 * updatedAt, and optionally a tag), or null; it reads with the request's own options, whose person may be no one. A bot
 * added from one points at a new template of its home made from it (D-98).
 * @typedef {{ find: (code: string, options: CallOptions) => Promise<object | null> }} TemplateLinks
 */
/**
 * A skill a copy built on Mercbot adds beside Mercbot's own (`mercbot.added-skills`, optional: such a copy provides a list
 * of them): `file`, a Markdown file in the form of packages/bots/skills (skills.js), listed with them by its file name.
 * @typedef {{ file: string }} AddedSkill
 */
/**
 * The Team list and new bots, as botList.js makes them: what botTemplates.js and botTeams.js make bots with.
 * @typedef {ReturnType<typeof import("./botList.js").createBotList>} BotList
 */
/** @typedef {ReturnType<typeof import("./botTemplates.js").createBotTemplates>} BotTemplates */
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
/** @typedef {ReturnType<typeof import("./botReplies.js").createBotReplies>} BotReplies */
/** @typedef {ReturnType<typeof import("@jskit-ai/agent-runtime/server").createGoals>} Goals */
/** @typedef {typeof import("@jskit-ai/agent/server").SUMMARY_LIMITS} SummaryLimits */
/** @typedef {ReturnType<typeof import("./model.js").createChatModel>} ChatModel */

export {};
