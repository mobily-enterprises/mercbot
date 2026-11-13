import { ConnectedAppError, localTime, zoned } from "./connectedApps.js";

// Bots using the person's connected Microsoft account (D-31): Outlook mail, calendar and contacts,
// and OneDrive, through Microsoft Graph. The same calls as googleApps.js, so tools treat both alike.

const GRAPH = "https://graph.microsoft.com/v1.0/me";

async function call(key, url, options = {}) {
  const response = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    ...options,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(30000)
  });
  const body = response.status === 202 || response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (response.status === 401) throw new ConnectedAppError("Microsoft refused: the connection may need signing in again in Connect apps.");
  if (response.status === 403) {
    throw new ConnectedAppError(
      "This Microsoft account didn't allow this access when it was signed in, or its organisation blocks it. Ask the person to sign it in again in Connect apps and allow everything."
    );
  }
  if (!response.ok) throw new ConnectedAppError(body.error?.message || `Microsoft answered ${response.status}.`);
  return body;
}

/** A moment as Graph wants it: UTC, without an offset, with timeZone "UTC" beside it. */
const utc = (local, timeZone) => new Date(zoned(local, timeZone)).toISOString().replace("Z", "");

/** One event as the tools see it, its times in the person's time zone. */
const toEvent = (calendar, event, timeZone) => ({
  id: event.id,
  calendar: calendar?.name,
  title: event.subject || "(no title)",
  start: localTime(`${event.start?.dateTime?.slice(0, 19)}Z`, timeZone),
  end: localTime(`${event.end?.dateTime?.slice(0, 19)}Z`, timeZone),
  location: event.location?.displayName || undefined,
  attendees: event.attendees?.map((person) => person.emailAddress?.address),
  organiser: event.isOrganizer ? "the person" : event.organizer?.emailAddress?.address,
  myAnswer: event.isOrganizer ? undefined : event.responseStatus?.response,
  ...(event.isAllDay ? { allDay: true } : {}),
  ...(event.showAs === "free" ? { blocksTime: false } : {}),
  // One occurrence of a repeating event names the series, for its other occurrences (D-42).
  ...(event.seriesMasterId ? { repeats: event.seriesMasterId } : {})
});
const FIELDS = "subject,start,end,location,attendees,isOrganizer,organizer,responseStatus,isAllDay,showAs,seriesMasterId";

/** What a change left on the calendar, for the bot's report. */
const booked = (event, timeZone) => ({
  title: event.subject,
  start: event.start?.dateTime && localTime(`${event.start.dateTime.slice(0, 19)}Z`, timeZone),
  end: event.end?.dateTime && localTime(`${event.end.dateTime.slice(0, 19)}Z`, timeZone),
  timeZone,
  link: event.webLink,
  guests: (event.attendees || []).map((person) => ({ email: person.emailAddress?.address, answer: person.status?.response }))
});
const IN_UTC = { prefer: 'outlook.timezone="UTC"' };

/** Events on every calendar the person has, between two local times. */
export async function calendarEvents(key, { from, to, timeZone }) {
  const { value: calendars = [] } = await call(key, "/calendars?$select=id,name");
  const query = new URLSearchParams({
    startDateTime: `${utc(from, timeZone)}Z`,
    endDateTime: `${utc(to, timeZone)}Z`,
    $top: "50",
    $orderby: "start/dateTime",
    $select: FIELDS
  });
  const lists = await Promise.all(calendars.map(async (calendar) => {
    const { value = [] } = await call(key, `/calendars/${encodeURIComponent(calendar.id)}/calendarView?${query}`, {
      headers: IN_UTC
    }).catch(() => ({}));
    return value.map((event) => toEvent(calendar, event, timeZone));
  }));
  return { timeZone, events: lists.flat().sort((a, b) => a.start.localeCompare(b.start)) };
}

/** The calendars the person has, with whose they are and whether they may change them (D-42). */
export async function listCalendars(key) {
  const { value = [] } = await call(key, "/calendars?$select=id,name,isDefaultCalendar,canEdit,owner");
  return value.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    ...(calendar.isDefaultCalendar ? { primary: true } : {}),
    owner: calendar.owner?.address,
    access: calendar.canEdit ? "writer" : "reader"
  }));
}

