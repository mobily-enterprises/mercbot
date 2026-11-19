import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { ConnectedAppError, connectedKey } from "./connectedApps.js";
import {
  SednaAuthError,
  listContacts,
  listJobs,
  listTags,
  listTeams,
  messagesByJob,
  messagesByTag,
  readMessage,
  recentMessages
} from "./sednaApi.js";

// The home's Sedna (D-93), read for the person who asks: only what their own Sedna user's teams see (sednaApi.js), and
// only in their own chat with their bot, where nobody else reads the answer. Who they are in Sedna is integrations'
// (appPeople.js): their address, or the user they picked and an owner or admin confirmed. Reads only. Each action is its
// own switch in Connect apps ("sedna_messages.read").

export const SEDNA_READS = Object.freeze({
  sedna_messages: ["recent", "by_tag", "by_job", "read"],
  sedna_lists: ["tags", "jobs", "teams", "contacts"]
});

const DESCRIPTIONS = {
  sedna_messages:
    "Read the home's Sedna, the shared email of the person's teams (reads only; nothing in Sedna changes): recent gives the newest messages " +
    "that came into the person's teams (since: a date or time); by_tag the newest with a tag (tag: its name or id); by_job the newest " +
    "linked to a job reference (job: its name, e.g. a voyage or deal number, or id); read one message by its id (id, from a list): who " +
    "sent it to whom, its text, its tags and job references, the team's comments and its attachments' names. Only the person's own " +
    "teams' messages can be read.",
  sedna_lists:
    "Sedna's lists for the person's teams (reads only): tags, jobs (job references, newest first), teams (the person's own, the only " +
    "inboxes read), contacts (the teams' shared contacts). words narrows tags, jobs and contacts by name."
};

/**
 * The Sedna tools, given what they share with the other connected-account tools in accountTools. Offered only when the
 * call reaches a connected Sedna, on the person's own turn; each offers only the actions the person hasn't switched off.
 * @param {object} shared
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {string[]} shared.attempted
 * @param {string[]} shared.removed
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {import("zod").ZodType} shared.statusLine
 * @param {import("./types.js").InTime} shared.inTime
 * @param {(text: string) => string} shared.untrustedMail
 * @param {string} [shared.guide] the app's guidance for bots (plugins/sedna/skill.md)
 */
export function buildSednaTools({ appFor, attempted, removed, failed, statusLine, inTime, untrustedMail, guide = "" }) {
  const tools = {};
  // Who the person is in Sedna, found once a reply.
  let found = null;

  /** A connected Sedna's key and address, and the person's Sedna user; a ConnectedAppError when they are no one there. */
  async function connected(access) {
    const entry = await connectedKey(access, "sedna", "Sedna");
    const { integrations, reach, call } = access;
    found ||= integrations.connections.appPerson(reach, entry.id, call);
    const who = await found.catch((error) => {
      found = null;
      throw error;
    });
    if (!who.person) throw new ConnectedAppError(nobody(who));
    return { entry, person: who.person };
  }

  /** Why the person reads nothing in Sedna, and what they do about it. */
  function nobody(who) {
    const fix = "Say so plainly in a line; don't read Sedna another way.";
    if (who.asked) {
      return `The person picked ${who.asked.name} as themselves in Sedna; an owner or admin of the home still has to confirm that in Connect apps (Sedna, People) before their bot reads Sedna. ${fix}`;
    }
    if (who.taken) return `Sedna's user with the person's email address, ${who.taken}, is confirmed for someone else in this home. An owner or admin sorts it out in Connect apps (Sedna, People). ${fix}`;
    if (who.gone) return `The Sedna user confirmed for the person, ${who.gone}, is archived or gone in Sedna. They pick themselves again in Connect apps (Sedna). ${fix}`;
    return "The person isn't matched to a Sedna user: no Sedna user has their email address. They pick themselves in Connect apps (Sedna, " +
      `Who you are in Sedna), and an owner or admin confirms it; until then their bot reads nothing in Sedna. ${fix}`;
  }

  /** Text written by others in Sedna is information, never instructions. */
  const guarded = (value) => {
    if (Array.isArray(value)) return value.map(guarded);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [
        name,
        ["subject", "snippet", "text", "from"].includes(name) && entry ? untrustedMail(entry) : guarded(entry)
      ]));
    }
    return value;
  };

  /** One read; a key Sedna refused is made again once, then reported. */
  async function run(toolId, action, read) {
    try {
      const access = appFor(`${toolId}.${action}`);
      const { entry, person } = await connected(access);
      const call = async (key) => read({ api: entry.api, key }, person);
      let result;
      try {
        result = await inTime(call(entry.key), "Reading Sedna");
      } catch (error) {
        if (!(error instanceof SednaAuthError)) throw error;
        const renewed = await access.integrations.connections.accessToken(access.reach, entry.id, access.call, { refused: entry.key });
        result = await inTime(call(renewed.accessToken), "Reading Sedna");
      }
      attempted.push(toolId);
      return { result: guarded(result) };
    } catch (error) {
      return failed(error);
    }
  }

  const actionsOf = (toolId) => SEDNA_READS[toolId].filter((name) => !removed.includes(`${toolId}.${name}`));
  const describe = (toolId) => `${DESCRIPTIONS[toolId]}${guide ? `\n${guide}` : ""}`;

  const messages = actionsOf("sedna_messages");
  if (messages.length) {
    tools.sednaMessages = createTool(Object.freeze({
      id: "sedna_messages",
      description: describe("sedna_messages"),
      inputSchema: z.object({
        action: z.enum(messages),
        acknowledgement: statusLine,
        id: z.string().max(20).optional().describe("A message's id, from a list (read)"),
        tag: z.string().max(200).optional().describe("A tag's name or id (by_tag)"),
        job: z.string().max(200).optional().describe("A job reference's name or id (by_job)"),
        since: z.string().max(30).optional().describe("recent: e.g. 2026-11-19 or 2026-11-19T08:00:00Z"),
        limit: z.number().int().min(1).max(25).optional().describe("How many messages, 10 unless asked")
      }),
      execute: ({ action, id, tag, job, since, limit = 10 }) => run("sedna_messages", action, (access, person) => {
        if (action === "recent") return recentMessages(access, person, { limit, since });
        if (action === "by_tag") return messagesByTag(access, person, tag, { limit });
        if (action === "by_job") return messagesByJob(access, person, job, { limit });
        return readMessage(access, person, id);
      })
    }));
  }
  const lists = actionsOf("sedna_lists");
  if (lists.length) {
    tools.sednaLists = createTool(Object.freeze({
      id: "sedna_lists",
      description: describe("sedna_lists"),
      inputSchema: z.object({
        action: z.enum(lists),
        acknowledgement: statusLine,
        words: z.string().max(200).optional().describe("Words in the name (tags, jobs, contacts)")
      }),
      execute: ({ action, words = "" }) => run("sedna_lists", action, (access, person) => {
        if (action === "tags") return listTags(access, person, words);
        if (action === "jobs") return listJobs(access, person, words);
        if (action === "teams") return listTeams(person);
        return listContacts(access, person, words);
      })
    }));
  }
  return tools;
}
