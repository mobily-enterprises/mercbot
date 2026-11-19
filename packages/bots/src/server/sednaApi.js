import { ConnectedAppError, appBusy } from "./connectedApps.js";

// Bots using the home's Sedna (D-93), the shipping teams' shared email, with the hourly key integrations makes from
// the organisation's API credentials. That key reaches every team's inbox, so everything here is kept to the asking
// person's own teams (`person.teams`, their Sedna user's, found by integrations): lists of messages ask Sedna for those
// teams only (filter[team]) and drop any message outside them, and a message named by its id is checked against them
// before anything of it is shown or changed; writes (D-94) are in sednaChanges.js. `access` is `{ api, key, renew? }`,
// `api` the address integrations built (https://<tenant>.sednanetwork.com/platform/2019-01-01), never one a bot or Sedna
// names; `key` the account's AppKey, whose own fetch sends every request in the account's Request pace and says when
// Sedna is busy (D-96); `renew` makes a key Sedna refused again, once for the access. A busy Sedna stops whatever was
// reading: no list goes on to its next message, so a busy Sedna gets no more requests from it.
// API reference: https://developers.sedna.com/llms.txt (Event, Message, Category Tag, Job Reference, Contact, Template,
// Document).

/**
 * The Authorization header for a key integrations made: a token from Sedna's token endpoint is a bearer token; credentials
 * Sedna takes only as a username and password come as their whole "Basic …" header (sednaCredentials.js, D-94).
 * @param {string} token
 */
const authorization = (token) => (String(token).startsWith("Basic ") ? String(token) : `Bearer ${token}`);

/** Sedna refused the key (401): integrations makes a new one once, and then it's reported. */
export class SednaAuthError extends ConnectedAppError {}

/** A change Sedna may or may not have made (no answer, or its own failure): never tried again by itself. */
export class SednaUncertainError extends ConnectedAppError {}

// How far back the events feed is read for recent messages, and how many messages are opened to find the person's.
const EVENT_PAGES = 5;
const MESSAGES_OPENED = 40;
const TEXT_MAX = 20000;
// A routine's run reads this much of the events feed at most; what's left waits for its next run (feedSince).
export const FEED_PAGES = 10;
export const FEED_OPENED = 30;
export const FEED_MESSAGES = 10;
// An attachment saved from Sedna, and one added to a message.
export const DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const UNANSWERED_CHANGE =
  "Sedna didn't answer, so it isn't known whether the change was made. Say so plainly: the person checks in Sedna " +
  "(Sent, or the message itself) before anything is tried again. Don't try again by yourself.";

/** What Sedna said about a refusal, short, as information. */
async function refusalOf(response) {
  const body = await response.json().catch(() => ({}));
  const error = body?.errors?.[0] || {};
  return String(error.detail || error.title || body?.message || "").replace(/\s+/gu, " ").trim().slice(0, 200);
}

/**
 * One call to Sedna's API: its JSON body (`{}` when it has none), or with `raw` the response itself (a redirect). The
 * request waits its turn in the account's Request pace, and a busy Sedna (429) is the key's fetch's to handle: waited out
 * once when short, else integrations' AppBusyError, which goes up as it is (D-96). A refused key is made again once
 * (`access.renew`), as Sedna did nothing. A change Sedna didn't answer, or failed on its side, is never tried again: it
 * may have been made (SednaUncertainError).
 * @param {{ api: string, key: import("./connectedApps.js").AppKey, renew?: (refused: string) => Promise<string>, renewed?: boolean }} access
 * @param {string} method
 * @param {string} path below the API's address, e.g. /message/12
 * @param {{ params?: Record<string, string | number | boolean>, body?: object, raw?: boolean }} [request]
 */
