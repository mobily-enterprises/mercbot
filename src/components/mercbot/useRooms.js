import { botsApi, notebookChanges } from "./botsApi.js";

/**
 * A shared bot's tabs, its sharing and its notebook notes (D-36). `currentBot` is the open bot,
 * `store` holds the messages (useBotMessages) and `reportFailure` explains a change that failed.
 * @param {{ currentBot: import("vue").ComputedRef<import("../../types.js").Bot>, store: import("../../types.js").BotMessages, reportFailure: import("../../types.js").ReportFailure }} options
 */
export function useRooms({ currentBot, store, reportFailure }) {
  // Switching tab forgets the messages shown, loads the tab's and remembers it for next time.
  async function selectRoom(roomId) {
    const bot = currentBot.value;
    if (roomId === bot.roomId) return;
    store.updateBot({ id: bot.id, roomId, rooms: bot.rooms.map((room) => (room.id === roomId ? { ...room, unread: false } : room)) });
    await store.reloadMessages(bot.id);
    botsApi.update(bot.id, { roomId, unread: false }).catch(() => {});
  }

  async function createRoom(title) {
    const bot = currentBot.value;
    try {
      const result = await botsApi.createRoom(bot.id, { title, from: bot.roomId });
      store.updateBot({ ...result.bot, rooms: [...bot.rooms, { ...result.room, unread: false }] });
      await store.reloadMessages(bot.id);
    } catch (error) {
      reportFailure("That conversation couldn't be started. Try again.", error);
    }
  }

  async function renameRoom({ id, title }) {
    const bot = currentBot.value;
    store.updateBot({ id: bot.id, rooms: bot.rooms.map((room) => (room.id === id ? { ...room, title } : room)) });
    try {
      await botsApi.renameRoom(bot.id, id, title);
    } catch (error) {
      reportFailure("That name didn't save. Try again.", error);
      store.mergeBots((await botsApi.list()).bots);
    }
  }

  // Undo on a "Noted for…" line takes the note out of the home notebook (D-36).
  async function undoNote(message) {
    const botId = currentBot.value.id;
    try {
      const result = await botsApi.removeNote(botId, message.body.noteId);
      if (result.message) store.replaceMessage(botId, result.message);
      notebookChanges.value += 1;
    } catch (error) {
      reportFailure("That note couldn't be taken out. Try again.", error);
    }
  }

  async function keepOutOfNotebook(keep) {
    const bot = currentBot.value;
    try {
      store.updateBot((await botsApi.update(bot.id, { keepOutOfNotebook: keep })).bot);
    } catch (error) {
      reportFailure("That didn't change. Try again.", error);
    }
  }

  // Who sees what in a bot (D-36). Its conversation changes with it, so its messages are read again.
  async function setSharing(sharing) {
    const bot = currentBot.value;
    try {
      store.updateBot((await botsApi.update(bot.id, { sharing })).bot);
      store.mergeBots((await botsApi.list()).bots);
      await store.reloadMessages(bot.id);
    } catch (error) {
      reportFailure("That didn't change. Try again.", error);
    }
  }

  return { selectRoom, createRoom, renameRoom, undoNote, keepOutOfNotebook, setSharing };
}
