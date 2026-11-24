import { currentPerson, currentWork } from "@local/account/meter";
import { idList } from "./searchSchemas.js";

// Notifications waiting to be sent (D-133). A chat's new messages queue one for each of its people they may concern,
// sent a little later only if the message is still unread then, so nobody is told about a chat they're reading.
// Queueing is one insert as the message is written, nothing read; once a person's oldest for a chat is due, the sweep
// takes all of theirs for that chat and sends one, about the newest message, with the most pressing kind.

/** A notification waits this long, then goes if its message is still unread. */
export const PUSH_DELAY_MS = 15 * 1000;
/** The kinds of message that wait for the person: a question, a draft or email to approve, an account to connect. */
const WAITING_KINDS = new Set(["choice", "draft", "email", "connect", "approval"]);

/** How pressing each kind is: the one a person's folded notifications for a chat go as. */
const PRESSING = Object.freeze({ waiting: 3, results: 2, messages: 1 });
/** The most of a person's notifications for one chat the sweep folds into one at a time. */
const FOLDED_AT_MOST = 1000;

/** The search entries the queue adds: the notifications whose time has come, by the database's clock, and by people and chats. */
export const PUSH_QUEUE_SEARCH = Object.freeze({
  due: {
    type: "boolean",
    applyFilter(query, due, { column }) {
      if (due) query.whereRaw("?? <= now()", [column("sendAfter")]);
    }
  },
  userIds: idList("userId"),
  chatIds: idList("chatId")
});

/**
 * Who a chat's new messages notify, and as what (D-133): `results` for a routine's or watch's post, `waiting` for a bot
 * waiting for an answer, approval or sign-in, `messages` for anything else. In a chat of one person (their chat with a
 * bot, or a room only they are in) it's them; in a chat of several people only those the message is for: those a
 * message mentions, and the person a bot's work is for. A direct chat of two people is the other person's too, as
 * a chat of one is. Never its author, nor anyone who muted the chat.
 * @param {Array<{ role: string, kind: string, body?: any, authorUserId?: string | null }>} rows the messages added
 * @param {Array<{ userId: string, muted: boolean }>} people the chat's people
 * @param {{ work: string, personId: string | null, direct?: boolean }} context the work they were added in, and whether
 *   the chat is two people's direct chat
 * @returns {Array<{ userId: string, kind: "results" | "waiting" | "messages" }>}
 */
export function pushRecipients(rows, people, { work, personId, direct = false }) {
  const said = rows.filter((row) => row.role !== "system");
  if (!said.length) return [];
  const last = said.at(-1);
  const kind = said.some((row) => row.role === "bot" && WAITING_KINDS.has(row.kind))
    ? "waiting"
    : last.role === "bot" && work === "background" ? "results" : "messages";
  const authors = new Set(said.map((row) => (row.authorUserId == null ? null : String(row.authorUserId))).filter(Boolean));
  const mentioned = new Set(said.flatMap((row) => (row.body?.mentionedPeople || []).map((person) => String(person.id))));
  const alone = people.length === 1 || direct;
  return people
    .filter((person) => !person.muted && !authors.has(String(person.userId)))
    .filter((person) => alone || mentioned.has(String(person.userId)) || (last.role === "bot" && String(person.userId) === personId))
    .map((person) => ({ userId: String(person.userId), kind }));
}

/**
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the bots' handles
 * @param {(reason: string) => object} dependencies.systemContext the bots' records' system context
 * @param {() => Date} [dependencies.now]
 */
