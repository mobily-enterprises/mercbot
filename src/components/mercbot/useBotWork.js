import { ref } from "vue";
import { botsApi, sleep } from "./botsApi.js";

const REPLY_GIVE_UP_MS = 20 * 60 * 1000;

/**
 * Per-bot working state: the status line text and the avatar's mood, and asking a
 * bot for its reply. `store` holds the shell's messages (useBotMessages).
 * @param {object} options
 * @param {import("vue").Ref<Array<Record<string, any>>>} options.bots The shell's list.
 */
export function useBotWork({ bots, store }) {
  const workByBot = ref({});
  const speakersByBot = ref({});
  const moodByBot = ref({});
  const moodTimers = new Map();

  function setWork(botId, status) {
    workByBot.value = { ...workByBot.value, [botId]: status };
    if (status) store.updateBot({ id: botId, preview: status });
  }

  // Play a sequence of [mood, milliseconds] steps on a bot's avatar, ending at idle.
  function playMood(botId, steps) {
    clearTimeout(moodTimers.get(botId));
    const [first, ...rest] = steps;
    moodByBot.value = { ...moodByBot.value, [botId]: first[0] };
    if (first[1] === Infinity) return;
    moodTimers.set(botId, setTimeout(() => (rest.length ? playMood(botId, rest) : playMood(botId, [["idle", Infinity]])), first[1]));
  }

  // A long reply finishes on the server in the background. Its page waits for the bot
  // events to say it's done, and asks again every 30 seconds in case the server running it went
  // away (another then takes it over).
  const replyWaiters = new Map();
  function replyNews(botId) {
    for (const resolve of replyWaiters.get(botId) || []) resolve();
    replyWaiters.delete(botId);
  }
  function waitForReplyNews(botId, ms) {
    return new Promise((resolve) => {
      replyWaiters.set(botId, new Set([...(replyWaiters.get(botId) || []), resolve]));
      setTimeout(resolve, ms);
    });
  }

  async function requestReply(botId) {
    const group = bots.value.find((bot) => bot.id === botId)?.kind === "group";
    playMood(botId, [["attention", 500], ["thinking", 1000], ["working", Infinity]]);
    const thinking = setTimeout(() => setWork(botId, workByBot.value[botId] || (group ? "Picked it up" : "Thinking it over")), 300);
    try {
      // The reply comes after the newest message the page has (so a retry can't make two).
      const latest = [...(store.messagesByBot.value[botId] || [])].reverse().find((message) => /^\d+$/u.test(String(message.id)));
      const after = latest ? latest.id : null;
      // A request that fails (its server restarted or went away) doesn't end the wait: the reply
      // is claimed on the server, so asking again picks it up, or another server takes it over.
      const room = store.roomOf(botId);
      const ask = () =>
        botsApi
          .reply(botId, after, room)
          .catch((error) => (error?.status >= 400 && error?.status < 500 ? Promise.reject(error) : { pending: true }));
      let result = await ask();
      const giveUpAt = Date.now() + REPLY_GIVE_UP_MS;
      while (result.pending && Date.now() < giveUpAt) {
        await waitForReplyNews(botId, 30000);
        result = await ask();
      }
      if (result.pending) throw new Error("The reply is still going.");
      clearTimeout(thinking);
      playMood(botId, [["concentrating", Infinity]]);
      await sleep(600);
      setWork(botId, "");
      // A reply from a tab the person has since left shows when they go back to it.
      if (store.roomOf(botId) === room) store.appendMessages(botId, result.messages);
      store.updateBot(result.bot);
      playMood(botId, [["happy", 5000], ["settled", 3000]]);
    } catch {
      clearTimeout(thinking);
      setWork(botId, "");
      playMood(botId, [["idle", Infinity]]);
      store.appendMessages(botId, [{ id: `error-${Date.now()}`, kind: "error", role: "system", body: { text: "Couldn't get a reply." } }]);
    }
  }

  // Status phrases change as the work goes on: thinking, then what it's doing, then writing.
  async function describeWork(botId, messageId) {
    try {
      const result = await botsApi.activity(botId, messageId);
      for (const message of result.messages) store.replaceMessage(botId, message);
      if (!workByBot.value[botId]) return;
      if (result.status) setWork(botId, result.status);
      await sleep(2500);
      if (workByBot.value[botId]) setWork(botId, "Writing a reply");
    } catch {
      // The status line keeps its general wording.
    }
  }

  return { workByBot, speakersByBot, moodByBot, setWork, playMood, replyNews, requestReply, describeWork };
}
