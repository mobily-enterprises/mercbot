import { ConnectedAppError } from "./connectedApps.js";
import {
  JOB,
  SednaUncertainError,
  TAG,
  UPLOAD_MAX_BYTES,
  contactOf,
  linkedTeams,
  messageText,
  named,
  ownContact,
  ownMessage,
  pick,
  sednaCall,
  sednaGet,
  teamIds,
  userName,
  visible
} from "./sednaApi.js";

// Sedna's writes (D-94), on the reads and calls of sednaApi.js (D-93): every one as the person's own Sedna user
// (`fromUser` is always `person.id`, never one a bot names) from one of their teams, on messages, drafts, tags, job
// references and contacts of their teams only, each checked before anything changes. Each takes `commit` (SednaCommit),
// through which the change reaches Sedna: sednaActions.js passes sendOrSimulate, so only a live copy changes Sedna.

const ADDRESS = /[^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,}/iu;
const idOf = (body) => (body?.data?.id != null ? String(body.data.id) : "");
const teamNames = (person) => person.teams.map((team) => team.name).join(", ");

/**
 * Sedna's API names no field for answering a message (D-94): a reply goes out as a new message to the sender, with "Re:"
 * and the quoted text, and may land outside the conversation's thread in Sedna. When Sedna adds one, its attribute's
 * name goes here and replies carry the answered message's id in it.
 */
const SEDNA_REPLY_FIELD = "";

/** The person's team a message goes out from: the one named (id or name), else the one the work suggests or their only one. */
export function ownTeam(person, wanted = "", suggested = []) {
  const text = String(wanted ?? "").trim().toLowerCase();
  if (text) {
    const team = person.teams.find((entry) => entry.id === text || entry.name.toLowerCase() === text);
    if (!team) throw new ConnectedAppError(`${wanted} isn't one of the person's Sedna teams (${teamNames(person)}). Ask which with ask_with_options.`);
    return team;
  }
  const preferred = person.teams.filter((team) => suggested.includes(team.id));
  const choices = preferred.length ? preferred : person.teams;
  if (choices.length === 1) return choices[0];
  if (!choices.length) throw new ConnectedAppError("The person's Sedna user is in no team, so nothing can be sent from Sedna for them. Say so plainly.");
  throw new ConnectedAppError(`Which of the person's Sedna teams should it come from: ${choices.map((team) => team.name).join(", ")}? Ask with ask_with_options, then give team.`);
}

