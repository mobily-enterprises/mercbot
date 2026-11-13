// Bots using the person's connected Google accounts (D-31): Calendar and Gmail, through Google's
// own APIs with an hourly key from Connect apps. The key comes from this copy's own sign-in or
// the hub's bridge; either way the calls go straight from this server to Google.

import { ConnectedAppError, zoned } from "./connectedApps.js";
import { call } from "./googleApi.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * The account's own time zone, set in Google Calendar: its times are read and booked in it, so
 * "at 1" is 1 pm where the person's calendar says they are.
 * A calendar left on UTC hasn't really been given a zone: the person's own is used and named
 * instead, so times are never shown in UTC.
 */
const calendarZone = (calendars, fallback) => {
  const zone = calendars.find((calendar) => calendar.primary)?.timeZone;
  return !zone || /^(Etc\/)?(UTC|GMT|Zulu)$/iu.test(zone) ? fallback : zone;
};

/** One event as the tools see it, with what's needed to change, remove or answer it. */
const toEvent = (calendar, event) => ({
  id: event.id,
  calendarId: calendar.id,
  calendar: calendar.summaryOverride || calendar.summary,
  title: event.summary || "(no title)",
  start: event.start?.dateTime || event.start?.date,
  end: event.end?.dateTime || event.end?.date,
  location: event.location || undefined,
  attendees: event.attendees?.filter((person) => !person.self).map((person) => person.email),
  organiser: event.organizer?.self ? "the person" : event.organizer?.email,
  myAnswer: event.attendees?.find((person) => person.self)?.responseStatus,
  ...(event.start?.date ? { allDay: true } : {}),
  // A holiday or an event marked free doesn't take up the person's time.
  ...(event.transparency === "transparent" ? { blocksTime: false } : {}),
  // One occurrence of a repeating event names the series, for its other occurrences (D-42).
  ...(event.recurringEventId ? { repeats: event.recurringEventId } : {})
});

/** What a change left on the calendar, for the bot's report: times, zone, link and who's invited. */
const booked = (event) => ({
  title: event.summary,
  start: event.start?.dateTime || event.start?.date,
  end: event.end?.dateTime || event.end?.date,
  timeZone: event.start?.timeZone,
  link: event.htmlLink,
  guests: (event.attendees || []).filter((person) => !person.self).map((person) => ({ email: person.email, answer: person.responseStatus }))
});

/** Events on every calendar the person sees, between two local times in the account's time zone. */
export async function calendarEvents(key, { from, to, timeZone }) {
  const { items: calendars = [] } = await call(key, `${CALENDAR}/users/me/calendarList?minAccessRole=reader`);
  const zone = calendarZone(calendars, timeZone);
  const query = new URLSearchParams({
    timeMin: zoned(from, zone),
    timeMax: zoned(to, zone),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
    timeZone: zone
  });
  const lists = await Promise.all(calendars.filter((calendar) => calendar.selected !== false).map(async (calendar) => {
    const { items = [] } = await call(key, `${CALENDAR}/calendars/${encodeURIComponent(calendar.id)}/events?${query}`).catch(() => ({}));
    return items.map((event) => toEvent(calendar, event));
  }));
  return { timeZone: zone, events: lists.flat().sort((a, b) => String(a.start).localeCompare(String(b.start))) };
}

const eventUrl = (calendarId, eventId) =>
  `${CALENDAR}/calendars/${encodeURIComponent(calendarId || "primary")}/events/${encodeURIComponent(eventId)}`;

/** The calendars the person sees, with whose they are and what they may do in them (D-42). */
export async function listCalendars(key) {
  const { items = [] } = await call(key, `${CALENDAR}/users/me/calendarList`);
  return items.map((calendar) => ({
    id: calendar.id,
    name: calendar.summaryOverride || calendar.summary,
    ...(calendar.primary ? { primary: true } : {}),
    timeZone: calendar.timeZone,
    access: calendar.accessRole,
    ...(calendar.selected === false ? { hidden: true } : {})
  }));
}

