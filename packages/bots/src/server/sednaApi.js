import { setTimeout as wait } from "node:timers/promises";
import { ConnectedAppError } from "./connectedApps.js";

// Bots reading the home's Sedna (D-93), the shipping teams' shared email, with the hourly key integrations makes from
// the organisation's API credentials. That key reads every team's inbox, so every read here is kept to the asking
// person's own teams (`person.teams`, their Sedna user's, found by integrations): lists of messages ask Sedna for those
// teams only (filter[team]) and drop any message outside them, and a message read by its id is checked against them
// before anything of it is shown. Reads only: nothing here changes Sedna. `access` is `{ api, key }`, `api` the address
// integrations built (https://<tenant>.sednanetwork.com/platform/2019-01-01), never one a bot or Sedna names.
// API reference: https://developers.sedna.com/llms.txt (Event, Message, Category Tag, Job Reference, Contact).

/** Sedna refused the key (401): integrations makes a new one once, and then it's reported. */
export class SednaAuthError extends ConnectedAppError {}

// A 429's Retry-After is waited out once when it's this short; a longer one is reported at once.
const RETRY_AFTER_MAX_S = 30;
// How far back the events feed is read for recent messages, and how many messages are opened to find the person's.
const EVENT_PAGES = 5;
const MESSAGES_OPENED = 40;
const TEXT_MAX = 20000;

/** Seconds a Retry-After asks for: a number of seconds or an HTTP date; 1 when it says nothing usable. */
function retryAfterSeconds(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 1;
}

/**
 * One read of Sedna's API: its JSON body. A 429 is waited out once when its Retry-After is short, then reported, never
 * retried in a loop.
 * @param {{ api: string, key: string }} access
 * @param {string} path below the API's address, e.g. /message/12
 * @param {Record<string, string | number>} [params]
 */
export async function sednaGet(access, path, params = {}) {
  const url = new URL(`${access.api}${path}`);
  for (const [name, value] of Object.entries(params)) if (value !== "" && value != null) url.searchParams.set(name, String(value));
  const ask = () => fetch(url, {
    headers: { authorization: `Bearer ${access.key}`, accept: "application/vnd.api+json, application/json", "user-agent": "Mercbot" },
    signal: AbortSignal.timeout(30000)
  }).catch(() => {
    throw new ConnectedAppError("Sedna didn't answer. Try again in a few minutes.");
  });
  let response = await ask();
  if (response.status === 429) {
    const seconds = retryAfterSeconds(response.headers.get("retry-after"));
    if (seconds <= RETRY_AFTER_MAX_S) {
      await wait(seconds * 1000);
      response = await ask();
    }
    if (response.status === 429) {
      const again = retryAfterSeconds(response.headers.get("retry-after"));
      throw new ConnectedAppError(`Sedna is busy: it asked to wait ${again} seconds before more requests. Say so, and try again after that; don't keep retrying.`);
    }
  }
  if (response.status === 401) throw new SednaAuthError("Sedna refused this copy's API credentials. An owner or admin of the home enters them again in Connect apps.");
  if (response.status === 403) {
    throw new ConnectedAppError("Sedna's API credentials don't have the permission for that read. An admin of the Sedna organisation can add it to the credentials.");
  }
  if (response.status === 404) throw new ConnectedAppError("Sedna has nothing with that id, or these credentials can't see it.");
  if (!response.ok) throw new ConnectedAppError(`Sedna answered ${response.status}. Try again in a few minutes.`);
  return response.json().catch(() => ({}));
}

const teamIds = (person) => new Set(person.teams.map((team) => team.id));
/** The team ids a resource names, or null when the answer didn't say (a list asked with filter[team] still did). */
const linkedTeams = (resource) => {
  const data = resource?.relationships?.team?.data;
  return Array.isArray(data) ? data.map((entry) => String(entry.id)) : null;
};
/** Whether something shared by teams (a tag, a job reference, a contact) is one the person may see: theirs, or everyone's. */
const visible = (resource, person) => {
  const teams = linkedTeams(resource);
  return !teams?.length || teams.some((id) => teamIds(person).has(id));
};
const named = (resource) => String(resource?.attributes?.name || resource?.attributes?.label || "");

/** A message's text: its plain text, else its HTML without the markup. */
function messageText(attributes) {
  const plain = String(attributes.bodyText || "").trim();
  const text = plain || String(attributes.bodyHtml || "")
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s*\n\s*\n+/gu, "\n\n")
    .trim();
  return text.slice(0, TEXT_MAX);
}

