import { inQuietHours } from "@local/account/push";

// Sending people the notifications their chats queued (D-133): every few seconds a serving server takes those whose
// time has come, once across servers, and sends each one still unread to its person's devices, as their settings
// allow (that kind on, outside their quiet hours, the message's text or not). A chat's notifications share a tag, so a
// newer one replaces the one before on the device.

const EVERY_MS = 5000;
const BATCH = 100;
const TEXT_CHARS = 160;
const SLUGS_FOR_MS = 10 * 60 * 1000;
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
 * @param {{ findById: (id: string, options?: object) => Promise<{ slug: string } | null> }} dependencies.workspaces
 * @param {{ settingsOf: Function, send: Function, enabled: boolean }} dependencies.push the account's
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {() => Date} [dependencies.now]
 */
export function createPushSweep({ records, workspaces, push, systemContext, now = () => new Date() }) {
  const slugs = new Map();

  /** A home's address part, kept a while: the link a notification opens. */
  async function slugOf(homeId) {
    const kept = slugs.get(homeId);
    if (kept && now().getTime() - kept.at < SLUGS_FOR_MS) return kept.slug;
    const home = await workspaces.findById(String(homeId), { context: systemContext("read a home's address for its notifications") });
    if (home?.slug) slugs.set(homeId, { slug: home.slug, at: now().getTime() });
    return home?.slug || null;
  }

  /** One sweep: answers how many notifications it sent. */
  async function sweepOnce() {
    const due = await records.pushQueue.takeDue(BATCH);
    if (!due.length || !push.enabled) return 0;
    const pending = await records.pushQueue.stillUnread(due);
    if (!pending.length) return 0;
    const options = { context: systemContext("read the names of the bots and people notifications name, in every home") };
    const idsOf = (pick) => [...new Set(pending.flatMap(pick).filter((id) => id != null).map(String))];
    const botIds = idsOf((note) => [note.chat.directBotId, note.message.authorBotId]);
    const personIds = idsOf((note) => [note.chat.directPersonId, note.message.authorUserId]);
    const [bots, names, settings] = await Promise.all([
      records.bots.byIds(botIds, options),
      records.chats.names(personIds, options),
      push.settingsOf(pending.map((note) => note.userId))
    ]);
    const botName = new Map(bots.map((bot) => [String(bot.id), bot.name]));
    const at = now();
    const notes = [];
    for (const note of pending) {
      const mine = settings.get(String(note.userId));
      if (!mine?.[note.kind] || inQuietHours(mine, at)) continue;
      const slug = await slugOf(String(note.workspaceId));
      if (!slug) continue;
      const { authorBotId, authorUserId } = note.message;
      const who = authorBotId != null ? botName.get(String(authorBotId)) : names.get(String(authorUserId));
      const place = note.chat.title || botName.get(String(note.chat.directBotId)) || names.get(String(note.chat.directPersonId)) || "Mercbot";
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