/** The occurrences of a repeating event between two local times, in the calendar's zone. */
export async function eventOccurrences(key, { calendarId = "primary", eventId, from, to, timeZone }) {
  const { items: calendars = [] } = await call(key, `${CALENDAR}/users/me/calendarList?minAccessRole=reader`);
  const zone = calendarZone(calendars, timeZone);
  const query = new URLSearchParams({ timeMin: zoned(from, zone), timeMax: zoned(to, zone), maxResults: "50", timeZone: zone });
  const { items = [] } = await call(key, `${eventUrl(calendarId, eventId)}/instances?${query}`);
  return { timeZone: zone, events: items.map((event) => toEvent({ id: calendarId }, event)) };
}

export async function getCalendarEvent(key, { calendarId = "primary", eventId }) {
  return toEvent({ id: calendarId }, await call(key, eventUrl(calendarId, eventId)));
}

/** A new event on the person's main calendar; anyone invited gets Google's invitation. */
export async function addCalendarEvent(key, { title, start, end, timeZone, location, description, attendees = [] }) {
  const primary = await call(key, `${CALENDAR}/users/me/calendarList/primary`).catch(() => ({}));
  const zone = primary.timeZone || timeZone;
  const body = {
    summary: title,
    start: { dateTime: zoned(start, zone), timeZone: zone },
    end: { dateTime: zoned(end, zone), timeZone: zone },
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {})
  };
  const event = await call(key, `${CALENDAR}/calendars/primary/events?sendUpdates=${attendees.length ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  return booked(event);
}

/** Moving or retitling an event, or inviting more people to it; guests hear of the change. */
export async function changeCalendarEvent(
  key,
  { calendarId = "primary", eventId, title, start, end, location, description, attendees = [], timeZone }
) {
  const current = await call(key, eventUrl(calendarId, eventId));
  const zone = current.start?.timeZone || timeZone;
  const guests = [
    ...(current.attendees || []),
    ...attendees.filter((email) => !current.attendees?.some((person) => person.email === email)).map((email) => ({ email }))
  ];
  const body = {
    ...(title ? { summary: title } : {}),
    ...(start ? { start: { dateTime: zoned(start, zone), timeZone: zone } } : {}),
    ...(end ? { end: { dateTime: zoned(end, zone), timeZone: zone } } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(attendees.length ? { attendees: guests } : {})
  };
  const event = await call(key, `${eventUrl(calendarId, eventId)}?sendUpdates=${guests.length ? "all" : "none"}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  return booked(event);
}

/** Removing an event; for one with guests, Google tells them it's cancelled. */
export async function deleteCalendarEvent(key, { calendarId = "primary", eventId, guests = 0 }) {
  await call(key, `${eventUrl(calendarId, eventId)}?sendUpdates=${guests ? "all" : "none"}`, { method: "DELETE" });
}

// Yes, no or maybe to an invitation; the organiser is told.
const GOOGLE_ANSWERS = { accept: "accepted", decline: "declined", maybe: "tentative" };
export async function answerInvitation(key, { calendarId = "primary", eventId, answer }) {
  const current = await call(key, eventUrl(calendarId, eventId));
  if (!current.attendees?.some((person) => person.self)) {
    throw new ConnectedAppError("That event isn't an invitation to this account, so there's nothing to answer.");
  }
  const attendees = current.attendees.map((person) => (person.self ? { ...person, responseStatus: GOOGLE_ANSWERS[answer] } : person));
  await call(key, `${eventUrl(calendarId, eventId)}?sendUpdates=all`, { method: "PATCH", body: JSON.stringify({ attendees }) });
}

const header = (message, name) => message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value || "";