/** A message as a list shows it, with the person's teams it's in. */
function summary(message, person) {
  const attributes = message.attributes || {};
  const teams = linkedTeams(message);
  return {
    id: String(message.id),
    subject: String(attributes.subject || ""),
    from: [attributes.fromName, attributes.fromEmail ? `<${attributes.fromEmail}>` : ""].filter(Boolean).join(" "),
    received: attributes.receivedAt || attributes.sentAt || null,
    snippet: String(attributes.snippet || "").slice(0, 400),
    hasAttachment: Boolean(attributes.hasAttachment),
    teams: person.teams.filter((team) => !teams || teams.includes(team.id)).map((team) => team.name)
  };
}

/**
 * One message, only once it's known to be in one of the person's teams: the teams its answer names, else Sedna's list of
 * its teams. A message in none of them is refused without showing anything of it.
 */
async function ownMessage(access, person, id) {
  const messageId = String(id ?? "").trim();
  if (!/^\d{1,20}$/u.test(messageId)) throw new ConnectedAppError("Give the message's id as Sedna's number, from a list of messages.");
  const { data: message } = await sednaGet(access, `/message/${messageId}`, {});
  let teams = linkedTeams(message);
  if (!teams?.length) teams = ((await sednaGet(access, `/message/${messageId}/team`, {})).data || []).map((team) => String(team.id));
  if (!message || !teams.some((teamId) => teamIds(person).has(teamId))) {
    throw new ConnectedAppError(
      "That message isn't in any of the person's Sedna teams, so it can't be read here, and nothing of it was shown. " +
        "Say so plainly; don't guess what it says."
    );
  }
  return { ...message, relationships: { ...message.relationships, team: { data: teams.map((teamId) => ({ id: teamId, type: "team" })) } } };
}

/**
 * The newest messages that came into the person's teams, from Sedna's events feed (event.message.received), newest
 * first: up to `limit`, received since `since` when given. Each is opened and checked against their teams.
 * @param {{ api: string, key: string }} access
 * @param {{ teams: Array<{ id: string, name: string }> }} person
 * @param {{ limit?: number, since?: string }} [query]
 */
export async function recentMessages(access, person, { limit = 10, since = "" } = {}) {
  const events = [];
  let cursor = "";
  let more = false;
  for (let page = 0; page < EVENT_PAGES; page += 1) {
    const body = await sednaGet(access, "/event", { "filter[eventType]": "event.message.received", "page[cursor]": cursor });
    events.push(...(body.data || []));
    // Only the next page's cursor is taken from Sedna's link: the address stays the one integrations built.
    const next = body.links?.next ? new URL(body.links.next, access.api).searchParams.get("page[cursor]") : "";
    more = Boolean(next) && next !== cursor;
    if (!more) break;
    cursor = next;
  }
  const from = since ? Date.parse(since) : NaN;
  const candidates = [...new Map(events
    .map((event) => ({ id: String(event.relationships?.message?.data?.id || ""), time: Date.parse(event.attributes?.time || "") }))
    .filter((event) => event.id && (!Number.isFinite(from) || !Number.isFinite(event.time) || event.time >= from))
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .map((event) => [event.id, event])).values()];
  const messages = [];
  for (const candidate of candidates.slice(0, MESSAGES_OPENED)) {
    if (messages.length >= limit) break;
    const message = await ownMessage(access, person, candidate.id).catch((error) => {
      if (error instanceof SednaAuthError) throw error;
      return null;
    });
    if (message) messages.push(summary(message, person));
  }
  return { messages, eventsRead: events.length, olderNotRead: more };
}

/** A tag or job reference the person named, by its id or its name, among those they may see; or a ConnectedAppError. */
async function pick(access, person, kind, wanted) {
  const text = String(wanted ?? "").trim();
  if (!text) throw new ConnectedAppError(`Give the ${kind.word}'s name or id.`);
  if (/^\d{1,20}$/u.test(text)) return { id: text, name: text };
  const found = ((await sednaGet(access, kind.path, { "filter[name]": text, "filter[archived]": "false", "page[limit]": 50 })).data || [])
    .filter((entry) => visible(entry, person));
  const exact = found.filter((entry) => named(entry).toLowerCase() === text.toLowerCase());
  const chosen = exact.length ? exact : found;
  if (chosen.length === 1) return { id: String(chosen[0].id), name: named(chosen[0]) };
  if (!chosen.length) throw new ConnectedAppError(`No Sedna ${kind.word} called ${text} in the person's teams. List them with sedna_lists to find its name.`);
  throw new ConnectedAppError(
    `Several Sedna ${kind.plural} match ${text}: ${chosen.slice(0, 10).map((entry) => `${named(entry)} (${entry.id})`).join("; ")}. Ask which with ask_with_options.`
  );
}

