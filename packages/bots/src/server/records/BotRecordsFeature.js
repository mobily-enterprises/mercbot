import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createRuns, createGoals, createSummaries } from "@jskit-ai/agent-runtime/server";
import { AGENT_TABLE_RESOURCES } from "./agentTables.js";
import { createArchiveRepository } from "./archiveRepository.js";
import { createBotRepository } from "./botRepository.js";
import { createChatRepository } from "./chatRepository.js";
import { createBotDirectory } from "./directory.js";
import { FOLLOW_UP_SEARCH, createFollowUpRepository } from "./followUpRepository.js";
import { createHomeTemplateRepository } from "./homeTemplateRepository.js";
import { KNOWLEDGE_PART_SEARCH, KNOWLEDGE_SEARCH, createKnowledgeRepository } from "./knowledgeRepository.js";
import { createMakerRepository } from "./makerRepository.js";
import { createMessageRepository } from "./messageRepository.js";
import { createNewBotRepository } from "./newBotRepository.js";
import { createPolicyRepository } from "./policyRepository.js";
import {
  botVisibility,
  conversationVisibility,
  createChatRules,
  inReadableChat,
  ofReadableChatBot,
  readerFor,
  readerOf
} from "./rowPolicies.js";
import { BOT_SEARCH, CHAT_BOT_SEARCH, CHAT_PERSON_SEARCH, CHAT_SEARCH, MESSAGE_SEARCH } from "./searchSchemas.js";
import {
  TABLE_RESOURCES,
  botKnowledgePartResource,
  botKnowledgeResource,
  botRequestResource,
  botResource,
  botRoutineResource,
  chatBotResource,
  chatPersonResource,
  connectFollowUpResource,
  conversationResource,
  messageResource
} from "./tableResources.js";
import { TURN_MESSAGE_SEARCH, createTurnRepository } from "./turnRepository.js";
import { REQUEST_SEARCH, ROUTINE_SEARCH, createWorkRepository } from "./workRepository.js";

// The bots' tables and who may read them (D-112). Apps, computer, files, account and integrations read bots, chats
// and bots in chats, and BotsFeature requires them, so the tables have a feature of their own that requires none of
// them: BotsFeature's services call its repositories, the others its read-only directory and its chat rules.
const ROW_POLICIES = new Map([
  [botResource, botVisibility],
  [conversationResource, conversationVisibility],
  [chatPersonResource, inReadableChat],
  [chatBotResource, inReadableChat],
  [messageResource, inReadableChat],
  [botRequestResource, inReadableChat],
  [botRoutineResource, ofReadableChatBot],
  [connectFollowUpResource, ofReadableChatBot]
]);
// The filters the repositories read by beyond each table's search fields (searchSchemas.js), with the queued work's
// (workRepository.js: what is due, by the database's clock), a turn's (turnRepository.js), the connect follow-ups'
// (followUpRepository.js) and what the bots know (knowledgeRepository.js).
const SEARCH = new Map([
  [botResource, BOT_SEARCH],
  [conversationResource, CHAT_SEARCH],
  [chatPersonResource, CHAT_PERSON_SEARCH],
  [chatBotResource, CHAT_BOT_SEARCH],
  [messageResource, { ...MESSAGE_SEARCH, ...TURN_MESSAGE_SEARCH }],
  [botKnowledgeResource, KNOWLEDGE_SEARCH],
  [botKnowledgePartResource, KNOWLEDGE_PART_SEARCH],
  [botRequestResource, REQUEST_SEARCH],
  [botRoutineResource, ROUTINE_SEARCH],
  [connectFollowUpResource, FOLLOW_UP_SEARCH]
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
  // agent-runtime's stores keep their rows in their owner's system context (its reasons are its own); the
  // repositories write other people's places in a chat (unread, a new member) once a service has checked the caller.
  systemScope: "keep the bots' agent runs, goals, summaries and commands for every bot in every chat, and people's places in chats when a message, a member or a departure changes them",
  // People's names (a chat's people), who is in the home (its everyone chat, a new member), and the home itself,
  // locked while its first bot is made.
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
    const homeTemplates = createHomeTemplateRepository({ resources });
    const records = Object.freeze({
      // Bots, chats and bots in chats, for the other features: read-only.
      directory: createBotDirectory(resources),
      // The home's bots.
      bots: createBotRepository({ resources, workspaces, homeTemplates }),
      // Chats, their people and bots, each person's place in them, sections, and the home's joins and leaves.
      chats: createChatRepository({ resources, systemContext, profiles, memberships, work }),
      // Everything said in a chat.
      messages: createMessageRepository({ resources, systemContext }),
      // Bots archived (D-108), and the chats archiving one reaches.
      archives: createArchiveRepository({ resources, systemContext }),
      // The bots a person made and the chats they're in, with their homes, in every home a system context reaches.
      makers: createMakerRepository(resources),
      // Requests between bots, routines and their cards.
      work,
      // The connect cards a person started signing in from, until their bot has carried on (D-77).
      followUps: createFollowUpRepository(resources),
      // A person's approval rules and auto-review in each home.
      policies: createPolicyRepository(resources),
      // What a turn reads and keeps beside its chat: its messages, the to-do card and job notes.
      turns: createTurnRepository({ resources, work }),
      // A bot made from a template opening a chat.
      // New bots made together, New bot's one and a team's several, in the same statements (D-105).
      newBots: createNewBotRepository({ resources, homeTemplates }),
      // The home's own bot templates and what changed in them (D-98).
      homeTemplates,
      // What each bot knows, and the parts of it its turns search (D-107).
      knowledge: createKnowledgeRepository(resources),
      // The model's reader (R1, D-112): the one context a turn's model-facing reads pass, which reads what its chat may.
      readers: Object.freeze({
        forBot: (reader) => readerFor(systemContext, reader),
        of: readerOf
      }),
      // The chat rules other features' row policies apply to their rows of a bot in a chat and a person's own rows.
      rules: createChatRules(resources),
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
