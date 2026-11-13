// The tables as JSKIT table resources, one per table, as the migrations make them. Row policies, search entries
// and hooks go in the owner feature's `owns` entries.
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** bots */
export const botResource = defineTableResource({
  name: "bots",
  tableName: "bots",
  ownership: "workspace",
  schema: {
    color: { type: "string", maxLength: 16, noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    instructions: { type: "string", noTrim: true, nullable: true },
    isMain: { type: "boolean" },
    kind: { type: "string", maxLength: 10, noTrim: true, search: true },
    label: { type: "string", maxLength: 60, noTrim: true, nullable: true },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    origin: { type: "object", nullable: true, additionalProperties: true },
    shape: { type: "string", maxLength: 24, noTrim: true },
    sharing: { type: "string", maxLength: 16, noTrim: true },
    skills: { type: "array" },
    updatedAt: { type: "dateTime" },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_conversations */
export const botConversationResource = defineTableResource({
  name: "botConversations",
  tableName: "bot_conversations",
  ownership: "workspace",
  schema: {
    appId: { type: "string", maxLength: 24, noTrim: true, nullable: true, search: true },
    botId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    createdBy: { type: "id", nullable: true, search: true },
    forkedAtMessageId: { type: "id", nullable: true, search: true },
    groupId: { type: "id", nullable: true, search: true },
    hidden: { type: "boolean" },
    jobNotes: { type: "array" },
    keepOutOfNotebook: { type: "boolean" },
    lastActivityAt: { type: "dateTime" },
    onboardingStep: { type: "string", maxLength: 32, noTrim: true, nullable: true },
    parentId: { type: "id", nullable: true, search: true },
    pinPosition: { type: "integer", nullable: true },
    readUpTo: { type: "integer", nullable: true },
    roomId: { type: "id", nullable: true, search: true },
    sectionId: { type: "id", nullable: true, search: true },
    title: { type: "string", maxLength: 40, noTrim: true, nullable: true },
    unread: { type: "boolean" },
    userId: { type: "id", nullable: true, search: true },
    waitingTask: { type: "string", maxLength: 200, noTrim: true, nullable: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_messages
 * addWorkspace from bot_conversations via conversation_id
 */
export const botMessageResource = defineTableResource({
  name: "botMessages",
  tableName: "bot_messages",
  ownership: "workspace",
  // The Library reads up to 400 of what a bot made in one page (botLibrary.js).
  queryMaxLimit: 400,
  schema: {
    body: { type: "object", additionalProperties: true },
    botId: { type: "id", required: true, search: true },
    changed: { type: "xid8", nullable: true },
    conversationId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    kind: { type: "string", maxLength: 16, noTrim: true, required: true, search: true },
    role: { type: "string", maxLength: 16, noTrim: true, required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** conversation_reads
 * surrogateId (conversation_id, user_id)
 */
export const conversationReadResource = defineTableResource({
  name: "conversationReads",
  tableName: "conversation_reads",
  ownership: "user",
  schema: {
    conversationId: { type: "id", required: true, search: true },
    readUpTo: { type: "integer", required: true },
    userId: { type: "id", hidden: true, search: true }
  }
});

/** bot_sections */
export const botSectionResource = defineTableResource({
  name: "botSections",
  tableName: "bot_sections",
  ownership: "workspace_user",
  schema: {
    collapsed: { type: "boolean" },
    name: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    position: { type: "integer", required: true },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_group_members
 * addWorkspace from bots via group_id; surrogateId (group_id, bot_id)
 */
export const botGroupMemberResource = defineTableResource({
  name: "botGroupMembers",
  tableName: "bot_group_members",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    groupId: { type: "id", required: true, search: true },
    position: { type: "integer", required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_group_people
 * addWorkspace from bots via group_id; surrogateId (group_id, user_id)
 */
export const botGroupPeopleResource = defineTableResource({
  name: "botGroupPeople",
  tableName: "bot_group_people",
  ownership: "workspace",
  schema: {
    addedBy: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    groupId: { type: "id", required: true, search: true },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_notebook */
export const botNotebookResource = defineTableResource({
  name: "botNotebook",
  tableName: "bot_notebook",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    removedAt: { type: "dateTime", nullable: true },
    sourceConversationId: { type: "id", nullable: true, search: true },
    sourceUserId: { type: "id", nullable: true, search: true },
    text: { type: "string", maxLength: 500, noTrim: true, required: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** person_memories
 * a person's own memories in a home: a bot's turn reads only those of the person it answers, in a shared room too
 */
export const personMemoryResource = defineTableResource({
  name: "personMemories",
  tableName: "person_memories",
  ownership: "workspace_user",
  schema: {
    botId: { type: "id", nullable: true, search: true },
    createdAt: { type: "dateTime" },
    fact: { type: "string", noTrim: true, required: true },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_requests */
export const botRequestResource = defineTableResource({
  name: "botRequests",
  tableName: "bot_requests",
  ownership: "workspace",
  schema: {
    answer: { type: "string", noTrim: true, nullable: true },
    attempts: { type: "integer" },
    brief: { type: "string", noTrim: true, required: true },
    chain: { type: "array" },
    createdAt: { type: "dateTime" },
    deadlineAt: { type: "dateTime" },
    depth: { type: "integer" },
    fromBotId: { type: "id", required: true, search: true },
    fromConversationId: { type: "id", required: true, search: true },
    fromMessageId: { type: "id", nullable: true, search: true },
    kind: { type: "string", maxLength: 8, noTrim: true, search: true },
    language: { type: "string", maxLength: 40, noTrim: true },
    lastError: { type: "string", noTrim: true, nullable: true },
    leaseUntil: { type: "dateTime", nullable: true },
    nextStep: { type: "string", maxLength: 12, noTrim: true, nullable: true },
    parentId: { type: "id", nullable: true, search: true },
    question: { type: "string", noTrim: true, nullable: true },
    questions: { type: "integer" },
    reply: { type: "string", noTrim: true, nullable: true },
    runAfter: { type: "dateTime" },
    status: { type: "string", maxLength: 20, noTrim: true, search: true },
    timeZone: { type: "string", maxLength: 64, noTrim: true },
    toBotId: { type: "id", required: true, search: true },
    toConversationId: { type: "id", required: true, search: true },
    toMessageId: { type: "id", nullable: true, search: true },
    turns: { type: "integer" },
    updatedAt: { type: "dateTime" },
    userId: { type: "id", required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** bot_routines
 * addWorkspace from bots via bot_id
 */
export const botRoutineResource = defineTableResource({
  name: "botRoutines",
  tableName: "bot_routines",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    conversationId: { type: "id", required: true, search: true },
    createdAt: { type: "dateTime" },
    cron: { type: "string", maxLength: 120, noTrim: true, nullable: true },
    enabled: { type: "boolean" },
    failures: { type: "integer" },
    instructions: { type: "string", noTrim: true },
    lastRunAt: { type: "dateTime", nullable: true },
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
    conversationId: { type: "id", required: true, search: true },
    leaseUntil: { type: "dateTime", nullable: true },
    messageId: { type: "id", required: true, search: true },
    personal: { type: "boolean", search: true },
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
 * surrogateId (user_id)
 * workspace_id is unused by code; kept, never written
 */
export const botPolicyResource = defineTableResource({
  name: "botPolicies",
  tableName: "bot_policies",
  ownership: "user",
  schema: {
    autoReview: { type: "boolean" },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", nullable: true, search: true }
  }
});

/** approval_rules
 * workspace_id is unused by code; kept, never written
 */
export const approvalRuleResource = defineTableResource({
  name: "approvalRules",
  tableName: "approval_rules",
  ownership: "user",
  schema: {
    action: { type: "string", maxLength: 200, noTrim: true, required: true },
    behaviour: { type: "string", maxLength: 8, noTrim: true, required: true },
    createdAt: { type: "dateTime" },
    userId: { type: "id", hidden: true, search: true },
    workspaceId: { type: "id", nullable: true, search: true }
  }
});

/** Every table resource this feature owns, in table order. */
export const TABLE_RESOURCES = Object.freeze([
  botResource,
  botConversationResource,
  botMessageResource,
  conversationReadResource,
  botSectionResource,
  botGroupMemberResource,
  botGroupPeopleResource,
  botNotebookResource,
  personMemoryResource,
  botRequestResource,
  botRoutineResource,
  connectFollowUpResource,
  botPolicyResource,
  approvalRuleResource
]);
