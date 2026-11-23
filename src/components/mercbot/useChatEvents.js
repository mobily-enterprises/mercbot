import { onBeforeUnmount, onMounted, ref } from "vue";
import { chatsApi } from "./chatsApi.js";
import { homePath } from "./homeApi.js";
import { homeChanges, useHomes } from "./homesApi.js";
import { heardTyping } from "./useChatTyping.js";

/**
 * News from any server about this person's chats and their home (D-15, D-112): a chat's new messages, someone in it
 * typing (useChatTyping.js), its bots starting and finishing work, a change to the chat itself or its members, a person taking over or handing back a
 * bot's computer, the home's bots and people changing. `store` holds the chats and messages (useChatMessages), `work`
 * the status lines and moods (useChatWork), `team` the home's members (useTeam).
 * @param {{
 *   store: import("../../types.js").ChatMessages,
 *   work: import("../../types.js").ChatWork,
 *   team: ReturnType<typeof import("./useTeam.js").useTeam>,
 *   onDropped: (chatId: string) => void,
 *   onComputer: (news: { chatId: string, botId: string, control: string | null }) => void,
 *   onRooms: () => void
 * }} options `onDropped` hears of a chat gone for this person, after it's off the list; `onComputer` of who has a
 *   bot's computer in a chat now (a person's id, or null for its bot); `onRooms` of any chat's change, and of a
 *   reconnect, so the public rooms the person isn't in are read again
 */
export function useChatEvents({ store, work, team, onDropped, onComputer, onRooms }) {
  let events = null;
  const { current: here, load: loadHomes } = useHomes();
  // Counts each bot's computer news in each chat ("<chatId> <botId>" → n), so an open computer panel reads it again.
  const computerNews = ref({});

  function drop(chatId) {
    store.dropChat(chatId);
    onDropped(chatId);
  }

  // A chat read again: its row as the server answers it, or off the list once the person can't open it (404).
  async function readChat(chatId) {
    try {
      store.updateChat((await chatsApi.get(chatId)).chat);
    } catch (error) {
      if (error?.status === 404) drop(chatId);
    }
  }

  // The whole list read again, once.
  async function readList() {
    const { chats, startedAt } = await chatsApi.list({ hidden: true, archived: true });
    store.mergeChats(chats, startedAt);
  }

  // A chat's new messages: read only what changed, if it's loaded here; the row again. A chat the list doesn't have
  // (someone started one with this person) brings the whole list.
  async function chatNews(chatId) {
    if (!store.knowsChat(chatId)) return readList();
    await Promise.all([store.catchUp(chatId), readChat(chatId)]);
  }

  // After a reconnect, anything missed meanwhile: the list, each loaded chat from its cursor, and the team (D-19).
  async function catchUpAll() {
    const [{ chats, startedAt }] = await Promise.all([
      chatsApi.list({ hidden: true, archived: true }),
      ...Object.keys(store.messagesByChat.value).map(store.catchUp),
      team.load()
    ]);
    store.mergeChats(chats, startedAt);
    onRooms();
  }

  function onWorking(event) {
    const { chatId, botId, working, status } = JSON.parse(event.data);
    if (working) work.workStarted(chatId);
    work.botWorking(chatId, botId, working);
    const alreadyWorking = ["attention", "thinking", "working"].includes(work.moodByChat.value[chatId]);
    if (!working && !(work.speakersByChat.value[chatId] || []).length) work.playMood(chatId, [["happy", 5000], ["settled", 3000]]);
    else if (working && !alreadyWorking) work.playMood(chatId, [["attention", 500], ["thinking", 1500], ["working", Infinity]]);
    // Background work such as learning a taught task names its steps on the status line. Everyone in the chat sees a
    // bot working (R9): a page that didn't ask shows the asker's general wording, until the last working bot stops;
    // the asker's own wording, and a status a bot named, stay as they are.
    const stillWorking = (work.speakersByChat.value[chatId] || []).length > 0;
    if (status && working) work.setWork(chatId, status);
    else if (working && !work.workByChat.value[chatId]) work.setWork(chatId, "Thinking it over");
    else if (!working && !stillWorking) work.setWork(chatId, "");
    if (!working) work.replyNews(chatId);
  }

  function listen() {
    events = new EventSource(homePath("/bot-events"));
    // After a reconnect (its server went away), catch up on anything missed meanwhile (D-19).
    let connectedBefore = false;
    events.addEventListener("open", () => {
      if (connectedBefore) catchUpAll().catch(() => {});
      connectedBefore = true;
    });
    events.addEventListener("working", onWorking);
    events.addEventListener("typing", (event) => heardTyping(JSON.parse(event.data)));
    events.addEventListener("messages", (event) => {
      const { chatId } = JSON.parse(event.data);
      chatNews(String(chatId)).catch(() => {});
      work.replyNews(String(chatId));
    });
    // A chat made, renamed, archived, unarchived or deleted, or its members changed: told to its people and to anyone
    // just taken out of it, and a public room's to everyone in the home, whose faded rooms change with it.
    events.addEventListener("chat", (event) => {
      const { chatId, change } = JSON.parse(event.data);
      onRooms();
      if (change === "deleted") drop(String(chatId));
      else if (change === "created" && !store.knowsChat(String(chatId))) chatNews(String(chatId)).catch(() => {});
      else readChat(String(chatId));
    });
    // Someone took over a bot's computer in a chat, or handed it back (D16): its panel reads it again.
    events.addEventListener("computer", (event) => {
      // `control` is who has it now, `{ userId, since, name }`, or null (computerControl.js tell): passed on as their id.
      const { chatId, botId, control = null } = JSON.parse(event.data);
      const key = `${chatId} ${botId}`;
      computerNews.value = { ...computerNews.value, [key]: (computerNews.value[key] || 0) + 1 };
      onComputer({ chatId: String(chatId), botId: String(botId), control: control?.userId == null ? null : String(control.userId) });
    });
    // The home's bots changed (made, changed, archived, unarchived, deleted): told to everyone in the home. A listed
    // chat holding the bot shows its name and face too (its row, a direct chat's title), so then the list is read again.
    events.addEventListener("bot", (event) => {
      const { botId, change } = JSON.parse(event.data);
      const id = String(botId);
      if (change === "deleted") team.dropBot(id);
      else team.loadBots();
      const holds = (chat) => String(chat.directBotId) === id || (chat.bots || []).some((bot) => String(bot.botId) === id);
      if (store.chatsNow().some(holds)) readList().catch(() => {});
    });
    // A home's people changed (D-36). If it changed this person's place in the home open here (removed, or a new role),
    // the page starts again so everything reflects it.
    events.addEventListener("home-changed", async () => {
      const before = here.value;
      await loadHomes({ fresh: true }).catch(() => {});
      const after = here.value;
      if (before && (!after || after.role !== before.role)) window.location.reload();
      else {
        homeChanges.value += 1;
        team.loadPeople();
      }
    });
  }

  onMounted(listen);
  onBeforeUnmount(() => events?.close());
  return { computerNews, readChat };
}
