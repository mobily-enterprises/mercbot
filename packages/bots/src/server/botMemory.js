import { personName } from "@local/homes/server/personName";
import { nextRunAt } from "./routineSchedule.js";
import { BotsError } from "./botsError.js";

/**
 * What the bots keep for the person: lasting memories, the home notebook (D-36) and routines.
 * Every method takes the call's options last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 */
export function createBotMemory({ records, conversations }) {
  const { conversations: store, messages, work } = records;

  /** What the person's bots remember about them in this home. */
  async function memories(options) {
    const rows = await store.memoriesOf(options);
    return { memories: rows.map((row) => ({ id: String(row.id), fact: row.fact, createdAt: new Date(row.created_at).toISOString() })) };
  }

  async function forgetMemory(memoryId, options) {
    if (!(await store.forgetMemory(String(memoryId), options))) {
      throw new BotsError(404, "That isn't remembered.", { code: "bots_memory_not_found" });
    }
    return { deleted: String(memoryId) };
  }

  /** A page of a mixed bot's home notebook (D-36), newest first; `after` is the `next` of the page before. */
  async function notebook(botId, { manages = false, after = null } = {}, options) {
    const row = await conversations.ownedBot(botId, options);
    const userId = conversations.personOf(options);
    const { notes, next } = await store.notesOf(row.id, options, { after });
    const authors = await store.profilesOf(notes.map((note) => note.source_user_id), options);
    return {
      notes: notes.map((note) => ({
        id: String(note.id),
        text: note.text,
        author: String(note.source_user_id) === userId ? "you" : personName(authors.get(String(note.source_user_id))) || "someone",
        createdAt: new Date(note.created_at).toISOString(),
        canRemove: manages || String(note.source_user_id) === userId
      })),
      next
    };
  }

  /** Undo from the chat, or tidying from the notebook: the note's author, an owner or an admin. */
  async function removeNote(botId, noteId, { manages = false } = {}, options) {
    const row = await conversations.ownedBot(botId, options);
    const note = await store.noteOf(row.id, String(noteId), options);
    if (!note) throw new BotsError(404, "That note isn't in the notebook.", { code: "bots_note_not_found" });
    if (!manages && String(note.source_user_id) !== conversations.personOf(options)) {
      throw new BotsError(403, "Only whoever it came from, or the home's owners and admins, can remove it.", {
        code: "bots_note_remove_forbidden"
      });
    }
    await store.removeNote(note.id, options);
    return { removed: String(note.id), message: await messages.markNoteRemoved(note.id, options) };
  }

  /**
   * Routines are created and changed from chat; here they're listed, paused,
   * resumed and deleted. Resuming counts the next run from now, so no backlog runs at once, and
   * starts its count of failures in a row again (a routine pauses itself at five).
   */
  const toRoutine = (routine) => ({
    id: String(routine.id),
    name: routine.name,
    schedule: routine.schedule,
    enabled: Boolean(routine.enabled)
  });

  async function routines(botId, options) {
    const row = await conversations.ownedBot(botId, options);
    return (await work.routinesOf(row.conversation_id, options)).map(toRoutine);
  }

  // readable-check: allow setter-seam - not a slot: switches a routine off or on
  async function setRoutineEnabled(botId, routineId, enabled, options) {
    const row = await conversations.ownedBot(botId, options);
    const routine = await work.routineOf(String(routineId), row.conversation_id, options);
    if (!routine) throw new BotsError(404, "Routine not found.", { code: "bots_routine_not_found" });
    const changes = { enabled: Boolean(enabled), ...(enabled ? { failures: 0 } : {}) };
    if (changes.enabled && routine.cron) changes.nextRunAt = nextRunAt(routine.cron, routine.timezone);
    const changed = await work.changeRoutine(routine.id, changes, options);
    if (!changed) throw new BotsError(404, "Routine not found.", { code: "bots_routine_not_found" });
    return toRoutine(changed);
  }

  async function deleteRoutine(botId, routineId, options) {
    const row = await conversations.ownedBot(botId, options);
    if (!(await work.deleteRoutine(String(routineId), row.conversation_id, options))) {
      throw new BotsError(404, "Routine not found.", { code: "bots_routine_not_found" });
    }
    return { deleted: String(routineId) };
  }

  return Object.freeze({
    memories,
    forgetMemory,
    notebook,
    removeNote,
    routines,
    // readable-check: allow setter-seam - not a slot: switches a routine off or on
    setRoutineEnabled,
    deleteRoutine
  });
}
