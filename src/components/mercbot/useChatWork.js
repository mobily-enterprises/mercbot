import { ref } from "vue";
import { chatsApi, sleep } from "./chatsApi.js";

const REPLY_GIVE_UP_MS = 20 * 60 * 1000;

/**
 * Per-chat working state: the status line, the bots working in it (each its own reply, R3), the chat's mood in the
 * sidebar, and asking the chat's bots for their reply. `store` holds the shell's messages (useChatMessages).
 * @param {{ store: import("../../types.js").ChatMessages }} options
 */
export function useChatWork({ store }) {
  const workByChat = ref({});
  const speakersByChat = ref({});
  const moodByChat = ref({});
  const moodTimers = new Map();

  function setWork(chatId, status) {
    workByChat.value = { ...workByChat.value, [chatId]: status };
    if (status) store.updateChat({ id: chatId, preview: status });
  }

  // Play a sequence of [mood, milliseconds] steps on a chat's avatar, ending at idle.
  function playMood(chatId, steps) {
    clearTimeout(moodTimers.get(chatId));
    const [first, ...rest] = steps;
    moodByChat.value = { ...moodByChat.value, [chatId]: first[0] };
    if (first[1] === Infinity) return;
    moodTimers.set(chatId, setTimeout(() => (rest.length ? playMood(chatId, rest) : playMood(chatId, [["idle", Infinity]])), first[1]));
  }

  /** A bot started or finished working in a chat (the "working" event): the bots shown working there. */
  function botWorking(chatId, botId, working) {
    const now = new Set(speakersByChat.value[chatId] || []);
    if (working) now.add(String(botId));
    else now.delete(String(botId));
    speakersByChat.value = { ...speakersByChat.value, [chatId]: [...now] };
  }

  // A long reply finishes on the server in the background. Its page waits for the events to say it's done, and asks
  // again every 30 seconds in case the server running it went away (another then takes it over).
  const replyWaiters = new Map();
  function replyNews(chatId) {
    for (const resolve of replyWaiters.get(chatId) || []) resolve();
    replyWaiters.delete(chatId);
  }
  function waitForReplyNews(chatId, ms) {
    return new Promise((resolve) => {
      replyWaiters.set(chatId, new Set([...(replyWaiters.get(chatId) || []), resolve]));
      setTimeout(resolve, ms);
    });
  }

  // With several people in a chat, only the bots called answer (R3), and maybe none: the page shows a bot working only
  // once the server says one started (workStarted, from the events), and a reply with nothing in it shows nothing.
  const starts = new Map();
  function workStarted(chatId) {
    const start = starts.get(chatId);
    starts.delete(chatId);
    if (start) start();
  }

  /**
   * Asks the chat's bots for their reply and shows them working meanwhile.
   * @param {string} chatId
   * @param {{ untilStarted?: boolean, onStart?: () => void, afterCard?: boolean }} [options] `untilStarted`: show
   *   nothing until the server says a bot started, then run `onStart` too; `afterCard`: the reply follows a card's answer
   */
  async function requestReply(chatId, { untilStarted = false, onStart = () => {}, afterCard = false } = {}) {
    let thinking = null;
    let started = false;
    const start = () => {
      started = true;
      playMood(chatId, [["attention", 500], ["thinking", 1000], ["working", Infinity]]);
      thinking = setTimeout(() => setWork(chatId, workByChat.value[chatId] || "Thinking it over"), 300);
      onStart();
    };
    if (untilStarted) starts.set(chatId, start);
    else start();
    try {
      // The reply comes after the newest message the page has (so a retry can't make two).
      const latest = [...(store.messagesByChat.value[chatId] || [])].reverse().find((message) => /^\d+$/u.test(String(message.id)));
      const after = latest ? latest.id : null;
      // A request that fails (its server restarted or went away) doesn't end the wait: the reply is claimed on the
      // server, so asking again picks it up, or another server takes it over.
      const ask = () =>
        chatsApi
          .reply(chatId, after, { afterCard })
          .catch((error) => (error?.status >= 400 && error?.status < 500 ? Promise.reject(error) : { pending: true }));
      let result = await ask();
      const giveUpAt = Date.now() + REPLY_GIVE_UP_MS;
      while (result.pending && Date.now() < giveUpAt) {
        await waitForReplyNews(chatId, 30000);
        result = await ask();
      }
      if (result.pending) throw new Error("The reply is still going.");
      clearTimeout(thinking);
      if (starts.get(chatId) === start) starts.delete(chatId);
      // No bot was called: nothing to show.
      if (!started && !result.messages?.length) {
        if (result.chat) store.updateChat(result.chat);
        return;
      }
      playMood(chatId, [["concentrating", Infinity]]);
      await sleep(600);
      setWork(chatId, "");
      store.appendMessages(chatId, result.messages);
      if (result.chat) store.updateChat(result.chat);
      playMood(chatId, [["happy", 5000], ["settled", 3000]]);
    } catch {
      clearTimeout(thinking);
      if (starts.get(chatId) === start) starts.delete(chatId);
      setWork(chatId, "");
      playMood(chatId, [["idle", Infinity]]);
      store.appendMessages(chatId, [{ id: `error-${Date.now()}`, kind: "error", role: "system", body: { text: "Couldn't get a reply." } }]);
    }
  }

  // Status phrases change as the work goes on: thinking, then what it's doing, then writing.
  async function describeWork(chatId, messageId) {
    try {
      const result = await chatsApi.activity(chatId, messageId);
      for (const message of result.messages) store.replaceMessage(chatId, message);
      if (!workByChat.value[chatId]) return;
      if (result.status) setWork(chatId, result.status);
      await sleep(2500);
      if (workByChat.value[chatId]) setWork(chatId, "Writing a reply");
    } catch {
      // The status line keeps its general wording.
    }
  }

  return { workByChat, speakersByChat, moodByChat, setWork, playMood, botWorking, replyNews, workStarted, requestReply, describeWork };
}