/** Gmail's own search syntax (from:, subject:, newer_than:2d, is:unread…), newest first. */
export async function searchEmail(key, query) {
  const { messages = [] } = await call(key, `${GMAIL}/messages?${new URLSearchParams({ q: query || "in:inbox", maxResults: "10" })}`);
  return Promise.all(messages.map(async ({ id }) => {
    const message = await call(
      key,
      `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
    );
    return {
      id,
      from: header(message, "From"),
      subject: header(message, "Subject"),
      date: header(message, "Date"),
      snippet: message.snippet,
      unread: message.labelIds?.includes("UNREAD")
    };
  }));
}

/**
 * The mail that arrived since `since` (a Date), newest first, up to 10: each one's id, sender,
 * subject and when it came. For a sign-in code the site has just sent.
 */
export async function recentEmails(key, since) {
  const after = Math.floor(since.getTime() / 1000);
  const { messages = [] } = await call(key, `${GMAIL}/messages?${new URLSearchParams({ q: `after:${after}`, maxResults: "10" })}`);
  const found = await Promise.all(messages.map(async ({ id }) => {
    const message = await call(key, `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
    return { id, from: header(message, "From"), subject: header(message, "Subject"), date: new Date(Number(message.internalDate)).toISOString() };
  }));
  return found.filter((message) => new Date(message.date) >= since).sort((a, b) => b.date.localeCompare(a.date));
}

/** The text of a message part tree: plain text when there is some, otherwise the HTML's words. */
export function bodyText(part) {
  const decode = (data) => Buffer.from(String(data || ""), "base64url").toString("utf8");
  const all = [];
  (function walk(node) {
    if (!node) return;
    if (node.body?.data) all.push({ type: node.mimeType, text: decode(node.body.data) });
    for (const child of node.parts || []) walk(child);
  })(part);
  const plain = all.filter((entry) => entry.type === "text/plain").map((entry) => entry.text).join("\n");
  if (plain.trim()) return plain;
  return all.filter((entry) => entry.type === "text/html").map((entry) => entry.text).join("\n")
    .replace(/<(style|script)[\s\S]*?<\/\1>/giu, " ").replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/[ \t]+/gu, " ").trim();
}

