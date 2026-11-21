import { computed, ref } from "vue";
import { botsApi } from "./botsApi.js";
import { peopleApi, roleLabel } from "./homesApi.js";

/** A person of the home as the Team page, New chat and Chat details show them. */
export const toPerson = (member) => ({
  id: String(member.userId),
  name: member.displayName || String(member.email || "").split("@")[0] || "Someone",
  role: member.roleSid || "member",
  roleLabel: roleLabel(member.roleSid)
});

/**
 * The home's members (D3: people and bots alike): its people, from JSKIT's members list, and its bots, from the bots'
 * list, read when the shell opens and again when news says they changed. Every screen that lists members (Team, New
 * chat, Chat details, the composer's @) reads these.
 * @param {{ homeSlug: () => string, reportFailure: import("../../types.js").ReportFailure }} options
 */
export function useTeam({ homeSlug, reportFailure }) {
  // null until the first read answers; a failed read leaves the last answer (or null, which the screens show as failed).
  const bots = ref(null);
  const people = ref(null);
  const failed = ref(false);

  // Reads can answer out of order: only the one begun last is applied, so an older answer never drops a newer bot.
  let botsRead = 0;
  let peopleRead = 0;
  async function loadBots() {
    const read = ++botsRead;
    try {
      const answer = (await botsApi.list()).bots;
      if (read === botsRead) bots.value = answer;
    } catch (error) {
      failed.value = true;
      reportFailure("Your team didn't load. Try again in a moment.", error);
    }
  }

  async function loadPeople() {
    const read = ++peopleRead;
    try {
      const answer = (await peopleApi.members(homeSlug())).map(toPerson);
      if (read === peopleRead) people.value = answer;
    } catch (error) {
      failed.value = true;
      reportFailure("Your team didn't load. Try again in a moment.", error);
    }
  }

  function load() {
    failed.value = false;
    return Promise.all([loadBots(), loadPeople()]);
  }

  /** One bot's new fields, as the bots' list answers it. */
  function updateBot(bot) {
    if (!bot?.id) return;
    const known = (bots.value || []).some((entry) => entry.id === bot.id);
    bots.value = known ? bots.value.map((entry) => (entry.id === bot.id ? { ...entry, ...bot } : entry)) : [...(bots.value || []), bot];
  }

  /** A bot that's gone (deleted). */
  function dropBot(botId) {
    bots.value = (bots.value || []).filter((bot) => bot.id !== botId);
  }

  const botById = (botId) => (bots.value || []).find((bot) => bot.id === String(botId)) || null;
  const personById = (userId) => (people.value || []).find((person) => person.id === String(userId)) || null;
  // What's offered to add to a chat or @-mention: never an archived bot (D-108).
  const activeBots = computed(() => (bots.value || []).filter((bot) => !bot.archivedAt));
  const mainBot = computed(() => (bots.value || []).find((bot) => bot.isMain) || null);

  return { bots, people, failed, load, loadBots, loadPeople, updateBot, dropBot, botById, personById, activeBots, mainBot };
}
