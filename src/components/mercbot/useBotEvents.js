import { onBeforeUnmount, onMounted } from "vue";
import { botsApi } from "./botsApi.js";
import { homePath } from "./homeApi.js";
import { homeChanges, useHomes } from "./homesApi.js";

/**
 * News from any server about this person's bots (D-15): a routine run starting or
 * finishing animates the avatar, and what changed in a chat is read from the server. `store` holds
 * the messages (useBotMessages), `work` the moods and replies (useBotWork), and `dropBot` takes a
 * conversation that's gone off the list.
 * @param {{ store: import("../../types.js").BotMessages, work: import("../../types.js").BotWork, dropBot: (botId: string) => void }} options
 */
export function useBotEvents({ store, work, dropBot }) {
  let botEvents = null;
  const { current: here, load: loadHomes } = useHomes();

  // News reads that one bot again (D-15); a bot the page doesn't know yet, or one it can no
  // longer read, brings the whole list.
  const readBot = (botId) => (store.knowsBot(botId) ? botsApi.bot(botId).catch(() => botsApi.list()) : botsApi.list());
  function showBot(listed) {
    if (listed.bot) store.updateBot(listed.bot);
    else store.mergeBots(listed.bots, listed.startedAt);
  }

  // A chat's news also reads only what changed in it, if it's loaded here. News for another tab
  // of a shared bot only updates the bot, which marks that tab unread.
  async function refreshBot(botId, roomId = null) {
    const elsewhere = Boolean(roomId) && roomId !== store.roomOf(botId);
    const [listed] = await Promise.all([readBot(botId), elsewhere ? null : store.catchUp(botId)]);
    // After the messages, so the bot's preview is the server's.
    showBot(listed);
  }

  // After a reconnect, anything missed meanwhile: the list, and each loaded chat from its cursor (D-19).
  async function catchUpAll() {
    const [{ bots: list, startedAt }] = await Promise.all([botsApi.list(), ...Object.keys(store.messagesByBot.value).map(store.catchUp)]);
    store.mergeBots(list, startedAt);
  }

  function onWorking(event) {
    const { botId, working, status, speakers } = JSON.parse(event.data);
    work.speakersByBot.value = { ...work.speakersByBot.value, [botId]: working ? speakers || [] : [] };
    const alreadyWorking = ["attention", "thinking", "working"].includes(work.moodByBot.value[botId]);
    if (!working) work.playMood(botId, [["happy", 5000], ["settled", 3000]]);
    else if (!alreadyWorking) work.playMood(botId, [["attention", 500], ["thinking", 1500], ["working", Infinity]]);
    // Background work such as learning a taught task names its steps on the status line.
    if (status || !working) work.setWork(botId, working ? status : "");
    if (!working) work.replyNews(botId);
  }

  function listen() {
    botEvents = new EventSource(homePath("/bot-events"));
    // After a reconnect (its server went away), catch up on anything missed meanwhile (D-19).
    let connectedBefore = false;
    botEvents.addEventListener("open", () => {
      if (connectedBefore) catchUpAll().catch(() => {});
      connectedBefore = true;
    });
    botEvents.addEventListener("working", onWorking);
    botEvents.addEventListener("messages", (event) => {
      const { botId, roomId } = JSON.parse(event.data);
      refreshBot(botId, roomId).catch(() => {});
      work.replyNews(botId);
    });
    // Taken out of a group, or it ended (D-46): it leaves the list.
    botEvents.addEventListener("removed", (event) => dropBot(JSON.parse(event.data).botId));
    // A bot's sharing mode or its tabs changed (D-36): that bot is read again.
    botEvents.addEventListener("changed", async (event) => {
      const { botId } = JSON.parse(event.data);
      const before = store.roomOf(botId);
      showBot(await readBot(botId));
      if (store.roomOf(botId) !== before && store.messagesByBot.value[botId]) await store.reloadMessages(botId);
    });
    // A home's people changed (D-36). If it changed this person's place in the home open here
    // (removed, or a new role), the page starts again so everything reflects it.
    botEvents.addEventListener("home-changed", async () => {
      const before = here.value;
      await loadHomes({ fresh: true }).catch(() => {});
      const after = here.value;
      if (before && (!after || after.role !== before.role)) window.location.reload();
      else homeChanges.value += 1;
    });
  }

  onMounted(listen);
  onBeforeUnmount(() => botEvents?.close());
}
