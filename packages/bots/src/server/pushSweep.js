import { inQuietHours } from "@local/account/push";

// Sending people the notifications their chats queued (D-133): every few seconds a serving server takes those whose
// time has come, once across servers, and sends each one still unread to its person's devices, as their settings
// allow (that kind on, outside their quiet hours, the message's text or not). A chat's notifications share a tag, so a
// newer one replaces the one before on the device.

const EVERY_MS = 5000;
const BATCH = 100;
// A sweep takes at most this many batches; what's left waits 5 seconds for the next.
const BATCHES_A_SWEEP = 20;
const TEXT_CHARS = 160;
/** What a notification says when its text isn't shown, by its kind. */
const WITHOUT_TEXT = Object.freeze({ results: "A routine finished", waiting: "Waiting for you", messages: "New message" });

/** A message's words for a notification: its text, its question or its line, on one line and short. */
export function noteText(message) {
  const body = message.body || {};
  const words = [body.text, body.question, body.title, body.name, body.detail].find((value) => typeof value === "string" && value.trim());
  const line = String(words || "").replace(/\s+/gu, " ").trim();
  return line.length > TEXT_CHARS ? `${line.slice(0, TEXT_CHARS - 1)}…` : line;
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {{ listByIds: (ids: string[], options?: object) => Promise<Array<{ id: string, slug: string }>> }} dependencies.workspaces
 * @param {{ settingsOf: Function, send: Function, enabled: boolean }} dependencies.push the account's
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {() => Date} [dependencies.now]
 */
export function createPushSweep({ records, workspaces, push, systemContext, now = () => new Date() }) {
  /**
   * One sweep: every notification due, a batch at a time, until a batch comes back short (at most BATCHES_A_SWEEP
   * batches, the rest at the next sweep), so the queue never falls behind how fast it fills. Answers how many it sent.
   */
  async function sweepOnce() {
    let sent = 0;
    for (let batch = 0; batch < BATCHES_A_SWEEP; batch += 1) {
      const { due, claimed } = await records.pushQueue.takeDue(BATCH);
      sent += await sendBatch(due);
      if (claimed < BATCH) break;
    }
    return sent;
  }

  /** One batch of due notifications, sent as their people allow: answers how many went. */
  async function sendBatch(due) {
    if (!due.length || !push.enabled) return 0;
    const pending = await records.pushQueue.stillUnread(due);
    if (!pending.length) return 0;
    const options = { context: systemContext("read the names of the bots and people notifications name, in every home") };
    const idsOf = (pick) => [...new Set(pending.flatMap(pick).filter((id) => id != null).map(String))];
    const botIds = idsOf((note) => [note.chat.directBotId, note.message.authorBotId]);
    const personIds = idsOf((note) => [note.chat.directUserId, note.chat.directPersonId, note.message.authorUserId]);
    const [bots, names, settings, homes] = await Promise.all([
      records.bots.byIds(botIds, options),
      records.chats.names(personIds, options),
      push.settingsOf(pending.map((note) => note.userId)),
      // The links notifications open name their home: every home of the batch, in one read.
      workspaces.listByIds(idsOf((note) => [note.workspaceId]), { context: systemContext("read homes' addresses for their notifications") })
    ]);
    const botName = new Map(bots.map((bot) => [String(bot.id), bot.name]));
    const slugOf = new Map(homes.map((home) => [String(home.id), home.slug]));
    // Two people's direct chat is named after the other one: the pair is kept lower id first (directUserId).
    const otherPerson = ({ chat, userId }) => (String(chat.directPersonId) === String(userId) ? chat.directUserId : chat.directPersonId);
    const at = now();
    const notes = [];
    for (const note of pending) {
      const mine = settings.get(String(note.userId));
      if (!mine?.[note.kind] || inQuietHours(mine, at)) continue;
      const slug = slugOf.get(String(note.workspaceId));
      if (!slug) continue;
      const { authorBotId, authorUserId } = note.message;
      const who = authorBotId != null ? botName.get(String(authorBotId)) : names.get(String(authorUserId));
      const direct = note.chat.directPersonId != null ? names.get(String(otherPerson(note))) : null;
      const place = note.chat.title || botName.get(String(note.chat.directBotId)) || direct || "Mercbot";
      const title = note.chat.title && who ? `${who} in ${place}` : place;
      const text = mine.showText ? noteText(note.message) : "";
      notes.push({
        userId: String(note.userId),
        payload: {
          title,
          body: text || WITHOUT_TEXT[note.kind],
          url: `/w/${encodeURIComponent(slug)}?chat=${encodeURIComponent(String(note.chatId))}`,
          tag: `chat-${note.chatId}`,
          unread: note.unread
        }
      });
    }
    await push.send(notes);
    return notes.length;
  }

  /** Sweeps every few seconds until drained; a failed sweep is logged and the next one tries again. */
  function start() {
    let running = null;
    const timer = setInterval(() => {
      if (running) return;
      running = sweepOnce()
        .catch((error) => console.warn("Sending notifications failed; the next sweep tries again.", error))
        .finally(() => {
          running = null;
        });
    }, EVERY_MS);
    timer.unref();
    return Object.freeze({
      async drain() {
        clearInterval(timer);
        await running;
      }
    });
  }

  return Object.freeze({
    sweepOnce,
    start
  });
}