export function createPushQueueRepository({ resources, systemContext, now = () => new Date() }) {
  const { pushQueue, chatPeople, conversations, messages } = resources;

  /**
   * Queues the notifications a chat's new messages make (pushRecipients), in the transaction that added them: one read
   * of the chat's people and one insert, however many people it reaches.
   * @param {string} chatId
   * @param {string} homeId
   * @param {Array<{ id: string, role: string, kind: string, body?: any, authorUserId?: string | null }>} added
   * @param {object} home the call's options in the chat's home, as the system
   * @param {{ direct?: boolean }} [chat] whether the chat is two people's direct chat
   */
  async function notePosted(chatId, homeId, added, home, { direct = false } = {}) {
    const people = await chatPeople.queryAll({ filters: { conversationId: String(chatId) }, fields: ["userId", "muted"] }, home);
    const recipients = pushRecipients(added, people, { work: currentWork(), personId: currentPerson(), direct });
    if (!recipients.length) return;
    const messageId = String(added.at(-1).id);
    const sendAfter = new Date(now().getTime() + PUSH_DELAY_MS).toISOString();
    await pushQueue.createMany(
      recipients.map(({ userId, kind }) => ({ workspaceId: String(homeId), userId, chatId: String(chatId), kind, messageId, sendAfter })),
      { ...home, returning: "none" }
    );
  }

  /**
   * Takes the notifications whose time has come, at most `limit` people's chats, each once across servers: with each,
   * the rest of that person's for that chat, due or not, folded into one about the newest message, as its most
   * pressing kind. Claimed and removed in one short transaction, so sending them (outside it) never holds a lock.
   * @param {number} limit
   */
  async function takeDue(limit) {
    const options = { context: systemContext("send people the notifications whose time has come, in every home") };
    return pushQueue.withTransaction(options, async (txOptions) => {
      const due = await pushQueue.claim({ filters: { due: true }, sort: ["sendAfter"], take: limit }, txOptions);
      if (!due.length) return [];
      const ids = (field) => [...new Set(due.map((row) => String(row[field])))];
      const along = await pushQueue.claim({ filters: { userIds: ids("userId"), chatIds: ids("chatId") }, sort: ["id"], take: FOLDED_AT_MOST }, txOptions);
      const pairOf = (row) => `${row.userId}:${row.chatId}`;
      const folded = new Map(due.map((row) => [pairOf(row), { ...row }]));
      const taken = new Set(due.map((row) => String(row.id)));
      // Another person's, or another chat's, read alongside: theirs stays for its own time.
      for (const row of along) {
        const note = folded.get(pairOf(row));
        if (!note) continue;
        taken.add(String(row.id));
        if (Number(row.messageId) > Number(note.messageId)) note.messageId = row.messageId;
        if (PRESSING[row.kind] > PRESSING[note.kind]) note.kind = row.kind;
      }
      await pushQueue.deleteWhere({ id: [...taken] }, { ...txOptions, returning: "count" });
      return [...folded.values()];
    });
  }

  /**
   * How many chats have news for each of these people (D-133): unread for them in every home, a chat they muted left
   * out. It's the number on their app's icon, one icon a device: a notification's, and with the app open its other
   * homes' (`exceptHomeId`, the one it shows, whose chats the page counts itself). One query however many.
   * @param {string[]} userIds
   * @param {{ exceptHomeId?: string | null }} [which]
   * @returns {Promise<Map<string, number>>}
   */
  async function unreadChats(userIds, { exceptHomeId = null } = {}) {
    const options = { context: systemContext("count people's chats with news in every home, for their app's icon") };
    const filters = { userIds: userIds.map(String), unread: true, muted: false };
    if (exceptHomeId != null) filters.notWorkspaceId = String(exceptHomeId);
    const counts = await chatPeople.aggregate({ groupBy: ["userId"], measures: { unread: { count: "*" } }, filters }, options);
    return new Map(counts.map((row) => [String(row.userId), Number(row.unread) || 0]));
  }

  /**
   * What due notifications are about, in a fixed number of reads however many: each one still unread and not muted,
   * with its chat (title and whose direct chat it is), its message (kind, role, author and text) and its person's
   * chats with news (unreadChats). One whose message was read meanwhile, or whose chat is gone, is left out.
   * @param {Array<{ workspaceId: string, userId: string, chatId: string, kind: string, messageId: string }>} due
   */
  async function stillUnread(due) {
    if (!due.length) return [];
    const options = { context: systemContext("read what people's due notifications are about, in every home") };
    const ids = (field) => [...new Set(due.map((row) => String(row[field])))];
    const [places, chats, said, unreadOf] = await Promise.all([
      chatPeople.queryAll({ filters: { conversationIds: ids("chatId"), userIds: ids("userId") }, fields: ["conversationId", "userId", "readUpTo", "unread", "muted"] }, options),
      conversations.queryAll({ filters: { id: ids("chatId") }, fields: ["title", "directBotId", "directUserId", "directPersonId"] }, options),
      messages.queryAll({ filters: { id: ids("messageId") }, fields: ["kind", "role", "body", "authorBotId", "authorUserId"] }, options),
      unreadChats(ids("userId"))
    ]);
    const placeOf = new Map(places.map((place) => [`${place.conversationId}:${place.userId}`, place]));
    const chatOf = new Map(chats.map((chat) => [String(chat.id), chat]));
    const messageOf = new Map(said.map((message) => [String(message.id), message]));
    return due.flatMap((row) => {
      const place = placeOf.get(`${row.chatId}:${row.userId}`);
      const chat = chatOf.get(String(row.chatId));
      const message = messageOf.get(String(row.messageId));
      if (!place || !chat || !message || place.muted) return [];
      // Read since: the chat no longer unread for them (read to its end), or read past the message.
      if (!place.unread || Number(place.readUpTo || 0) >= Number(row.messageId)) return [];
      return [{ ...row, chat, message, unread: unreadOf.get(String(row.userId)) || 0 }];
    });
  }

  return Object.freeze({
    notePosted,
    takeDue,
    stillUnread,
    unreadChats
  });
}