/** The occurrences of a repeating event between two local times, in the person's zone. */
export async function eventOccurrences(key, { eventId, from, to, timeZone }) {
  const query = new URLSearchParams({
    startDateTime: `${utc(from, timeZone)}Z`,
    endDateTime: `${utc(to, timeZone)}Z`,
    $top: "50",
    $select: FIELDS
  });
  const { value = [] } = await call(key, `/events/${encodeURIComponent(eventId)}/instances?${query}`, { headers: IN_UTC });
  return { timeZone, events: value.map((event) => toEvent(null, event, timeZone)) };
}

export async function getCalendarEvent(key, { eventId, timeZone }) {
  return toEvent(null, await call(key, `/events/${encodeURIComponent(eventId)}?$select=${FIELDS}`, { headers: IN_UTC }), timeZone);
}

/** A new event on the person's main calendar; Outlook sends the invitations itself. */
export async function addCalendarEvent(key, { title, start, end, timeZone, location, description, attendees = [] }) {
  const event = await call(key, "/events", {
    method: "POST",
    headers: IN_UTC,
    body: JSON.stringify({
      subject: title,
      start: { dateTime: utc(start, timeZone), timeZone: "UTC" },
      end: { dateTime: utc(end, timeZone), timeZone: "UTC" },
      ...(location ? { location: { displayName: location } } : {}),
      ...(description ? { body: { contentType: "text", content: description } } : {}),
      ...(attendees.length ? { attendees: attendees.map((address) => ({ emailAddress: { address }, type: "required" })) } : {})
    })
  });
  return booked(event, timeZone);
}