const TAG = { word: "tag", plural: "tags", path: "/category-tag" };
const JOB = { word: "job reference", plural: "job references", path: "/job-reference" };

/** The newest messages with a tag or job reference, in the person's teams only. */
async function messagesWith(access, person, kind, wanted, { limit = 10 } = {}) {
  const chosen = await pick(access, person, kind, wanted);
  const body = await sednaGet(access, `${kind.path}/${chosen.id}/messageV2`, {
    "filter[team]": person.teams.map((team) => team.id).join(","),
    "page[limit]": limit,
    sort: "received_date",
    order: "desc"
  });
  const found = body.response?.data || body.data || [];
  // Sedna was asked for the person's teams; a message that names other teams only is still left out.
  const messages = found.filter((message) => {
    const teams = linkedTeams(message);
    return !teams || teams.some((id) => teamIds(person).has(id));
  });
  return { [kind === TAG ? "tag" : "jobReference"]: chosen.name, messages: messages.slice(0, limit).map((message) => summary(message, person)) };
}

export const messagesByTag = (access, person, tag, query) => messagesWith(access, person, TAG, tag, query);
export const messagesByJob = (access, person, job, query) => messagesWith(access, person, JOB, job, query);

/**
 * One message in the person's teams: who sent it to whom, its text, its tags and job references, the team's comments on
 * it and its attachments' names. Comments need COMMENT_READ; without it they're said to be unavailable.
 */
export async function readMessage(access, person, id) {
  const message = await ownMessage(access, person, id);
  const attributes = message.attributes || {};
  const listed = (path) => sednaGet(access, `/message/${message.id}${path}`, {}).then((body) => body.data || []);
  const [tags, jobs, documents, comments] = await Promise.all([
    listed("/category-tag"),
    listed("/job-reference"),
    listed("/document"),
    listed("/comment").catch((error) => {
      if (error instanceof SednaAuthError) throw error;
      return null;
    })
  ]);
  return {
    ...summary(message, person),
    to: attributes.to || [],
    cc: attributes.cc || [],
    text: messageText(attributes),
    tags: tags.map(named),
    jobReferences: jobs.map(named),
    attachments: documents.map((document) => ({
      name: String(document.attributes?.name || ""),
      type: String(document.attributes?.type || ""),
      size: Number(document.attributes?.size) || 0
    })),
    comments: comments === null
      ? "Not available: the API credentials can't read comments (COMMENT_READ)."
      : comments.map((comment) => ({ date: comment.attributes?.createdAt || null, text: String(comment.attributes?.content || "").slice(0, 4000) }))
  };
}

/** The tags the person's teams use (everyone's tags too), optionally with words in their name. */
export async function listTags(access, person, words = "") {
  const body = await sednaGet(access, TAG.path, { "filter[name]": words, "filter[archived]": "false", "page[limit]": 100 });
  return (body.data || []).filter((tag) => visible(tag, person)).map((tag) => ({ id: String(tag.id), name: named(tag) }));
}

/** The job references the person's teams have, newest first, optionally with words in their name. */
export async function listJobs(access, person, words = "") {
  const body = await sednaGet(access, JOB.path, { "filter[name]": words, "filter[archived]": "false", "page[limit]": 50, sort: "-id" });
  return (body.data || []).filter((job) => visible(job, person)).map((job) => ({
    id: String(job.id),
    name: named(job),
    type: job.attributes?.type || null,
    date: job.attributes?.date || job.attributes?.createdAt || null
  }));
}

/** The person's own Sedna teams: the only inboxes their bots read. */
export function listTeams(person) {
  return person.teams.map((team) => ({ id: team.id, name: team.name }));
}

/** The organisation's contacts the person's teams share, optionally with words in their name. */
export async function listContacts(access, person, words = "") {
  const body = await sednaGet(access, "/contact", { "filter[name]": words, "page[limit]": 25 });
  return (body.data || []).filter((contact) => visible(contact, person)).map((contact) => {
    const attributes = contact.attributes || {};
    return {
      id: String(contact.id),
      name: [attributes.firstName, attributes.lastName].filter(Boolean).join(" "),
      company: attributes.company || null,
      title: attributes.title || null,
      emails: attributes.emailAddresses || [],
      phones: (attributes.phoneNumbers || []).map((phone) => [phone.countryCode, phone.number].filter(Boolean).join(" "))
    };
  });
}