export async function readEmail(key, id) {
  const message = await call(key, `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
  return {
    id,
    threadId: message.threadId,
    messageId: header(message, "Message-ID") || undefined,
    from: header(message, "From"),
    replyTo: header(message, "Reply-To") || undefined,
    to: header(message, "To"),
    cc: header(message, "Cc") || undefined,
    subject: header(message, "Subject"),
    date: header(message, "Date"),
    text: bodyText(message.payload).slice(0, 40000)
  };
}

/** A plain-text email as Gmail takes it: headers and a base64 body, the whole base64url-encoded. */
function rawEmail({ to = [], cc = [], subject, text, inReplyTo }) {
  const encode = (value) => (/[^\x20-\x7E]/u.test(value) ? `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=` : value);
  const raw = [
    ...(to.length ? [`To: ${to.join(", ")}`] : []),
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(inReplyTo?.messageId ? [`In-Reply-To: ${inReplyTo.messageId}`, `References: ${inReplyTo.messageId}`] : []),
    `Subject: ${encode(subject || "")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text || "").toString("base64")
  ].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

/**
 * A plain-text email from the person's own Gmail, as they approved it on the draft card.
 * A reply carries the original's Message-ID and goes into its thread.
 */
export async function sendEmail(key, { to, cc = [], subject, text, inReplyTo }) {
  const sent = await call(key, `${GMAIL}/messages/send`, {
    method: "POST",
    body: JSON.stringify({
      raw: rawEmail({ to, cc, subject, text, inReplyTo }),
      ...(inReplyTo?.threadId ? { threadId: inReplyTo.threadId } : {})
    })
  });
  return { id: sent.id };
}

/**
 * The rest of the mailbox (D-42): who the account is, its labels and filters, whole
 * conversations, drafts saved in Gmail, sorting mail, labels themselves, and forwarding.
 */
export async function mailAccount(key) {
  const [profile, { sendAs = [] }] = await Promise.all([call(key, `${GMAIL}/profile`), call(key, `${GMAIL}/settings/sendAs`)]);
  return {
    address: profile.emailAddress,
    messages: profile.messagesTotal,
    sendAs: sendAs.map((entry) => ({
      address: entry.sendAsEmail,
      name: entry.displayName || undefined,
      ...(entry.isDefault ? { default: true } : {})
    }))
  };
}

export async function mailLabels(key) {
  const { labels = [] } = await call(key, `${GMAIL}/labels`);
  return labels.map((label) => ({ id: label.id, name: label.name, ...(label.type === "system" ? { system: true } : {}) }));
}

export async function mailFilters(key) {
  const [{ filter = [] }, labels] = await Promise.all([call(key, `${GMAIL}/settings/filters`), mailLabels(key)]);
  const named = (ids = []) => ids.map((id) => labels.find((label) => label.id === id)?.name || id);
  return filter.map((entry) => ({
    id: entry.id,
    when: entry.criteria,
    then: {
      ...(entry.action?.addLabelIds ? { addLabels: named(entry.action.addLabelIds) } : {}),
      ...(entry.action?.removeLabelIds ? { removeLabels: named(entry.action.removeLabelIds) } : {}),
      ...(entry.action?.forward ? { forward: entry.action.forward } : {})
    }
  }));
}

/** The conversation a message belongs to, oldest first. */
export async function readThread(key, id) {
  const { threadId } = await call(key, `${GMAIL}/messages/${encodeURIComponent(id)}?format=minimal`);
  const thread = await call(key, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  const messages = (thread.messages || []).map((message) => ({
    id: message.id,
    from: header(message, "From"),
    to: header(message, "To"),
    date: header(message, "Date"),
    text: bodyText(message.payload).slice(0, 8000)
  }));
  return { subject: header(thread.messages?.[0] || {}, "Subject"), messages };
}

const draftOf = (draft) => ({
  id: draft.id,
  to: header(draft.message, "To"),
  cc: header(draft.message, "Cc") || undefined,
  subject: header(draft.message, "Subject"),
  text: bodyText(draft.message?.payload).slice(0, 8000)
});

export async function listDrafts(key) {
  const { drafts = [] } = await call(key, `${GMAIL}/drafts?maxResults=20`);
  return Promise.all(drafts.map(async ({ id }) => {
    const draft = await call(key, `${GMAIL}/drafts/${id}?format=metadata`);
    return { id, to: header(draft.message, "To"), subject: header(draft.message, "Subject"), snippet: draft.message?.snippet };
  }));
}

export async function readDraft(key, id) {
  return draftOf(await call(key, `${GMAIL}/drafts/${encodeURIComponent(id)}?format=full`));
}

export async function createDraft(key, { to = [], cc = [], subject, text }) {
  const draft = await call(key, `${GMAIL}/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw: rawEmail({ to, cc, subject, text }) } })
  });
  return { id: draft.id };
}

/** Only what's given changes; the rest is kept from the draft as it is. */
export async function updateDraft(key, id, change) {
  const now = await readDraft(key, id);
  const list = (value) => String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const next = {
    to: change.to || list(now.to),
    cc: change.cc || list(now.cc),
    subject: change.subject ?? now.subject,
    text: change.text ?? now.text
  };
  await call(key, `${GMAIL}/drafts/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ id, message: { raw: rawEmail(next) } })
  });
  return { id, subject: next.subject };
}