/** Moving or retitling an event, or inviting more people to it; Outlook tells the guests. */
export async function changeCalendarEvent(key, { eventId, title, start, end, location, description, attendees = [], timeZone }) {
  const current = await call(key, `/events/${encodeURIComponent(eventId)}?$select=attendees`);
  const known = (current.attendees || []).map((person) => person.emailAddress?.address);
  const event = await call(key, `/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: IN_UTC,
    body: JSON.stringify({
      ...(title ? { subject: title } : {}),
      ...(start ? { start: { dateTime: utc(start, timeZone), timeZone: "UTC" } } : {}),
      ...(end ? { end: { dateTime: utc(end, timeZone), timeZone: "UTC" } } : {}),
      ...(location !== undefined ? { location: { displayName: location } } : {}),
      ...(description !== undefined ? { body: { contentType: "text", content: description } } : {}),
      ...(attendees.length
        ? {
            attendees: [
              ...(current.attendees || []),
              ...attendees.filter((address) => !known.includes(address)).map((address) => ({ emailAddress: { address }, type: "required" }))
            ]
          }
        : {})
    })
  });
  return booked(event, timeZone);
}

/** Removing an event; for a meeting the person organised, Outlook sends the guests a cancellation. */
export async function deleteCalendarEvent(key, { eventId }) {
  await call(key, `/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

// Yes, no or maybe to an invitation; the organiser is told.
const OUTLOOK_ANSWERS = { accept: "accept", decline: "decline", maybe: "tentativelyAccept" };
export async function answerInvitation(key, { eventId, answer }) {
  await call(key, `/events/${encodeURIComponent(eventId)}/${OUTLOOK_ANSWERS[answer]}`, {
    method: "POST",
    body: JSON.stringify({ sendResponse: true })
  });
}

/** Addresses as Graph lists them, and as it takes them. */
const addresses = (list) => (list || []).map((entry) => entry.emailAddress?.address).filter(Boolean).join(", ");
const recipients = (list = []) => list.map((address) => ({ emailAddress: { address } }));

const sender = (message) => {
  const from = message.from?.emailAddress;
  return from ? `${from.name || ""} <${from.address || ""}>`.trim() : "";
};

// Gmail's in: words as Outlook's own folders; any other name is one of the person's folders.
const FOLDERS = {
  inbox: "inbox",
  spam: "junkemail",
  junk: "junkemail",
  trash: "deleteditems",
  bin: "deleteditems",
  sent: "sentitems",
  drafts: "drafts",
  archive: "archive"
};

/**
 * Outlook doesn't understand Gmail's search words, so the common ones are turned into filters:
 * newer_than:Nd, is:unread, from:, subject: and in: (a folder). Anything else is Outlook's own search.
 */
export async function searchEmail(key, query = "") {
  let words = String(query);
  const take = (pattern) => {
    const found = pattern.exec(words);
    if (found) words = words.replace(found[0], " ");
    return found;
  };
  const days = take(/newer_than:(\d+)d/iu);
  const unread = take(/is:unread/iu);
  const from = take(/from:("[^"]+"|\S+)/iu);
  const subject = take(/subject:("[^"]+"|\S+)/iu);
  const inFolder = take(/in:("[^"]+"|\S+)/iu)?.[1].replace(/"/gu, "");
  const folder = inFolder ? FOLDERS[inFolder.toLowerCase()] || await folderId(key, inFolder) : null;
  const rest = [from && `from:${from[1]}`, subject && `subject:${subject[1]}`, words.trim()].filter(Boolean).join(" ");
  const since = days ? new Date(Date.now() - Number(days[1]) * 86400000) : null;
  const select = "$select=id,from,subject,receivedDateTime,bodyPreview,isRead";
  const where = folder ? `/mailFolders/${encodeURIComponent(folder)}/messages` : "/messages";
  const filter = [since && `receivedDateTime ge ${since.toISOString()}`, unread && "isRead eq false"].filter(Boolean).join(" and ");
  const { value = [] } = rest
    ? await call(key, `${where}?$search=${encodeURIComponent(`"${rest.replace(/"/gu, "")}"`)}&$top=25&${select}`)
    : await call(
      key,
      `/mailFolders/${encodeURIComponent(folder || "inbox")}/messages?$top=10&$orderby=receivedDateTime desc&${select}` +
          (filter ? `&$filter=${encodeURIComponent(filter)}` : "")
    );
  return value
    .filter((message) => (!since || new Date(message.receivedDateTime) >= since) && (!unread || !message.isRead))
    .slice(0, 10)
    .map((message) => ({
      id: message.id,
      from: sender(message),
      subject: message.subject || "",
      date: message.receivedDateTime,
      snippet: message.bodyPreview || "",
      unread: !message.isRead
    }));
}

/**
 * The mail that arrived in the inbox since `since` (a Date), newest first, up to 10: each one's id,
 * sender, subject and when it came. For a sign-in code the site has just sent.
 */
export async function recentEmails(key, since) {
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const { value = [] } = await call(
    key,
    `/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime&$filter=${encodeURIComponent(filter)}`
  );
  return value.map((message) => ({ id: message.id, from: sender(message), subject: message.subject || "", date: message.receivedDateTime }));
}

export async function readEmail(key, id) {
  const message = await call(
    key,
    `/messages/${encodeURIComponent(id)}?$select=from,toRecipients,ccRecipients,replyTo,subject,receivedDateTime,body`,
    { headers: { prefer: 'outlook.body-content-type="text"' } }
  );
  return {
    id,
    from: sender(message),
    replyTo: addresses(message.replyTo) || undefined,
    to: addresses(message.toRecipients),
    cc: addresses(message.ccRecipients) || undefined,
    subject: message.subject || "",
    date: message.receivedDateTime,
    text: String(message.body?.content || "").slice(0, 40000)
  };
}

/**
 * A plain-text email from the person's own Outlook, as they approved it on the draft card.
 * A reply goes out as Outlook's own reply, so it stays in the original's conversation.
 */
export async function sendEmail(key, { to, cc = [], subject, text, inReplyTo }) {
  if (inReplyTo?.id) {
    await call(key, `/messages/${encodeURIComponent(inReplyTo.id)}/reply`, {
      method: "POST",
      body: JSON.stringify({ message: { toRecipients: recipients(to), ccRecipients: recipients(cc) }, comment: text })
    });
    return {};
  }
  await call(key, "/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: subject || "",
        body: { contentType: "Text", content: text },
        toRecipients: recipients(to),
        ccRecipients: recipients(cc)
      },
      saveToSentItems: true
    })
  });
  return {};
}