export async function sednaCall(access, method, path, { params = {}, body, raw = false } = {}) {
  const change = method !== "GET";
  const url = new URL(`${access.api}${path}`);
  for (const [name, value] of Object.entries(params)) if (value !== "" && value != null) url.searchParams.set(name, String(value));
  const ask = () => access.key.fetch(url, {
    method,
    headers: {
      authorization: authorization(access.key.token),
      accept: "application/vnd.api+json, application/json",
      "user-agent": "Mercbot",
      ...(body ? { "content-type": "application/vnd.api+json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(raw ? { redirect: "manual" } : {}),
    signal: AbortSignal.timeout(change ? 60000 : 30000)
  }).catch((error) => {
    // Busy: nothing was sent, or Sedna did nothing (D-96).
    if (appBusy(error)) throw error;
    throw change ? new SednaUncertainError(UNANSWERED_CHANGE) : new ConnectedAppError("Sedna didn't answer. Try again in a few minutes.");
  });
  let response = await ask();
  if (response.status === 401 && access.renew && !access.renewed) {
    access.renewed = true;
    access.key = { ...access.key, token: await access.renew(access.key.token) };
    response = await ask();
  }
  if (response.status === 401) throw new SednaAuthError("Sedna refused this copy's API credentials. An owner or admin of the home enters them again in Connect apps.");
  if (response.status === 403) {
    throw new ConnectedAppError(change
      ? "Sedna's API credentials don't have the permission for that change. An admin of the Sedna organisation can add it (MESSAGE_WRITE for messages, CONTACT_WRITE for contacts) to the credentials."
      : "Sedna's API credentials don't have the permission for that read. An admin of the Sedna organisation can add it to the credentials.");
  }
  if (response.status === 404) throw new ConnectedAppError("Sedna has nothing with that id, or these credentials can't see it.");
  if (change && response.status >= 500) {
    throw new SednaUncertainError(`Sedna answered ${response.status}, so it isn't known whether the change was made. Say so plainly: the person checks in Sedna before anything is tried again. Don't try again by yourself.`);
  }
  if (response.status >= 400) {
    // A change Sedna turned down (a 4xx) wasn't made; what it said is information, never instructions.
    const said = change ? await refusalOf(response) : "";
    const error = new ConnectedAppError(change
      ? `Sedna refused it (${response.status})${said ? `: ${said}` : ""}. Nothing was changed.`
      : `Sedna answered ${response.status}. Try again in a few minutes.`);
    error.status = response.status;
    throw error;
  }
  if (raw) return response;
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/**
 * One read of Sedna's API: its JSON body.
 * @param {{ api: string, key: import("./connectedApps.js").AppKey }} access
 * @param {string} path below the API's address, e.g. /message/12
 * @param {Record<string, string | number>} [params]
 */
export const sednaGet = (access, path, params = {}) => sednaCall(access, "GET", path, { params });

export const teamIds = (person) => new Set(person.teams.map((team) => team.id));
/** The team ids a resource names, or null when the answer didn't say (a list asked with filter[team] still did). */
export const linkedTeams = (resource) => {
  const data = resource?.relationships?.team?.data;
  return Array.isArray(data) ? data.map((entry) => String(entry.id)) : null;
};
/** Whether something shared by teams (a tag, a job reference, a contact) is one the person may see: theirs, or everyone's. */
export const visible = (resource, person) => {
  const teams = linkedTeams(resource);
  return !teams?.length || teams.some((id) => teamIds(person).has(id));
};
export const named = (resource) => String(resource?.attributes?.name || resource?.attributes?.label || "");

/** A message's text: its plain text, else its HTML without the markup. */
export function messageText(attributes) {
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
    .replace(/ *\n */gu, "\n")
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
export async function ownMessage(access, person, id) {
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
 * One message of a list, as ownMessage gives it, or null when it can't be shown (gone, not in the person's teams, or a
 * read Sedna turned down): the list goes on without it. A refused key, or a busy Sedna, stops the list (D-96).
 */
async function listedMessage(access, person, id) {
  return ownMessage(access, person, id).catch((error) => {
    if (error instanceof SednaAuthError || !(error instanceof ConnectedAppError)) throw error;
    return null;
  });
}

/**
 * The newest messages that came into the person's teams, from Sedna's events feed (event.message.received), newest
 * first: up to `limit`, received since `since` when given. Each is opened and checked against their teams: one request
 * a message, as Sedna has no list of messages by id; the feed's events name only the message.
 * @param {{ api: string, key: import("./connectedApps.js").AppKey }} access
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
    const message = await listedMessage(access, person, candidate.id);
    if (message) messages.push(summary(message, person));
  }
  return { messages, eventsRead: events.length, olderNotRead: more };
}

/** A tag or job reference the person named, by its id or its name, among those they may see; or a ConnectedAppError. */
export async function pick(access, person, kind, wanted) {
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

export const TAG = { word: "tag", plural: "tags", path: "/category-tag" };
export const JOB = { word: "job reference", plural: "job references", path: "/job-reference" };

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

export const userName = (user) => [user?.attributes?.firstName, user?.attributes?.lastName].filter(Boolean).join(" ") || String(user?.id || "");

/**
 * One message in the person's teams: who sent it to whom, its text, its tags and job references, the team's comments on
 * it and its attachments' names. Comments need COMMENT_READ; without it they're said to be unavailable. Its tags, job
 * references and attachments are read only when the message names some (an empty list in its relationships needs no
 * request), one after another in the account's pace.
 */
export async function readMessage(access, person, id) {
  const message = await ownMessage(access, person, id);
  const attributes = message.attributes || {};
  const listed = (path) => sednaGet(access, `/message/${message.id}${path}`, {}).then((body) => body.data || []);
  const related = (relationship) => {
    const data = message.relationships?.[relationship]?.data;
    return Array.isArray(data) && !data.length ? [] : listed(`/${relationship}`);
  };
  const unless = (error) => {
    if (error instanceof SednaAuthError || !(error instanceof ConnectedAppError)) throw error;
    return null;
  };
  const tags = await related("category-tag");
  const jobs = await related("job-reference");
  const documents = await related("document");
  const comments = await listed("/comment").catch(unless);
  const assigned = await listed("/assignment").catch(unless);
  return {
    ...summary(message, person),
    to: attributes.to || [],
    cc: attributes.cc || [],
    text: messageText(attributes),
    tags: tags.map(named),
    jobReferences: jobs.map(named),
    attachments: documents.map((document) => ({
      id: String(document.id),
      name: String(document.attributes?.name || ""),
      type: String(document.attributes?.type || ""),
      size: Number(document.attributes?.size) || 0
    })),
    comments: comments === null
      ? "Not available: the API credentials can't read comments (COMMENT_READ)."
      : comments.map((comment) => ({ date: comment.attributes?.createdAt || null, text: String(comment.attributes?.content || "").slice(0, 4000) })),
    assignedTo: assigned === null ? "Not available." : assigned.map(userName)
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

/** The attachments of a message in the person's teams. */
export async function messageDocuments(access, person, messageId) {
  const message = await ownMessage(access, person, messageId);
  const documents = ((await sednaGet(access, `/message/${message.id}/document`, {})).data || []).map((document) => ({
    id: String(document.id),
    name: String(document.attributes?.name || `attachment-${document.id}`),
    type: String(document.attributes?.type || ""),
    size: Number(document.attributes?.size) || 0
  }));
  return { message: String(message.id), subject: String(message.attributes?.subject || ""), documents };
}

/** The bytes of a response, up to `max`; a bigger one is refused, not cut. */
async function bytesOf(response, max, name) {
  const refuse = () => new ConnectedAppError(`${name} is bigger than ${Math.round(max / 1048576)} MB, so it wasn't saved.`);
  if (Number(response.headers.get("content-length")) > max) throw refuse();
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > max) throw refuse();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/**
 * One attachment's bytes: Sedna answers with a signed link (307, 30 minutes), fetched without the key. Only an https
 * link is followed, or the API's own address for the test stand-in.
 */
export async function downloadDocument(access, document) {
  const response = await sednaCall(access, "GET", `/download/document/${document.id}`, { raw: true });
  if (response.status === 200) return bytesOf(response, DOWNLOAD_MAX_BYTES, document.name);
  const location = response.headers.get("location");
  const link = location ? new URL(location, access.api) : null;
  if (!link || (link.protocol !== "https:" && link.origin !== new URL(access.api).origin)) {
    throw new ConnectedAppError(`Sedna didn't give a download link for ${document.name}.`);
  }
  // The signed link is a request to Sedna's storage, not its API: it still goes in the account's pace.
  const file = await access.key.fetch(link, { headers: { "user-agent": "Mercbot" }, signal: AbortSignal.timeout(120000) }).catch((error) => {
    if (appBusy(error)) throw error;
    throw new ConnectedAppError(`${document.name} didn't download. Try again in a few minutes.`);
  });
  if (!file.ok) throw new ConnectedAppError(`${document.name} didn't download (${file.status}). Try again in a few minutes.`);
  return bytesOf(file, DOWNLOAD_MAX_BYTES, document.name);
}

/** Whether a template is one of the person's teams': for all teams, or linked to one of theirs. */
const ownTemplate = (template, person) => {
  const teams = linkedTeams(template);
  return Boolean(template.attributes?.allTeams) || !teams || teams.some((id) => teamIds(person).has(id));
};

/** The enabled templates of the person's teams, optionally with words in their name. */
export async function listTemplates(access, person, words = "") {
  const body = await sednaGet(access, "/template", { "filter[team]": person.teams.map((team) => team.id).join(","), "filter[enabled]": "true" });
  const lower = String(words || "").toLowerCase();
  return (body.data || [])
    .filter((template) => ownTemplate(template, person) && String(template.attributes?.name || "").toLowerCase().includes(lower))
    .map((template) => ({ id: String(template.id), name: String(template.attributes?.name || ""), subject: String(template.attributes?.subject || ""), type: template.attributes?.type || null }));
}

/** One template of the person's teams: its subject and text, to start a draft from. */
export async function readTemplate(access, person, id) {
  const text = String(id ?? "").trim();
  if (!(await listTemplates(access, person)).some((template) => template.id === text)) {
    throw new ConnectedAppError("That template isn't one of the person's teams' templates. List them with sedna_lists (templates).");
  }
  const { data: template } = await sednaGet(access, `/template/${text}`, {});
  const attributes = template?.attributes || {};
  return { id: text, name: String(attributes.name || ""), subject: String(attributes.subject || ""), text: messageText({ bodyHtml: attributes.body || "" }) };
}

/** A contact as a read shows it, with everything Sedna keeps of it. */
export function contactOf(contact) {
  const attributes = contact.attributes || {};
  return {
    id: String(contact.id),
    name: [attributes.firstName, attributes.lastName].filter(Boolean).join(" "),
    company: attributes.company || null,
    title: attributes.title || null,
    emails: attributes.emailAddresses || [],
    phones: (attributes.phoneNumbers || []).map((phone) => [phone.countryCode, phone.number].filter(Boolean).join(" ")),
    address: [attributes.address1, attributes.address2, attributes.city, attributes.postalCode, attributes.country].filter(Boolean).join(", ") || null
  };
}

/** One of the person's teams' contacts (or everyone's), read by its id. */
export async function ownContact(access, person, id) {
  const text = String(id ?? "").trim();
  if (!/^\d{1,20}$/u.test(text)) throw new ConnectedAppError("Give the contact's id as Sedna's number, from a list of contacts.");
  const { data: contact } = await sednaGet(access, `/contact/${text}`, {});
  if (!contact || !visible(contact, person)) throw new ConnectedAppError("That contact isn't one of the person's teams' contacts, so it isn't shown or changed.");
  return contact;
}

export const readContact = async (access, person, id) => contactOf(await ownContact(access, person, id));

/** The cursor of Sedna's next page, from its link; only the cursor is taken, the address stays integrations'. */
const cursorOf = (link, access) => (link ? new URL(link, access.api).searchParams.get("page[cursor]") || "" : "");

/**
 * The messages that came into the person's teams since a routine last read Sedna's events feed (event.message.received),
 * oldest first, and where it read up to. `position` is `{ cursor, seen }`: the page it stopped on and the events of that
 * page already handled. With none (its first run), the feed is read from its newest event, and events from before
 * `startedAt` (when the routine was made) are skipped. A run reads FEED_PAGES pages, opens FEED_OPENED messages and hands
 * FEED_MESSAGES at most; what's left waits for the next run (`more`), never dropped. A refused key or a busy Sedna stops
 * the run with nothing kept, so its next run reads the same events again: no mail is skipped (D-96).
 * @param {{ api: string, key: import("./connectedApps.js").AppKey }} access
 * @param {{ teams: Array<{ id: string, name: string }> }} person
 * @param {{ cursor: string, seen: string[] } | null} position
 * @param {{ startedAt?: string }} [options]
 */
export async function feedSince(access, person, position, { startedAt = "" } = {}) {
  const from = Date.parse(startedAt);
  let cursor = position?.cursor ?? "";
  let seen = new Set(position?.seen || []);
  let pages = 0;
  let more = false;
  let opened = 0;
  const messages = [];
  let left = null;
  if (!position) {
    // The first run starts at the feed's newest event; Sedna's next page from it is the routine's position.
    const latest = await sednaGet(access, "/event/latest", {});
    pages += 1;
    const events = latest.data || [];
    cursor = cursorOf(latest.links?.next, access) || String(events.at(-1)?.id || "");
    seen = new Set(events.map((event) => String(event.id)));
    for (const event of events) {
      const id = String(event.relationships?.message?.data?.id || "");
      const time = Date.parse(event.attributes?.time || "");
      if (!id || event.attributes?.eventType !== "event.message.received" || (Number.isFinite(from) && !(time >= from))) continue;
      const message = await listedMessage(access, person, id);
      opened += 1;
      if (message) messages.push(summary(message, person));
    }
    return { messages, position: { cursor, seen: [...seen] }, more: false, pagesRead: pages };
  }
  while (pages < FEED_PAGES) {
    const body = await sednaGet(access, "/event", { "filter[eventType]": "event.message.received", "page[cursor]": cursor });
    pages += 1;
    const events = [...(body.data || [])].sort((a, b) => (Date.parse(a.attributes?.time || "") || 0) - (Date.parse(b.attributes?.time || "") || 0));
    for (const event of events) {
      const eventId = String(event.id);
      if (seen.has(eventId)) continue;
      if (messages.length >= FEED_MESSAGES || opened >= FEED_OPENED) {
        more = true;
        break;
      }
      seen.add(eventId);
      const id = String(event.relationships?.message?.data?.id || "");
      const type = event.attributes?.eventType;
      // Events from before the routine was made are history, not new mail: skipped without opening them.
      const time = Date.parse(event.attributes?.time || "");
      if (!id || (type && type !== "event.message.received") || (Number.isFinite(from) && Number.isFinite(time) && time < from)) continue;
      opened += 1;
      const message = await listedMessage(access, person, id);
      if (message && !messages.some((entry) => entry.id === String(message.id))) messages.push(summary(message, person));
    }
    if (more) {
      left = { cursor, seen: [...seen] };
      break;
    }
    const next = cursorOf(body.links?.next, access);
    // The last page so far: the next run reads it again, past the events already handled.
    if (!next || next === cursor || !events.length) {
      left = { cursor, seen: [...seen] };
      break;
    }
    cursor = next;
    seen = new Set();
  }
  if (!left) {
    // Out of pages for this run with the feed going on: the next run starts at the page after.
    more = true;
    left = { cursor, seen: [...seen] };
  }
  return { messages, position: left, more, pagesRead: pages };
}