export async function deleteDraft(key, id) {
  await call(key, `${GMAIL}/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendDraft(key, id) {
  const sent = await call(key, `${GMAIL}/drafts/send`, { method: "POST", body: JSON.stringify({ id }) });
  return { id: sent.id };
}

/** A label by its name (or id), as the person calls it. */
async function labelId(key, name) {
  const wanted = String(name || "").trim().toLowerCase();
  const found = (await mailLabels(key)).find((label) => label.id.toLowerCase() === wanted || label.name.toLowerCase() === wanted);
  if (!found) throw new ConnectedAppError(`There's no label called ${name} in this mailbox; list_labels shows them.`);
  return found.id;
}

/** Sorting one message: each action and, with undo, its reverse (out of the bin, not spam, unread…). */
export async function organiseEmail(key, id, { action, undo = false, label }) {
  const url = `${GMAIL}/messages/${encodeURIComponent(id)}`;
  const modify = (add, remove) =>
    call(key, `${url}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
  const swap = (on, off) => (undo ? modify(off, on) : modify(on, off));
  if (action === "bin") {
    await call(key, `${url}/${undo ? "untrash" : "trash"}`, { method: "POST" });
  } else if (action === "archive") {
    await swap([], ["INBOX"]);
  } else if (action === "spam") {
    await swap(["SPAM"], ["INBOX"]);
  } else if (action === "mark_read") {
    await swap([], ["UNREAD"]);
  } else if (action === "star") {
    await swap(["STARRED"], []);
  } else if (action === "label" || action === "move") {
    const target = await labelId(key, label);
    await swap([target], action === "move" ? ["INBOX"] : []);
  } else {
    throw new ConnectedAppError(`Gmail can't ${action}.`);
  }
  return { id };
}

export async function createLabel(key, name) {
  const label = await call(key, `${GMAIL}/labels`, {
    method: "POST",
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" })
  });
  return { id: label.id, name: label.name };
}

export async function renameLabel(key, name, newName) {
  const id = await labelId(key, name);
  const label = await call(key, `${GMAIL}/labels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });
  return { id: label.id, name: label.name };
}

/** Deleting a label keeps its messages; they just lose the label. */
export async function deleteLabel(key, name) {
  await call(key, `${GMAIL}/labels/${encodeURIComponent(await labelId(key, name))}`, { method: "DELETE" });
}

/**
 * A forward as plain text: the person's note, then the original's headers and text. Attachments
 * aren't carried over.
 */
export async function forwardEmail(key, id, { to, note = "" }) {
  const original = await readEmail(key, id);
  const text = [
    note,
    "",
    "---------- Forwarded message ----------",
    `From: ${original.from}`,
    `Date: ${original.date}`,
    `Subject: ${original.subject}`,
    `To: ${original.to}`,
    "",
    original.text
  ].join("\n");
  const subject = /^fwd?:/iu.test(original.subject) ? original.subject : `Fwd: ${original.subject}`;
  const sent = await call(key, `${GMAIL}/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail({ to, subject, text }) })
  });
  return { id: sent.id, subject, attachmentsLeftOut: true };
}

/** People in the person's Google Contacts whose name or address matches. */
export async function findContacts(key, name) {
  const url = (query) =>
    "https://people.googleapis.com/v1/people:searchContacts?" +
    new URLSearchParams({ query, readMask: "names,emailAddresses,phoneNumbers", pageSize: "10" });
  await call(key, url("")).catch(() => null); // Google asks for one empty search first, to warm its cache.
  const { results = [] } = await call(key, url(name));
  return results.map(({ person }) => ({
    name: person.names?.[0]?.displayName || "",
    emails: (person.emailAddresses || []).map((entry) => entry.value),
    phones: (person.phoneNumbers || []).map((entry) => entry.value)
  }));
}

// The person's Drive, with the rest of the Google calls.
export {
  saveFile,
  recentFiles,
  createDocument,
  binFile,
  searchFiles,
  listFolder,
  fileDetails,
  readFileText,
  downloadFile,
  shareFile,
  createFolder,
  createFile,
  updateFile,
  moveFile,
  copyFile,
  listComments,
  addComment
} from "./googleDrive.js";