// The rest of the mailbox (D-42), as Gmail's calls do it: who the account is, its
// folders (Outlook's labels), whole conversations, drafts saved in Outlook, sorting mail, folders
// themselves, and forwarding.

export async function mailAccount(key) {
  const me = await call(key, "?$select=displayName,mail,userPrincipalName");
  const address = me.mail || me.userPrincipalName;
  return { address, name: me.displayName || undefined, sendAs: [{ address, default: true }] };
}

export async function mailLabels(key) {
  const { value = [] } = await call(key, "/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount");
  return value.map((folder) => ({ id: folder.id, name: folder.displayName, unread: folder.unreadItemCount, total: folder.totalItemCount }));
}

export async function mailFilters() {
  throw new ConnectedAppError("Outlook's mail rules can't be read through Mercbot; this is for Gmail. Say so in a line.");
}

export async function readThread(key, id) {
  const { conversationId, subject } = await call(key, `/messages/${encodeURIComponent(id)}?$select=conversationId,subject`);
  const { value = [] } = await call(
    key,
    `/messages?$filter=${encodeURIComponent(`conversationId eq '${conversationId}'`)}` +
      "&$top=50&$select=id,from,toRecipients,receivedDateTime,body",
    { headers: { prefer: 'outlook.body-content-type="text"' } }
  );
  const messages = value
    .sort((a, b) => String(a.receivedDateTime).localeCompare(String(b.receivedDateTime)))
    .map((message) => ({
      id: message.id,
      from: sender(message),
      to: addresses(message.toRecipients),
      date: message.receivedDateTime,
      text: String(message.body?.content || "").slice(0, 8000)
    }));
  return { subject: subject || "", messages };
}

export async function listDrafts(key) {
  const { value = [] } = await call(key, "/mailFolders/drafts/messages?$top=20&$select=id,toRecipients,subject,bodyPreview");
  return value.map((draft) => ({
    id: draft.id,
    to: addresses(draft.toRecipients),
    subject: draft.subject || "",
    snippet: draft.bodyPreview || ""
  }));
}

export async function readDraft(key, id) {
  const draft = await call(key, `/messages/${encodeURIComponent(id)}?$select=id,toRecipients,ccRecipients,subject,body,isDraft`, {
    headers: { prefer: 'outlook.body-content-type="text"' }
  });
  if (!draft.isDraft) throw new ConnectedAppError("That message isn't a draft.");
  return {
    id: draft.id,
    to: addresses(draft.toRecipients),
    cc: addresses(draft.ccRecipients) || undefined,
    subject: draft.subject || "",
    text: String(draft.body?.content || "").slice(0, 8000)
  };
}

export async function createDraft(key, { to = [], cc = [], subject, text }) {
  const draft = await call(key, "/messages", {
    method: "POST",
    body: JSON.stringify({
      subject: subject || "",
      body: { contentType: "Text", content: text || "" },
      toRecipients: recipients(to),
      ccRecipients: recipients(cc)
    })
  });
  return { id: draft.id };
}

