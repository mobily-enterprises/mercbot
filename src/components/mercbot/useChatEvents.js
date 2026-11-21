import { onBeforeUnmount, onMounted, ref } from "vue";
import { chatsApi } from "./chatsApi.js";
import { homePath } from "./homeApi.js";
import { homeChanges, useHomes } from "./homesApi.js";

/**
 * News from any server about this person's chats and their home (D-15, D-112): a chat's new messages, its bots
 * starting and finishing work, a change to the chat itself or its members, a person taking over or handing back a
 * bot's computer, the home's bots and people changing. `store` holds the chats and messages (useChatMessages), `work`
 * the status lines and moods (useChatWork), `team` the home's members (useTeam).
 * @param {{
 *   store: import("../../types.js").ChatMessages,
 *   work: import("../../types.js").ChatWork,
 *   team: ReturnType<typeof import("./useTeam.js").useTeam>,
 *   onDropped: (chatId: string) => void,
 *   onComputer: (news: { chatId: string, botId: string, control: string | null }) => void
 * }} options `onDropped` hears of a chat gone for this person, after it's off the list; `onComputer` of who has a
 *   bot's computer in a chat now (a person's id, or null for its bot)
 */
export function useChatEvents({ store, work, team, onDropped, onComputer }) {
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

  // A chat's new messages: read only what changed, if it's loaded here; the row again. A chat the list doesn't have
  // (someone started one with this person) brings the whole list.
  async function chatNews(chatId) {
    if (!store.knowsChat(chatId)) {
      const { chats, startedAt } = await chatsApi.list({ hidden: true, archived: true });
      store.mergeChats(chats, startedAt);
      return;
    }
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
  }

  function onWorking(event) {
    const { chatId, botId, working, status } = JSON.parse(event.data);
    if (working) work.workStarted(chatId);
    work.botWorking(chatId, botId, working);
    const alreadyWorking = ["attention", "thinking", "working"].includes(work.moodByChat.value[chatId]);
    if (!working && !(work.speakersByChat.value[chatId] || []).length) work.playMood(chatId, [["happy", 5000], ["settled", 3000]]);
    else if (working && !alreadyWorking) work.playMood(chatId, [["attention", 500], ["thinking", 1500], ["working", Infinity]]);
    // Background work such as learning a taught task names its steps on the status line.
    if (status || !working) work.setWork(chatId, working ? status : "");
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
    events.addEventListener("messages", (event) => {
      const { chatId } = JSON.parse(event.data);
      chatNews(String(chatId)).catch(() => {});
      work.replyNews(String(chatId));
    });
    // A chat made, renamed, archived, unarchived or deleted, or its members changed: told to its people and to anyone
    // just taken out of it.
    events.addEventListener("chat", (event) => {
      const { chatId, change } = JSON.parse(event.data);
      if (change === "deleted") drop(String(chatId));
      else if (change === "created" && !store.knowsChat(String(chatId))) chatNews(String(chatId)).catch(() => {});
      else readChat(String(chatId));
    });
    // Someone took over a bot's computer in a chat, or handed it back (D16): its panel reads it again.
    events.addEventListener("computer", (event) => {
      const { chatId, botId, control = null } = JSON.parse(event.data);
      const key = `${chatId} ${botId}`;
      computerNews.value = { ...computerNews.value, [key]: (computerNews.value[key] || 0) + 1 };
      onComputer({ chatId: String(chatId), botId: String(botId), control: control == null ? null : String(control) });
    });
    // The home's bots changed (made, changed, archived, unarchived, deleted): told to everyone in the home.
    events.addEventListener("bot", (event) => {
      const { botId, change } = JSON.parse(event.data);
      if (change === "deleted") team.dropBot(String(botId));
      else team.loadBots();
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
