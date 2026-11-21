import { computed, ref } from "vue";
import { setupSkillOf } from "@local/bots/shared/templateBody";
import { botsApi } from "./botsApi.js";

/**
 * What a new bot asks first, as the review shows it: its Setup interview's first three numbered steps, each its first
 * clause, without "Ask".
 * @param {{ skills?: Array<{ name: string, instructions: string }> } | null} draft
 */
export function firstQuestions(draft) {
  const steps = (draft?.skills?.length ? setupSkillOf(draft)?.instructions || "" : "").split("\n")
    .map((line) => /^\s*\d+\.\s+(.+)$/u.exec(line)?.[1])
    .filter(Boolean);
  return steps.slice(0, 3).map((step) => {
    const asked = step.replace(/^Ask\s+(?:them\s+|the person\s+)?(?:about\s+)?/iu, "").split(/[.;:?(]/u)[0].trim();
    return asked.charAt(0).toUpperCase() + asked.slice(1);
  });
}

/**
 * Add bots' suggestions (D-109) on the page: what the person described, the plan the server answered (library bots,
 * the home's templates and new ones, each with why, or a question to answer first), and each new bot's template, written
 * one call each, all at once, as soon as the plan shows, so the plan never waits on them. Every bot is ticked but those
 * already in the home; a new bot whose template couldn't be written says so, to try again or leave out. "Change"
 * plans again from the plan before and what to change, keeping the templates already written for the new bots it keeps.
 * Add N bots needs every new bot ticked to be written. Nothing is kept on the server until Add.
 * @param {{ api?: Pick<typeof botsApi, "suggestBots" | "draftTemplate"> }} [options] the routes (botsApi)
 */
export function useBotPlan({ api = botsApi } = {}) {
  const describe = ref("");
  const plan = ref(null);
  const asking = ref(false);
  const failure = ref("");
  // Each new bot's template, by its key: { state: "writing" | "ready" | "failed", draft?, message? }.
  const drafts = ref({});
  const unticked = ref(new Set());

  const question = computed(() => plan.value?.question || "");
  const bots = computed(() => plan.value?.bots || []);
  const adding = computed(() => bots.value.filter((bot) => !bot.inHome && !unticked.value.has(bot.key)));
  const ready = computed(() => adding.value.length > 0 && adding.value.every((bot) => !bot.new || drafts.value[bot.key]?.state === "ready"));

  /** The others suggested with a bot, whose jobs its template leaves out. */
  const othersOf = (bot) => bots.value.filter((other) => other.key !== bot.key).map((other) => ({ name: other.name, description: other.description }));

  /** One new bot's template, written for it; dropped when the plan changed meanwhile. */
  async function write(key) {
    const shown = plan.value;
    const bot = bots.value.find((entry) => entry.key === key);
    if (!bot?.new) return;
    drafts.value = { ...drafts.value, [key]: { state: "writing" } };
    try {
      const { draft } = await api.draftTemplate({
        purpose: "plan-bot",
        describe: describe.value,
        bot: { name: bot.name, tag: bot.tag, description: bot.description },
        team: othersOf(bot)
      });
      if (plan.value === shown) drafts.value = { ...drafts.value, [key]: { state: "ready", draft } };
    } catch (error) {
      const message = error?.status >= 400 && error?.status < 500 ? error.message : "It couldn't be written just now.";
      if (plan.value === shown) drafts.value = { ...drafts.value, [key]: { state: "failed", message } };
    }
  }

  /**
   * A plan for `words`, or with `change`, the plan before changed as asked. Answers the plan, or null when it failed
   * (`failure` says why).
   * @param {string} words
   * @param {string} [change]
   */
  async function suggest(words, change = "") {
    asking.value = true;
    failure.value = "";
    try {
      const { plan: next } = await api.suggestBots(change ? { describe: describe.value, plan: plan.value, change } : { describe: words });
      if (!change) describe.value = words;
      const kept = Object.fromEntries(Object.entries(drafts.value).filter(([key, entry]) => entry.state === "ready" && next.bots.some((bot) => bot.key === key)));
      plan.value = next;
      drafts.value = kept;
      unticked.value = new Set(next.bots.filter((bot) => bot.inHome).map((bot) => bot.key));
      for (const bot of next.bots) if (bot.new && !kept[bot.key]) write(bot.key);
      return next;
    } catch (error) {
      failure.value = error?.status >= 400 && error?.status < 500 ? error.message : "Mercbot couldn't suggest bots just now. Try again.";
      return null;
    } finally {
      asking.value = false;
    }
  }

  /** Ticks a bot, or unticks it: Remove, for a new bot that couldn't be written. */
  function tick(key) {
    const next = new Set(unticked.value);
    if (!next.delete(key)) next.add(key);
    unticked.value = next;
  }

  /** A new bot's template as the person edited it, used in place of the one written. */
  function useDraft(key, draft) {
    drafts.value = { ...drafts.value, [key]: { state: "ready", draft } };
  }

  /** What Add N bots sends: each bot ticked, a new one with its template. */
  const batch = computed(() => ({
    bots: adding.value.map((bot) => {
      if (bot.library) return { library: bot.library };
      const look = { name: bot.name, shape: bot.shape, color: bot.color };
      return bot.home ? { home: bot.home, ...look } : { draft: drafts.value[bot.key].draft, ...look };
    })
  }));

  /** Everything forgotten, for a new start. */
  function reset() {
    describe.value = "";
    plan.value = null;
    failure.value = "";
    drafts.value = {};
    unticked.value = new Set();
  }

  return { describe, plan, question, bots, asking, failure, drafts, unticked, adding, ready, batch, suggest, write, tick, useDraft, reset };
}