export async function updateDraft(key, id, change) {
  await readDraft(key, id);
  const patch = {
    ...(change.to ? { toRecipients: recipients(change.to) } : {}),
    ...(change.cc ? { ccRecipients: recipients(change.cc) } : {}),
    ...(change.subject !== undefined ? { subject: change.subject } : {}),
    ...(change.text !== undefined ? { body: { contentType: "Text", content: change.text } } : {})
  };
  const draft = await call(key, `/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  return { id: draft.id || id, subject: draft.subject };
}

export async function deleteDraft(key, id) {
  await readDraft(key, id);
  await call(key, `/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function sendDraft(key, id) {
  await readDraft(key, id);
  await call(key, `/messages/${encodeURIComponent(id)}/send`, { method: "POST" });
  return { id };
}

/** A folder by its name (or id), as the person calls it, or one of Outlook's own by its role. */
async function folderId(key, name) {
  const wanted = String(name || "").trim().toLowerCase();
  const found = (await mailLabels(key)).find((folder) => folder.id.toLowerCase() === wanted || folder.name.toLowerCase() === wanted);
  if (!found) throw new ConnectedAppError(`There's no folder called ${name} in this mailbox; list_labels shows them.`);
  return found.id;
}

/** Sorting one message: each action and, with undo, its reverse. Moving gives the message a new id. */
export async function organiseEmail(key, id, { action, undo = false, label }) {
  const url = `/messages/${encodeURIComponent(id)}`;
  const move = async (destinationId) => ({
    id: (await call(key, `${url}/move`, { method: "POST", body: JSON.stringify({ destinationId }) })).id
  });
  const patch = async (change) => {
    await call(key, url, { method: "PATCH", body: JSON.stringify(change) });
    return { id };
  };
  if (action === "bin") return move(undo ? "inbox" : "deleteditems");
  if (action === "archive") return move(undo ? "inbox" : "archive");
  if (action === "spam") return move(undo ? "inbox" : "junkemail");
  if (action === "mark_read") return patch({ isRead: !undo });
  if (action === "star") return patch({ flag: { flagStatus: undo ? "notFlagged" : "flagged" } });
  if (action === "move") return move(undo ? "inbox" : await folderId(key, label));
  if (action === "label") {
    const { categories = [] } = await call(key, `${url}?$select=categories`);
    const rest = categories.filter((category) => category.toLowerCase() !== String(label).toLowerCase());
    return patch({ categories: undo ? rest : [...rest, label] });
  }
  throw new ConnectedAppError(`Outlook can't ${action}.`);
}

export async function createLabel(key, name) {
  const folder = await call(key, "/mailFolders", { method: "POST", body: JSON.stringify({ displayName: name }) });
  return { id: folder.id, name: folder.displayName };
}

export async function renameLabel(key, name, newName) {
  const folder = await call(key, `/mailFolders/${encodeURIComponent(await folderId(key, name))}`, {
    method: "PATCH",
    body: JSON.stringify({ displayName: newName })
  });
  return { id: folder.id, name: folder.displayName };
}

/** Deleting an Outlook folder moves it, with its mail, to Deleted Items. */
export async function deleteLabel(key, name) {
  await call(key, `/mailFolders/${encodeURIComponent(await folderId(key, name))}`, { method: "DELETE" });
}

/** Outlook's own forward, which keeps the original's attachments. */
export async function forwardEmail(key, id, { to, note = "" }) {
  const { subject = "" } = await call(key, `/messages/${encodeURIComponent(id)}?$select=subject`);
  await call(key, `/messages/${encodeURIComponent(id)}/forward`, {
    method: "POST",
    body: JSON.stringify({ comment: note, toRecipients: recipients(to) })
  });
  return { subject: /^fw:/iu.test(subject) ? subject : `FW: ${subject}` };
}

/** People in the person's Outlook contacts whose name starts with the words given. */
export async function findContacts(key, name) {
  const term = String(name).replace(/'/gu, "''");
  const filter = ["displayName", "givenName", "surname"].map((field) => `startswith(${field},'${term}')`).join(" or ");
  const { value = [] } = await call(
    key,
    `/contacts?$top=10&$select=displayName,emailAddresses,mobilePhone,businessPhones,homePhones&$filter=${encodeURIComponent(filter)}`
  );
  return value.map((person) => ({
    name: person.displayName || "",
    emails: (person.emailAddresses || []).map((entry) => entry.address),
    phones: [person.mobilePhone, ...(person.businessPhones || []), ...(person.homePhones || [])].filter(Boolean)
  }));
}

/**
 * A copy of one of the bot's files in the person's OneDrive, in a Mercbot folder (or another
 * folder, "" for the top level).
 */
export async function saveFile(key, { name, data, folder = "Mercbot" }) {
  const where = folder ? `${encodeURIComponent(folder)}/${encodeURIComponent(name)}` : encodeURIComponent(name);
  const session = await call(key, `/drive/root:/${where}:/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } })
  });
  // The upload address carries its own permission, so it takes no key.
  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: { "content-length": String(data.length), "content-range": `bytes 0-${data.length - 1}/${data.length}` },
    body: data,
    signal: AbortSignal.timeout(120000)
  });
  const file = await response.json().catch(() => ({}));
  if (!response.ok) throw new ConnectedAppError(file.error?.message || `OneDrive answered ${response.status}.`);
  return { id: file.id, name: file.name, link: file.webUrl, modified: file.lastModifiedDateTime };
}

/**
 * Files in the person's own OneDrive: the newest few, and moving one to the
 * recycle bin, which keeps it for 30 days.
 */
const kindOf = (file) => {
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  return (
    {
      docx: "a Word document",
      doc: "a Word document",
      xlsx: "an Excel spreadsheet",
      pptx: "a PowerPoint presentation",
      pdf: "a PDF",
      mp4: "a video",
      jpg: "a picture",
      jpeg: "a picture",
      png: "a picture"
    }[ext] || ""
  );
};

export async function recentFiles(key, limit = 5) {
  const found = await call(key, "/drive/recent").catch(() => null);
  const items = found?.value?.length
    ? found.value.map((item) =>
      item.remoteItem
        ? { ...item.remoteItem, lastModifiedDateTime: item.lastModifiedDateTime || item.remoteItem.lastModifiedDateTime }
        : item)
    : (await call(key, "/drive/root/children?$top=200")).value || [];
  return items
    .filter((item) => !item.folder)
    .sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)))
    .slice(0, limit)
    .map((item) => ({ id: item.id, name: item.name, kind: kindOf(item), modified: item.lastModifiedDateTime, link: item.webUrl }));
}

export async function binFile(key, id) {
  const item = await call(key, `/drive/items/${encodeURIComponent(id)}?$select=name`);
  await call(key, `/drive/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  return { name: item.name, keptDays: 30 };
}

// The rest of the person's OneDrive (D-42), as the Google Drive calls do it. OneDrive
// has no comments through Graph for personal accounts, so those say so.
const ITEM = (id) => `/drive/items/${encodeURIComponent(id)}`;
const toItem = (item) => ({
  id: item.id,
  name: item.name,
  kind: item.folder ? "a folder" : kindOf(item),
  modified: item.lastModifiedDateTime,
  link: item.webUrl,
  ...(item.size !== undefined && !item.folder ? { size: item.size } : {})
});

export async function searchFiles(key, words, limit = 15) {
  const { value = [] } = await call(key, `/drive/root/search(q='${encodeURIComponent(String(words).replace(/'/gu, "''"))}')?$top=${limit}`);
  return value.map(toItem);
}

/** A folder by its id, its path from the top ("Projects/2026") or "" for the top. */
const folderPath = (folder) =>
  !folder || /^(root|top)$/iu.test(folder)
    ? "/drive/root"
    : /^[A-Z0-9!]+$/u.test(folder)
      ? ITEM(folder)
      : `/drive/root:/${folder.split("/").map(encodeURIComponent).join("/")}:`;

export async function listFolder(key, folder = "") {
  const { value = [] } = await call(key, `${folderPath(folder)}/children?$top=50`);
  return value.map(toItem);
}

export async function fileDetails(key, id) {
  const [item, { value: permissions = [] }] = await Promise.all([
    call(key, ITEM(id)),
    call(key, `${ITEM(id)}/permissions`).catch(() => ({}))
  ]);
  return {
    ...toItem(item),
    created: item.createdDateTime,
    description: item.description || undefined,
    owners: [item.createdBy?.user?.displayName].filter(Boolean),
    sharedWith: permissions
      .filter((permission) => !permission.roles?.includes("owner"))
      .map((permission) => ({
        who:
          permission.grantedToV2?.user?.email ||
          permission.grantedToV2?.user?.displayName ||
          (permission.link ? `anyone with the ${permission.link.scope} link` : "someone"),
        role: permission.roles?.join(", ")
      }))
  };
}

async function itemBytes(key, url) {
  const response = await fetch(`${GRAPH}${url}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) await call(key, url);
  return Buffer.from(await response.arrayBuffer());
}

export async function readFileText(key, id) {
  const item = await call(key, ITEM(id));
  if (item.folder) throw new ConnectedAppError(`${item.name} is a folder.`);
  if (!/\.(txt|md|csv|json|xml|html?|log)$/iu.test(item.name)) {
    throw new ConnectedAppError(`${item.name} isn't a text file; download it and read your copy with read_file.`);
  }
  return { name: item.name, text: (await itemBytes(key, `${ITEM(id)}/content`)).toString("utf8").slice(0, 60000) };
}

/** A file's bytes to keep, as it is or converted to PDF (the one format OneDrive converts to). */
export async function downloadFile(key, id, format = "") {
  const item = await call(key, ITEM(id));
  if (item.folder) throw new ConnectedAppError(`${item.name} is a folder.`);
  if (format && format !== "pdf" && !item.name.toLowerCase().endsWith(`.${format.toLowerCase()}`)) {
    throw new ConnectedAppError("OneDrive converts files only to PDF.");
  }
  if (format === "pdf" && !item.name.toLowerCase().endsWith(".pdf")) {
    return { name: `${item.name.replace(/\.[a-z0-9]{1,5}$/iu, "")}.pdf`, data: await itemBytes(key, `${ITEM(id)}/content?format=pdf`) };
  }
  return { name: item.name, data: await itemBytes(key, `${ITEM(id)}/content`) };
}

export async function shareFile(key, id, { email, role = "view", notify = true }) {
  await call(key, `${ITEM(id)}/invite`, {
    method: "POST",
    body: JSON.stringify({
      recipients: [{ email }],
      roles: [role === "edit" ? "write" : "read"],
      requireSignIn: true,
      sendInvitation: Boolean(notify)
    })
  });
  return fileDetails(key, id);
}

export async function createFolder(key, { name, folder = "" }) {
  const made = await call(key, `${folderPath(folder)}/children`, {
    method: "POST",
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" })
  });
  return toItem(made);
}

export async function createFile(key, { name, text, folder = "" }) {
  const parent = folderPath(folder);
  const where =
    parent === "/drive/root"
      ? `/drive/root:/${encodeURIComponent(name)}:`
      : parent.endsWith(":")
        ? `${parent.slice(0, -1)}/${encodeURIComponent(name)}:`
        : `${parent}:/${encodeURIComponent(name)}:`;
  const made = await call(key, `${where}/content?@microsoft.graph.conflictBehavior=rename`, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: text
  });
  return toItem(made);
}

export async function updateFile(key, id, { text, description }) {
  if (description !== undefined) await call(key, ITEM(id), { method: "PATCH", body: JSON.stringify({ description }) });
  if (text !== undefined) {
    const item = await call(key, ITEM(id));
    if (!/\.(txt|md|csv|json|xml|html?)$/iu.test(item.name)) {
      throw new ConnectedAppError("Only text files can have their contents replaced with text; a Word or Excel file needs its own app.");
    }
    await call(key, `${ITEM(id)}/content`, { method: "PUT", headers: { "content-type": "text/plain" }, body: text });
  }
  return fileDetails(key, id);
}

export async function moveFile(key, id, { folder, name }) {
  const parent = folder !== undefined ? await call(key, folderPath(folder)) : null;
  const moved = await call(key, ITEM(id), {
    method: "PATCH",
    body: JSON.stringify({ ...(parent ? { parentReference: { id: parent.id } } : {}), ...(name ? { name } : {}) })
  });
  return toItem(moved);
}

/** OneDrive copies in the background; the copy appears a moment later. */
export async function copyFile(key, id, { name, folder }) {
  const parent = folder !== undefined ? await call(key, folderPath(folder)) : null;
  const item = await call(key, ITEM(id));
  await call(key, `${ITEM(id)}/copy?@microsoft.graph.conflictBehavior=rename`, {
    method: "POST",
    body: JSON.stringify({
      name: name || `Copy of ${item.name}`,
      ...(parent ? { parentReference: { driveId: parent.parentReference?.driveId, id: parent.id } } : {})
    })
  });
  return {
    name: name || `Copy of ${item.name}`,
    kind: kindOf(item),
    note: "OneDrive makes the copy in the background; it appears in a moment."
  };
}

export async function listComments() {
  throw new ConnectedAppError("OneDrive's comments can't be reached through Mercbot; this is for Google Drive. Say so in a line.");
}

export async function addComment() {
  return listComments();
}