/** Recipients as Sedna takes them, from "Kim Broker <kim@brokers.example>, ops@agency.example" or a list of such. */
export function recipients(value) {
  const seen = new Map();
  for (const part of [].concat(value || []).join(",").split(/[,;\n]/u)) {
    const email = part.match(ADDRESS)?.[0];
    if (!email || seen.has(email.toLowerCase())) continue;
    const name = part.slice(0, part.indexOf(email)).replace(/[<>"]/gu, "").trim().slice(0, 100);
    seen.set(email.toLowerCase(), { email, ...(name ? { name } : {}) });
  }
  return [...seen.values()].slice(0, 50);
}

const escaped = (text) => String(text).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const paragraphs = (text) => String(text).trim().split(/\n\s*\n/u).map((part) => `<p>${escaped(part).replace(/\n/gu, "<br>")}</p>`).join("");

/** A message's HTML body (Sedna takes HTML only) from plain text, with the answered message quoted below it. */
export function messageHtml(text, quote = null) {
  if (!quote) return paragraphs(text);
  return `${paragraphs(text)}<p>${escaped(quote.intro)}</p><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${paragraphs(quote.text)}</blockquote>`;
}

/** When a quoted message came, as a mail program writes it ("Wed, 19 Nov 2026 09:30:00 GMT"). */
const whenSent = (at) => (at && Number.isFinite(Date.parse(at)) ? new Date(at).toUTCString() : "an earlier date");

/** What a reply to a message in the person's teams takes from it: subject, sender, its teams and the text to quote. */
export async function replyBasis(access, person, id) {
  const message = await ownMessage(access, person, id);
  const attributes = message.attributes || {};
  const subject = String(attributes.subject || "");
  const from = [attributes.fromName, attributes.fromEmail ? `<${attributes.fromEmail}>` : ""].filter(Boolean).join(" ");
  return {
    id: String(message.id),
    subject: /^re:/iu.test(subject) ? subject : `Re: ${subject}`.trim(),
    original: subject,
    from,
    to: attributes.fromEmail ? from : "",
    teams: linkedTeams(message) || [],
    quote: { intro: `On ${whenSent(attributes.receivedAt || attributes.sentAt)}, ${from || "the sender"} wrote:`, text: messageText(attributes) }
  };
}

/** A message's attributes as Sedna takes them: always from the person's own user and one of their teams. */
function outgoing(person, team, { to, cc = [], bcc = [], subject = "", html, replyTo = "" }) {
  return {
    fromUser: String(person.id),
    fromTeam: String(team.id),
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject,
    body: html,
    ...(SEDNA_REPLY_FIELD && replyTo ? { [SEDNA_REPLY_FIELD]: replyTo } : {})
  };
}

/**
 * How a change reaches Sedna: `commit(effect, act)` runs `act` in a live copy, and a test copy logs `effect` instead and
 * answers `{ simulated: true }` (connectedApps.js sendOrSimulate, D-69). Every check before it (whose message, which team,
 * whose draft) runs in both, so a test copy refuses what a live one does. Without one, the change is made.
 * @typedef {(effect: { kind: string, summary: string, details?: object }, act: () => Promise<unknown>) => Promise<any>} SednaCommit
 */
/** @type {SednaCommit} */
const direct = (_effect, act) => act();
const emails = (list) => list.map((entry) => entry.email).join(", ");

/** Adds one of the bot's files to a draft as an attachment (base64: Sedna stores it with the call). */
async function upload(access, messageId, file) {
  const body = { data: { fileName: file.name, fileSize: file.bytes.length, base64Content: file.bytes.toString("base64") } };
  await sednaCall(access, "POST", `/message/${messageId}/document`, { body });
}

/** A message saved as a draft in the person's Sedna Drafts: its id, "" when Sedna's answer doesn't say. */
async function saveDraft(access, person, team, message) {
  return idOf(await sednaCall(access, "POST", "/message", { body: { data: { type: "message", attributes: outgoing(person, team, message) } } }));
}

/** Attachments as Sedna takes them: 10 MB each at most, else nothing is done. */
function checkedFiles(files) {
  for (const file of files) {
    if (file.bytes.length > UPLOAD_MAX_BYTES) {
      throw new ConnectedAppError(`${file.name} is ${Math.ceil(file.bytes.length / 1048576)} MB; attachments added from here are 10 MB at most. Nothing was changed.`);
    }
  }
  return files;
}

/** What a message says it is, for the log line of a test copy and the event line. */
const messageEffect = (kind, team, message, files) => ({
  kind,
  summary: `the ${kind === "Sedna message" ? "message" : "draft"} "${message.subject || "(no subject)"}" from ${team.name} to ${emails(message.to) || "nobody yet"}`,
  details: {
    team: team.name,
    to: message.to.map((entry) => entry.email),
    cc: (message.cc || []).map((entry) => entry.email),
    attachments: files.map((file) => file.name)
  }
});

/**
 * Saves a draft in the person's Sedna Drafts, from one of their teams, with any attachments; its id. Sedna's answer to
 * making a draft isn't documented: its id is taken from `data.id` when it gives one.
 */
export async function createDraft(access, person, team, message, files = [], commit = direct) {
  checkedFiles(files);
  const done = await commit(messageEffect("Sedna draft", team, message, files), async () => {
    const id = await saveDraft(access, person, team, message);
    if (files.length && !id) {
      throw new SednaUncertainError("Sedna saved the draft but didn't say its id, so its attachments weren't added. It's in the person's Sedna Drafts: they add them there.");
    }
    for (const file of files) await upload(access, id, file);
    return { id };
  });
  return { id: done.id || "", simulated: Boolean(done.simulated) };
}

/**
 * Sends a message as the person from one of their teams: straight out, or with attachments as a draft they're added to
 * and then sent. Nothing is tried again: a failure part-way says what is left in their Sedna Drafts.
 */
export async function sendMessage(access, person, team, message, files = [], commit = direct) {
  checkedFiles(files);
  const params = { currentTeamId: team.id };
  const done = await commit(messageEffect("Sedna message", team, message, files), async () => {
    if (!files.length) {
      const body = { data: { type: "message", attributes: outgoing(person, team, message) } };
      return { id: idOf(await sednaCall(access, "POST", "/message/send", { params, body })) };
    }
    const id = await saveDraft(access, person, team, message);
    if (!id) {
      throw new SednaUncertainError("Sedna saved a draft but didn't say its id, so the attachments weren't added and it wasn't sent. It's in the person's Sedna Drafts: they finish it there.");
    }
    try {
      for (const file of files) await upload(access, id, file);
      await sednaCall(access, "POST", `/message/${id}/send`, { params });
    } catch (error) {
      error.message = `${error.message} What was made so far is a draft in the person's Sedna Drafts (Sedna id ${id}): they finish or delete it there.`;
      throw error;
    }
    return { id };
  });
  return { id: done.id || "", simulated: Boolean(done.simulated) };
}

/** A draft in the person's teams that Sedna says is their own and not sent; anything else is refused before a change. */
export async function ownDraft(access, person, id) {
  const message = await ownMessage(access, person, id);
  const sender = message.relationships?.sender?.data;
  if (message.attributes?.sentAt) {
    throw new ConnectedAppError("That message was already sent or received: only the person's own unsent drafts are changed or sent here. Nothing was changed.");
  }
  if (!sender || String(sender.id) !== String(person.id) || (sender.type && sender.type !== "user")) {
    throw new ConnectedAppError("Sedna doesn't say that draft is the person's own, so it isn't changed or sent from here. They finish it in Sedna. Nothing was changed.");
  }
  return message;
}

/** Changes the person's own draft: only what's given (recipients, subject, text). */
export async function updateDraft(access, person, id, { to, cc, bcc, subject, html }, commit = direct) {
  const draft = await ownDraft(access, person, id);
  const attributes = {
    ...(to ? { to } : {}),
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(html !== undefined ? { body: html } : {})
  };
  const named = subject ?? String(draft.attributes?.subject || "");
  const done = await commit(
    { kind: "Sedna draft", summary: `the change to the draft "${named || "(no subject)"}"`, details: { draft: String(draft.id), changes: Object.keys(attributes) } },
    () => sednaCall(access, "PATCH", `/message/${draft.id}`, { body: { data: { type: "message", id: String(draft.id), attributes } } })
  );
  return { id: String(draft.id), subject: named, simulated: Boolean(done?.simulated) };
}

/** Adds one of the bot's files to the person's own draft. */
export async function attachFile(access, person, id, file, commit = direct) {
  const draft = await ownDraft(access, person, id);
  checkedFiles([file]);
  const done = await commit(
    { kind: "Sedna draft", summary: `the attachment ${file.name} on the draft "${draft.attributes?.subject || "(no subject)"}"`, details: { draft: String(draft.id), file: file.name } },
    () => upload(access, draft.id, file)
  );
  return { id: String(draft.id), subject: String(draft.attributes?.subject || ""), file: file.name, simulated: Boolean(done?.simulated) };
}

/** Sends the person's own draft, from its team that's theirs. */
export async function sendDraft(access, person, id, wantedTeam = "", commit = direct) {
  const draft = await ownDraft(access, person, id);
  const team = ownTeam(person, wantedTeam, linkedTeams(draft) || []);
  const to = draft.attributes?.to || [];
  const subject = String(draft.attributes?.subject || "");
  const done = await commit(
    {
      kind: "Sedna message",
      summary: `the draft "${subject || "(no subject)"}" from ${team.name} to ${emails(to) || "nobody yet"}`,
      details: { draft: String(draft.id), team: team.name }
    },
    () => sednaCall(access, "POST", `/message/${draft.id}/send`, { params: { currentTeamId: team.id } })
  );
  return { id: String(draft.id), subject, to, team: team.name, simulated: Boolean(done?.simulated) };
}

/** A tag or job reference by name or id, only one the person may see (for an id, read first and checked). */
async function pickOwn(access, person, kind, wanted) {
  const text = String(wanted ?? "").trim();
  if (!/^\d{1,20}$/u.test(text)) return pick(access, person, kind, wanted);
  const { data: found } = await sednaGet(access, `${kind.path}/${text}`, {});
  if (!found || !visible(found, person)) throw new ConnectedAppError(`That ${kind.word} isn't one of the person's teams', so it isn't used. Nothing was changed.`);
  return { id: String(found.id), name: named(found) };
}

/** Adds or takes off a tag or job reference on a message in the person's teams. */
async function changeLink(access, person, kind, messageId, wanted, { remove = false, commit = direct } = {}) {
  const message = await ownMessage(access, person, messageId);
  const chosen = await pickOwn(access, person, kind, wanted);
  const type = kind === TAG ? "category-tag" : "job-reference";
  const subject = String(message.attributes?.subject || "");
  const done = await commit(
    { kind: "Sedna change", summary: `${remove ? "taking" : "putting"} the ${kind.word} ${chosen.name} ${remove ? "off" : "on"} "${subject}"`, details: { message: String(message.id), [type]: chosen.id } },
    () => sednaCall(access, remove ? "DELETE" : "POST", `/message/${message.id}/relationships/${type}`, { body: { data: [{ type, id: chosen.id }] } })
  );
  return { message: String(message.id), subject, [kind === TAG ? "tag" : "jobReference"]: chosen.name, simulated: Boolean(done?.simulated) };
}

export const tagMessage = (access, person, id, tag, options) => changeLink(access, person, TAG, id, tag, options);
export const linkJob = (access, person, id, job, options) => changeLink(access, person, JOB, id, job, options);

export const JOB_TYPES = Object.freeze(["voyage", "head_fixture", "spot_fixture", "other"]);

/** Makes a job reference for one of the person's teams; one with that name already there is used instead (409). */
export async function createJob(access, person, team, { name, type = "" }, commit = direct) {
  const clean = String(name || "").trim().slice(0, 200);
  if (!clean) throw new ConnectedAppError("Give the job reference's name.");
  const body = {
    data: {
      type: "job-reference",
      attributes: { name: clean, type: JOB_TYPES.includes(type) ? type : "" },
      relationships: { team: { data: [{ type: "team", id: team.id }] } }
    }
  };
  try {
    const done = await commit(
      { kind: "Sedna change", summary: `the job reference ${clean} for ${team.name}`, details: { team: team.name, name: clean } },
      () => sednaCall(access, "POST", JOB.path, { body })
    );
    return { id: idOf(done), name: clean, made: true, simulated: Boolean(done?.simulated) };
  } catch (error) {
    if (error.status !== 409) throw error;
    const existing = await pick(access, person, JOB, clean).catch(() => null);
    if (!existing) throw new ConnectedAppError(`A job reference called ${clean} already exists in Sedna, outside the person's teams. Nothing was made.`);
    return { ...existing, made: false };
  }
}

/**
 * A colleague a message in the person's teams can be assigned to: an active Sedna user in one of its teams that's theirs.
 * One request: Sedna lists only the users of the message's teams (filter[user.team]), and any user whose answer names
 * other teams only is still left out.
 */
async function colleague(access, person, wanted, messageTeams) {
  const text = String(wanted ?? "").trim();
  if (!text) throw new ConnectedAppError("Say who it's for: a colleague's name or email address.");
  if (/^(me|myself)$/iu.test(text) || text === String(person.id)) return { id: String(person.id), name: person.name };
  const found = (await sednaGet(access, "/user", {
    [/^\d{1,20}$/u.test(text) ? "filter[user.id]" : "filter[user.search]"]: text,
    "filter[user.team]": messageTeams.join(","),
    "page[limit]": 25
  })).data || [];
  const inTeams = found.filter(
    (user) => !user.attributes?.archived && (linkedTeams(user) || messageTeams).some((id) => messageTeams.includes(id))
  );
  const lower = text.toLowerCase();
  const exact = inTeams.filter((user) => userName(user).toLowerCase() === lower || String(user.attributes?.individualEmail || "").toLowerCase() === lower);
  const chosen = exact.length ? exact : inTeams;
  if (chosen.length === 1) return { id: String(chosen[0].id), name: userName(chosen[0]) };
  if (!chosen.length) throw new ConnectedAppError(`No active Sedna user called ${text} is in the message's team. Nothing was changed.`);
  throw new ConnectedAppError(`Several colleagues match ${text}: ${chosen.map((user) => `${userName(user)} (${user.id})`).join("; ")}. Ask which with ask_with_options.`);
}

/** Assigns a message in the person's teams to a colleague in its team (Sedna tells them). Sedna's API has no unassign. */
export async function assignMessage(access, person, messageId, wanted, commit = direct) {
  const message = await ownMessage(access, person, messageId);
  const teams = (linkedTeams(message) || []).filter((id) => teamIds(person).has(id));
  const user = await colleague(access, person, wanted, teams);
  const subject = String(message.attributes?.subject || "");
  const done = await commit(
    { kind: "Sedna assignment", summary: `assigning "${subject}" to ${user.name}`, details: { message: String(message.id), user: user.id } },
    () => sednaCall(access, "POST", `/message/${message.id}/relationships/assignment`, { body: { data: [{ type: "user", id: user.id }] } })
  );
  return { message: String(message.id), subject, assignedTo: user.name, simulated: Boolean(done?.simulated) };
}

const CONTACT_FIELDS = ["firstName", "lastName", "company", "title", "address1", "city", "postalCode", "country"];
/** A contact's fields as Sedna takes them, from what the bot gave. */
function contactFields(fields) {
  const attributes = {};
  for (const name of CONTACT_FIELDS) if (fields[name] !== undefined) attributes[name] = String(fields[name]).trim().slice(0, 200);
  if (fields.emails) attributes.emailAddresses = recipients(fields.emails).map((entry) => entry.email);
  if (fields.phones) attributes.phoneNumbers = [].concat(fields.phones).map((number) => ({ number: String(number).trim().slice(0, 40), type: "OFFICE" }));
  return attributes;
}

/** Adds a contact for one of the person's teams. */
export async function createContact(access, person, team, fields, commit = direct) {
  const attributes = contactFields(fields);
  if (!attributes.firstName && !attributes.lastName && !attributes.company) throw new ConnectedAppError("Give the contact's name or company.");
  const name = [attributes.firstName, attributes.lastName].filter(Boolean).join(" ") || attributes.company;
  const body = { data: { type: "contact", attributes, relationships: { team: { data: [{ type: "team", id: team.id }] } } } };
  const made = await commit(
    { kind: "Sedna change", summary: `the contact ${name} for ${team.name}`, details: { team: team.name } },
    () => sednaCall(access, "POST", "/contact", { body })
  );
  return { id: idOf(made), name, team: team.name, simulated: Boolean(made?.simulated) };
}

/**
 * Changes one of the person's teams' contacts. Sedna replaces a contact whole (PUT), so it's read first and only what's
 * given changes; its teams stay as they are.
 */
export async function updateContact(access, person, id, fields, commit = direct) {
  const contact = await ownContact(access, person, id);
  const { createdAt: _made, modifiedAt: _changed, adminDistrict1: _a1, adminDistrict2: _a2, ...kept } = contact.attributes || {};
  const attributes = { ...kept, ...contactFields(fields) };
  const team = (linkedTeams(contact) || []).find((teamId) => teamIds(person).has(teamId)) || person.teams[0]?.id || "";
  const body = { data: { type: "contact", id: String(contact.id), attributes, relationships: { team: { data: (linkedTeams(contact) || []).map((teamId) => ({ type: "team", id: teamId })) } } } };
  const done = await commit(
    { kind: "Sedna change", summary: `the change to the contact ${contactOf(contact).name || contact.id}`, details: { contact: String(contact.id), changes: Object.keys(contactFields(fields)) } },
    () => sednaCall(access, "PUT", `/contact/${contact.id}`, { params: { currentTeamId: team }, body })
  );
  return { ...contactOf({ ...contact, attributes }), simulated: Boolean(done?.simulated) };
}
