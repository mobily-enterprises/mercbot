// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** bots
 * a bot of the home, a member of its chats as a person is (D-112); made_by is who made it, null once their account goes
 */
export const botResource = defineTableResource({
  name: "bots",
  tableName: "bots",
  ownership: "workspace",
  schema: {
    // Its own additions to its template, for it alone (D-98): "" when none.
    additions: { type: "string", noTrim: true },
    // Archived (D-108): since when, null while it isn't, and by whom.
    archivedAt: { type: "dateTime", nullable: true },
    archivedBy: { type: "id", nullable: true },
    color: { type: "string", maxLength: 16, noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    // The template it points at (D-98): one of its home's, or one of Mercbot's library by slug; never both.
    homeTemplateId: { type: "id", nullable: true, search: true },
    isMain: { type: "boolean" },
    libraryTemplate: { type: "string", maxLength: 40, noTrim: true, nullable: true, search: true },
    madeBy: { type: "id", nullable: true, search: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    shape: { type: "string", maxLength: 24, noTrim: true },
    // When it started to point at its template: the template's changes after it are what changed.
    templateSince: { type: "dateTime", nullable: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** conversations
 * a chat (D-112): public (everyone in the home can open it) or private (its people only); a direct chat is one
 * person's own with one bot (directBotId), or two people's (directPersonId, the pair kept with directUserId the lower
 * id), private either way; the everyone chat has every active member of the home; an app's chat is its Builder's
 */
export const conversationResource = defineTableResource({
  name: "conversations",
  tableName: "conversations",
  ownership: "workspace",
  schema: {
    appId: { type: "string", maxLength: 24, noTrim: true, nullable: true, search: true },
    archivedAt: { type: "dateTime", nullable: true },
    archivedBy: { type: "id", nullable: true },
    // Whether its bots join in when useful (D-115): off by default, its maker's and the home's owners' and admins'.
    botsJoinIn: { type: "boolean" },
    createdAt: { type: "dateTime" },
    directBotId: { type: "id", nullable: true, search: true },
    directPersonId: { type: "id", nullable: true, search: true },
    directUserId: { type: "id", nullable: true, search: true },
    everyone: { type: "boolean", search: true },
    kind: { type: "string", maxLength: 8, noTrim: true, required: true, search: true },
    lastActivityAt: { type: "dateTime" },
    madeBy: { type: "id", nullable: true, search: true },
    onboardingStep: { type: "string", maxLength: 32, noTrim: true, nullable: true },
    title: { type: "string", maxLength: 80, noTrim: true, nullable: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** chat_people
 * a person in a chat, with their own place in it: where they read up to, unread, since when someone mentioned them
 * there unread (D-114), pin, section, hidden and muted
 */
export const chatPersonResource = defineTableResource({
  name: "chatPeople",
  tableName: "chat_people",
  ownership: "workspace",
  schema: {
    addedBy: { type: "id", nullable: true },
    conversationId: { type: "id", required: true, search: true },
    hidden: { type: "boolean", search: true },
    joinedAt: { type: "dateTime" },
    mentionedAt: { type: "dateTime", nullable: true },
    muted: { type: "boolean" },
    pinPosition: { type: "integer", nullable: true },
    readUpTo: { type: "integer", nullable: true },
    sectionId: { type: "id", nullable: true, search: true },
    unread: { type: "boolean", search: true },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** chat_bots
 * a bot in a chat: its id is "this bot in this chat", which its runs, goal, to-do list, job notes, computer, commands,
 * routines, watches, app jobs and follow-ups hang off; readsFromMessageId is where it reads its chat from (null: from
 * the beginning)
 */
export const chatBotResource = defineTableResource({
  name: "chatBots",
  tableName: "chat_bots",
  ownership: "workspace",
  schema: {
    addedBy: { type: "id", nullable: true },
    botId: { type: "id", required: true, search: true },
    conversationId: { type: "id", required: true, search: true },
    jobNotes: { type: "array" },
    joinedAt: { type: "dateTime" },
    position: { type: "integer", required: true },
    readsFromMessageId: { type: "id", nullable: true },
    waitingTask: { type: "string", maxLength: 200, noTrim: true, nullable: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** messages
 * everything said in a chat: by a person (authorUserId), a bot (authorBotId) or Mercbot itself (neither); role is the
 * kind of author, kept when the author's account or bot goes
 */
export const messageResource = defineTableResource({
  name: "messages",
  tableName: "messages",
  ownership: "workspace",
  // The Library reads up to 400 of what a bot made in one page (botLibrary.js).
  queryMaxLimit: 400,
  schema: {
    authorBotId: { type: "id", nullable: true, search: true },
    authorUserId: { type: "id", nullable: true, search: true },
    body: { type: "object", additionalProperties: true },
    changed: { type: "xid8", nullable: true },
    conversationId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    kind: { type: "string", maxLength: 16, noTrim: true, required: true, search: true },
    role: { type: "string", maxLength: 8, noTrim: true, required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** conversation_sections: a person's sidebar sections in a home */
export const conversationSectionResource = defineTableResource({
  name: "conversationSections",
  tableName: "conversation_sections",
  ownership: "workspace_user",
  schema: {
    collapsed: { type: "boolean" },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    position: { type: "integer", required: true },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_knowledge
 * what a bot knows (D-107): each piece of text or file its maker and the home's owners and admins gave it, whole, with
 * how far reading and splitting it has got; goes with its bot
 */
export const botKnowledgeResource = defineTableResource({
  name: "botKnowledge",
  tableName: "bot_knowledge",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    chars: { type: "integer" },
    createdAt: { type: "dateTime" },
    createdBy: { type: "id", nullable: true },
    filePath: { type: "string", maxLength: 1000, noTrim: true, nullable: true },
    kind: { type: "string", maxLength: 8, noTrim: true, required: true },
    leaseBy: { type: "string", maxLength: 40, noTrim: true, nullable: true, search: true },
    leaseUntil: { type: "dateTime", nullable: true },
    partsDone: { type: "integer" },
    partsTotal: { type: "integer" },
    problem: { type: "string", maxLength: 500, noTrim: true, nullable: true },
    state: { type: "string", maxLength: 10, noTrim: true, required: true, search: true },
    text: { type: "string", noTrim: true },
    title: { type: "string", maxLength: 200, noTrim: true, required: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_knowledge_parts
 * the parts a piece of a bot's knowledge is split into, in order, which its turns search (D-107); `search`, the
 * full-text vector PostgreSQL makes from each part, is read only by the knowledge repository's search
 */
export const botKnowledgePartResource = defineTableResource({
  name: "botKnowledgeParts",
  tableName: "bot_knowledge_parts",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    heading: { type: "string", maxLength: 300, noTrim: true },
    knowledgeId: { type: "id", required: true, search: true },
    pages: { type: "string", maxLength: 40, noTrim: true },
    position: { type: "integer", search: true },
    text: { type: "string", noTrim: true, required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_requests
 * a request one bot in a chat asks another (D-46, D-112): conversation_id is the asking chat, where its card
 * (message_id), its cards and its answer go; the asked bot works on the brief alone, its own steps kept in steps
 */
export const botRequestResource = defineTableResource({
  name: "botRequests",
  tableName: "bot_requests",
  ownership: "workspace",
  schema: {
    answer: { type: "string", noTrim: true, nullable: true },
    attempts: { type: "integer" },
    brief: { type: "string", noTrim: true, required: true },
    chain: { type: "array" },
    conversationId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    deadlineAt: { type: "dateTime" },
    depth: { type: "integer" },
    fromChatBotId: { type: "id", required: true, search: true },
    kind: { type: "string", maxLength: 8, noTrim: true, search: true },
    language: { type: "string", maxLength: 40, noTrim: true },
    lastError: { type: "string", noTrim: true, nullable: true },
    leaseUntil: { type: "dateTime", nullable: true },
    messageId: { type: "id", nullable: true, search: true },
    nextStep: { type: "string", maxLength: 12, noTrim: true, nullable: true },
    parentId: { type: "id", nullable: true, search: true },
    question: { type: "string", noTrim: true, nullable: true },
    questions: { type: "integer" },
    reply: { type: "string", noTrim: true, nullable: true },
    runAfter: { type: "dateTime" },
    status: { type: "string", maxLength: 20, noTrim: true, search: true },
    steps: { type: "array", nullable: true },
    timeZone: { type: "string", maxLength: 64, noTrim: true },
    toBotId: { type: "id", required: true, search: true },
    turns: { type: "integer" },
    updatedAt: { type: "dateTime" },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_routines
 * a routine of a bot in a chat (chat_bot_id), run as the person who made it (made_by), paused once they leave
 */
export const botRoutineResource = defineTableResource({
  name: "botRoutines",
  tableName: "bot_routines",
  ownership: "workspace",
  schema: {
    chatBotId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    cron: { type: "string", maxLength: 120, noTrim: true, nullable: true },
    enabled: { type: "boolean" },
    failures: { type: "integer" },
    // Where the routine read each app's events feed up to (D-94), by account: { "sedna:<id>": { cursor, seen } }.
    feeds: { type: "object", nullable: true, additionalProperties: true },
    instructions: { type: "string", noTrim: true },
    lastRunAt: { type: "dateTime", nullable: true },
    madeBy: { type: "id", nullable: true, search: true },
    name: { type: "string", maxLength: 120, noTrim: true, required: true, search: true },
    nextRunAt: { type: "dateTime", nullable: true },
    once: { type: "boolean" },
    runAttempts: { type: "integer" },
    runId: { type: "string", maxLength: 36, noTrim: true, nullable: true, search: true },
    runLeaseUntil: { type: "dateTime", nullable: true },
    runSteps: { type: "array", nullable: true },
    schedule: { type: "string", maxLength: 120, noTrim: true, required: true },
    timezone: { type: "string", maxLength: 64, noTrim: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** connect_follow_ups
 * a connect card a person started signing in from, until its bot carries on (D-77); its card cascades it
 */
export const connectFollowUpResource = defineTableResource({
  name: "connectFollowUps",
  tableName: "connect_follow_ups",
  ownership: "workspace",
  schema: {
    attempts: { type: "integer" },
    chatBotId: { type: "id", required: true, search: true },
    leaseUntil: { type: "dateTime", nullable: true },
    messageId: { type: "id", required: true, search: true },
    pluginId: { type: "string", maxLength: 64, noTrim: true, required: true, search: true },
    runId: { type: "string", maxLength: 36, noTrim: true, nullable: true, search: true },
    status: { type: "string", maxLength: 8, noTrim: true, search: true },
    steps: { type: "array", nullable: true },
    userId: { type: "id", required: true, search: true },
    waitingSince: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_policies
 * a person's auto-review in a home, one row each (ux_bot_policies_key: workspace_id, user_id)
 */
export const botPolicyResource = defineTableResource({
  name: "botPolicies",
  tableName: "bot_policies",
  ownership: "workspace_user",
  schema: {
    autoReview: { type: "boolean" },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** approval_rules: a person's approval rules in a home */
export const approvalRuleResource = defineTableResource({
  name: "approvalRules",
  tableName: "approval_rules",
  ownership: "workspace_user",
  schema: {
    action: { type: "string", maxLength: 200, noTrim: true, required: true },
    behaviour: { type: "string", maxLength: 8, noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** home_templates
 * a home's own bot templates (D-98); a bot pointing at one keeps it (bots ON DELETE RESTRICT)
 */
export const homeTemplateResource = defineTableResource({
  name: "homeTemplates",
  tableName: "home_templates",
  ownership: "workspace",
  schema: {
    createdAt: { type: "dateTime" },
    createdBy: { type: "id", nullable: true },
    description: { type: "string", maxLength: 120, noTrim: true, required: true },
    greeting: { type: "string", noTrim: true, nullable: true },
    instructions: { type: "string", noTrim: true, required: true },
    skills: { type: "array" },
    tag: { type: "string", maxLength: 10, noTrim: true, required: true, search: true },
    updatedAt: { type: "dateTime" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** home_template_changes
 * what changed in a home's template, dated (D-98); goes with its template
 */
export const homeTemplateChangeResource = defineTableResource({
  name: "homeTemplateChanges",
  tableName: "home_template_changes",
  ownership: "workspace",
  schema: {
    changedAt: { type: "dateTime" },
    changedBy: { type: "id", nullable: true },
    homeTemplateId: { type: "id", required: true, search: true },
    summary: { type: "string", maxLength: 200, noTrim: true, required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** common_knowledge
 * the home's common knowledge (D-113): what a person asked a bot to tell every bot in the home, written only on the
 * card they said yes to (cardId, one entry per card); a removed entry keeps its row, with who removed it and when
 */
export const commonKnowledgeResource = defineTableResource({
  name: "commonKnowledge",
  tableName: "common_knowledge",
  ownership: "workspace",
  schema: {
    byUserId: { type: "id", nullable: true, search: true },
    cardId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    fromConversationId: { type: "id", nullable: true },
    removedAt: { type: "dateTime", nullable: true },
    removedBy: { type: "id", nullable: true },
    text: { type: "string", maxLength: 500, noTrim: true, required: true },
    viaBotId: { type: "id", nullable: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_github_repos
 * the GitHub repositories a person let a bot use in its commands (D-128), on the bot's card: always (no chatBotId), or
 * for one task, the bot's seat in the chat it was asked in until expiresAt; the person's own in the home
 */
export const botGithubRepoResource = defineTableResource({
  name: "botGithubRepos",
  tableName: "bot_github_repos",
  ownership: "workspace_user",
  schema: {
    botId: { type: "id", required: true, search: true },
    chatBotId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    expiresAt: { type: "dateTime", nullable: true },
    fullName: { type: "string", maxLength: 140, noTrim: true, required: true },
    repositoryId: { type: "id", required: true, search: true },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** rooms_memories
 * a bot's rooms memory: one digest per bot of the home's public chats it's in (D-113): where it read each chat up to (covers), the home's
 * newest message then (upTo), and the version it replaced (follows): a refresh writes only over the one it read
 */
export const roomsMemoryResource = defineTableResource({
  name: "roomsMemories",
  tableName: "rooms_memories",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    covers: { type: "object", additionalProperties: true },
    follows: { type: "integer", nullable: true },
    madeAt: { type: "dateTime" },
    text: { type: "string", noTrim: true },
    tokens: { type: "integer" },
    upTo: { type: "integer", nullable: true },
    version: { type: "integer", search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** rooms_memory_queue
 * a bot's rooms memory refresh waiting (D-113), claimed by one server at a time under a lease (claimedBy, claimedUntil) that
 * its server renews while it writes; asks counts its requests; rebuild asks for one made from the chats
 */
export const roomsMemoryQueueResource = defineTableResource({
  name: "roomsMemoryQueue",
  tableName: "rooms_memory_queue",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    asks: { type: "integer", search: true },
    attempts: { type: "integer" },
    claimedBy: { type: "string", maxLength: 40, noTrim: true, nullable: true, search: true },
    claimedUntil: { type: "dateTime", nullable: true },
    dueAt: { type: "dateTime" },
    lastError: { type: "string", noTrim: true, nullable: true },
    rebuild: { type: "boolean" },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  botResource,
  conversationResource,
  chatPersonResource,
  chatBotResource,
  messageResource,
  conversationSectionResource,
  botKnowledgeResource,
  botKnowledgePartResource,
  botRequestResource,
  botRoutineResource,
  connectFollowUpResource,
  botPolicyResource,
  approvalRuleResource,
  homeTemplateResource,
  homeTemplateChangeResource,
  commonKnowledgeResource,
  botGithubRepoResource,
  roomsMemoryResource,
  roomsMemoryQueueResource
]);
