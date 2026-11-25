import { currentPerson, currentWork } from "@local/account/meter";
import { idPairs } from "./searchSchemas.js";

// Notifications waiting to be sent (D-133). A chat's new messages queue one for each of its people they may concern,
// sent a little later only if the message is still unread then, so nobody is told about a chat they're reading.
// Queueing is one insert as the message is written, nothing read; once a person's oldest for a chat is due, the sweep
// takes all of theirs for that chat and sends one, about the newest message, with the most pressing kind.

/** A notification waits this long, then goes if its message is still unread. */
const PUSH_DELAY_MS = 15 * 1000;
/** The kinds of message that wait for the person: a question, a draft or email to approve, an account to connect. */
const WAITING_KINDS = new Set(["choice", "draft", "email", "connect", "approval"]);

/** What the sweep reads of a waiting notification. */
const FIELDS = Object.freeze(["userId", "chatId", "kind", "messageId", "sendAfter"]);
/**
 * The most of the due people's own notifications for their chats one sweep folds in (a claim's own limit): any past it
 * wait for the next sweep, which sends them as one more notification.
 */
const FOLDED_AT_MOST = 1000;
/** How pressing each kind is: the one a person's folded notifications for a chat go as. */
const PRESSING = Object.freeze({ waiting: 3, results: 2, messages: 1 });
/** The search entries the queue adds: the notifications whose time has come, by the database's clock, and by people and chats. */
export const PUSH_QUEUE_SEARCH = Object.freeze({
  due: {
    type: "boolean",
    applyFilter(query, due, { column }) {
      if (due) query.whereRaw("?? <= now()", [column("sendAfter")]);
    }
  },
  // Exact people's notifications for exact chats, each "<user id>:<chat id>".
  pairs: idPairs("userId", "chatId")
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
   * Answers them and how many due rows it claimed: as many as `limit` means more may be due.
   * @param {number} limit
   * @returns {Promise<{ due: Array<Record<string, any>>, claimed: number }>}
   */
  async function takeDue(limit) {
    const options = { context: systemContext("send people the notifications whose time has come, in every home") };
    return pushQueue.withTransaction(options, async (txOptions) => {
      // Each answers its hidden home too: the link its notification opens names it.
      const due = await pushQueue.claim({ filters: { due: true }, sort: ["sendAfter"], take: limit }, { ...txOptions, fields: [...FIELDS, "workspaceId"] });
      if (!due.length) return { due: [], claimed: 0 };
      const pairOf = (row) => `${row.userId}:${row.chatId}`;
      const folded = new Map(due.map((row) => [pairOf(row), { ...row }]));
      // Every one of those people's notifications for those chats, due or not: theirs alone, however many others wait.
      const along = await pushQueue.claim({ filters: { pairs: [...folded.keys()] }, sort: ["id"], take: FOLDED_AT_MOST }, { ...txOptions, fields: FIELDS });
      const taken = new Set(due.map((row) => String(row.id)));
      for (const row of along) {
        const note = folded.get(pairOf(row));
        taken.add(String(row.id));
        if (Number(row.messageId) > Number(note.messageId)) note.messageId = row.messageId;
        if (PRESSING[row.kind] > PRESSING[note.kind]) note.kind = row.kind;
      }
      await pushQueue.deleteWhere({ id: [...taken] }, { ...txOptions, returning: "count" });
      return { due: [...folded.values()], claimed: due.length };
    });
  }

  /**
   * What due notifications are about, in a fixed number of reads however many: each one still unread and not muted,
   * with its chat (title and whose direct chat it is), its message (kind, role, author and text) and its person's
   * unread chats in that home. One whose message was read meanwhile, or whose chat is gone, is left out.
   * @param {Array<{ workspaceId: string, userId: string, chatId: string, kind: string, messageId: string }>} due
   */
  async function stillUnread(due) {
    if (!due.length) return [];
    const options = { context: systemContext("read what people's due notifications are about, in every home") };
    const ids = (field) => [...new Set(due.map((row) => String(row[field])))];
    const [places, chats, said, counts] = await Promise.all([
      chatPeople.queryAll({ filters: { places: due.map((row) => `${row.chatId}:${row.userId}`) }, fields: ["conversationId", "userId", "readUpTo", "unread", "muted"] }, options),
      conversations.queryAll({ filters: { id: ids("chatId") }, fields: ["title", "directBotId", "directUserId", "directPersonId"] }, options),
      messages.queryAll({ filters: { id: ids("messageId") }, fields: ["kind", "role", "body", "authorBotId", "authorUserId"] }, options),
      chatPeople.aggregate({
        groupBy: ["userId", "workspaceId"],
        measures: { unread: { count: "*" } },
        filters: { userIds: ids("userId"), unread: true, muted: false }
      }, options)
    ]);
    const placeOf = new Map(places.map((place) => [`${place.conversationId}:${place.userId}`, place]));
    const chatOf = new Map(chats.map((chat) => [String(chat.id), chat]));
    const messageOf = new Map(said.map((message) => [String(message.id), message]));
    // A person's unread chats in the notification's home, a muted one left out, as the open app counts them for the icon.
    const unreadOf = new Map(counts.map((row) => [`${row.userId}:${row.workspaceId}`, Number(row.unread) || 0]));
    return due.flatMap((row) => {
      const place = placeOf.get(`${row.chatId}:${row.userId}`);
      const chat = chatOf.get(String(row.chatId));
      const message = messageOf.get(String(row.messageId));
      if (!place || !chat || !message || place.muted) return [];
      // Read since: the chat no longer unread for them (read to its end), or read past the message.
      if (!place.unread || Number(place.readUpTo || 0) >= Number(row.messageId)) return [];
      return [{ ...row, chat, message, unread: unreadOf.get(`${row.userId}:${row.workspaceId}`) || 0 }];
    });
  }

  return Object.freeze({
    notePosted,
    takeDue,
    stillUnread
  });
}
