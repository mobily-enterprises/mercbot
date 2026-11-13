import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createRuns, createGoals, createSummaries } from "@jskit-ai/agent-runtime/server";
import { AGENT_TABLE_RESOURCES } from "./agentTables.js";
import { createConversationRepository } from "./conversationRepository.js";
import { createBotDirectory } from "./directory.js";
import { FOLLOW_UP_SEARCH, createFollowUpRepository } from "./followUpRepository.js";
import { createMakerRepository } from "./makerRepository.js";
import { createMessageRepository } from "./messageRepository.js";
import { createPolicyRepository } from "./policyRepository.js";
import { botVisibility, conversationVisibility, messageVisibility } from "./rowPolicies.js";
import { BOT_SEARCH, CONVERSATION_SEARCH, GROUP_SEARCH, MESSAGE_SEARCH, NOTEBOOK_SEARCH, READ_SEARCH } from "./searchSchemas.js";
import {
  TABLE_RESOURCES,
  botConversationResource,
  botGroupMemberResource,
  botGroupPeopleResource,
  botMessageResource,
  botNotebookResource,
  botRequestResource,
  botResource,
  botRoutineResource,
  connectFollowUpResource,
  conversationReadResource,
  personMemoryResource
} from "./tableResources.js";
import { createTemplateRepository } from "./templateRepository.js";
import { MEMORY_SEARCH, TURN_MESSAGE_SEARCH, createTurnRepository } from "./turnRepository.js";
import { REQUEST_SEARCH, ROUTINE_SEARCH, createWorkRepository } from "./workRepository.js";

// The bots' tables and who may see them. Apps, computer, files
// and account read bots and conversations, and BotsFeature requires all four, so the tables have
// a feature of their own that requires none of them: BotsFeature's services call its repositories,
// the others its read-only directory.
const ROW_POLICIES = new Map([
  [botResource, botVisibility],
  [botConversationResource, conversationVisibility],
  [botMessageResource, messageVisibility]
]);
// The filters the repositories read by beyond each table's search fields (searchSchemas.js), with
// the queued work's (workRepository.js: what is due, by the database's clock), a turn's
// (turnRepository.js) and the connect follow-ups' (followUpRepository.js).
const SEARCH = new Map([
  [botResource, BOT_SEARCH],
  [botConversationResource, CONVERSATION_SEARCH],
  [botMessageResource, { ...MESSAGE_SEARCH, ...TURN_MESSAGE_SEARCH }],
  [botGroupMemberResource, GROUP_SEARCH],
  [botGroupPeopleResource, GROUP_SEARCH],
  [conversationReadResource, READ_SEARCH],
  [botNotebookResource, NOTEBOOK_SEARCH],
  [botRequestResource, REQUEST_SEARCH],
  [botRoutineResource, ROUTINE_SEARCH],
  [connectFollowUpResource, FOLLOW_UP_SEARCH],
  [personMemoryResource, MEMORY_SEARCH]
]);

/** A table's owns entry: with its row policy and filters, when it has them. */
function ownsEntry(resource) {
  const extras = {
    ...(ROW_POLICIES.has(resource) ? { rowPolicy: ROW_POLICIES.get(resource) } : {}),
    ...(SEARCH.has(resource) ? { searchSchema: SEARCH.get(resource) } : {})
  };
  return Object.keys(extras).length ? { resource, ...extras } : resource;
}

const BotRecordsFeature = defineFeature({
  id: "mercbot.bots.records",
  domain: "bots",
  owns: [
    ...TABLE_RESOURCES.map(ownsEntry),
    ...AGENT_TABLE_RESOURCES
  ],
  // agent-runtime's stores keep their rows in their owner's system context (its reasons are its own);
  // the repositories write another person's seat and read point once a service has checked the caller.
  systemScope: "keep the bots' agent runs, goals, summaries and commands for every conversation, and people's seats and read points when a group adds or removes them or work is done for them",
  // People's names (a room's and a group's lines, D-36, D-46), who is in the home (its news), and the
  // home itself, locked while its first bot is made.
  requires: {
    profiles: "users.profiles",
    memberships: "workspaces.memberships",
    workspaces: "workspaces"
  },
  provides: {
    records: "mercbot.bots.records"
  },
  /**
   * @param {object} capabilities
   * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} capabilities.resources
   * @param {(reason: string) => object} capabilities.systemContext
   * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} capabilities.profiles
   * @param {import("@jskit-ai/workspaces-core/server/types").WorkspaceMembershipsRepository} capabilities.memberships
   * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesRepository} capabilities.workspaces
   */
  setup({ resources, systemContext, profiles, memberships, workspaces }) {
    const work = createWorkRepository(resources);
    const records = Object.freeze({
      directory: createBotDirectory(resources, systemContext),
      // Bots, seats, rooms, read points, groups, sections, the notebook and memories; and messages.
      conversations: createConversationRepository({ resources, systemContext, profiles, memberships, workspaces }),
      messages: createMessageRepository({ resources, systemContext }),
      // The bots a person made, with their homes, in every home a system context reaches.
      makers: createMakerRepository(resources),
      // Requests between bots, routines and their cards; a person's approval rules and auto-review.
      work,
      // The connect cards a person started signing in from, until their bot has carried on (D-77).
      followUps: createFollowUpRepository(resources),
      policies: createPolicyRepository(resources),
      // What a turn reads and keeps beside its conversation: memories, the notebook, groups, planning.
      turns: createTurnRepository({ resources, work }),
      // A bot made from a template opening its conversation.
      templates: createTemplateRepository(resources),
      agent: Object.freeze({
        createRuns: (dependencies = {}) => createRuns({ ...dependencies, resources, systemContext }),
        createSummaries: (dependencies) => createSummaries({ ...dependencies, resources, systemContext }),
        createGoals: (dependencies) => createGoals({ ...dependencies, resources, systemContext })
      })
    });
    return { records };
  }
});

export { BotRecordsFeature };
