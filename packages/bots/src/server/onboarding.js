// A person's welcome chat (D-10, D-112), and a bot's first chat with a person: a script of steps, each appending messages
// and naming the next; the page waits the step's delay, then asks the server to advance. A step waiting on a card
// (ask-name, home-for, home-people) moves when it's answered, or on when the person types instead.
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "./botsError.js";
import { cloudShape } from "./botRows.js";
import { greetingWith, templateOf } from "./botTemplate.js";
import { writeFirstQuestion, writeGreeting } from "./botWriting.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { createCallerReaders } from "./records/recordRows.js";
import { GENERAL } from "./templates.js";

export const DEFAULT_BOT_NAME = "Mercbot";
export const DEFAULT_BOT_COLOR = "#1C1C1C";
const NAME_IDEAS = ["Juno", "Milo", "Iris", "Otto", "Nova", "Remy", "Ada", "Tansy", "Wren", "Theo"];

function pickNameOptions(random = Math.random) {
  const pool = [...NAME_IDEAS];
  const picked = [];
  while (picked.length < 2) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return [...picked, DEFAULT_BOT_NAME];
}

export function firstNameOf(displayName) {
  const first = String(displayName || "").trim().split(/[\s@._-]+/u)[0] || "";
  return first ? first[0].toUpperCase() + first.slice(1) : "there";
}

const text = (body) => ({ kind: "text", role: "bot", body });

// Phase 3 of a new home's welcome chat (D-109, D-112): once the main bot is named, while the home has no bot but it, it
// asks what the home is for. DESCRIBE opens Add bots on Describe what you need, SHOW_TEAMS on its ready-made sets;
// nothing is added until the person says so there. NO_BOTS, or typing instead, skips it. The teams themselves are never
// listed in the chat.
export const DESCRIBE = "Describe what I need";
export const SHOW_TEAMS = "Show me ready-made sets";
export const NO_BOTS = "Not now";
const ADD_BOTS = Object.freeze({ [DESCRIBE]: "describe", [SHOW_TEAMS]: "teams" });
const homeForCard = () => ({
  kind: "choice",
  role: "bot",
  body: {
    purpose: "home-for",
    question: "What's this home for? I can suggest a few bots to help with it.",
    options: [DESCRIBE, SHOW_TEAMS, NO_BOTS],
    subline: "You see them before anything is added, or just type to skip.",
    chosen: null
  }
});

// Then, for the home's owners and admins while it has no everyone chat: whether anyone else will use it. WITH_OTHERS
// makes the home's everyone chat (public, every member in it, the main bot too, pinned for each person: O9); JUST_ME
// makes nothing, and the chat can still come when someone joins.
export const JUST_ME = "Just me";
export const WITH_OTHERS = "Me and other people";
const peopleCard = () => ({
  kind: "choice",
  role: "bot",
  body: {
    purpose: "home-people",
    question: "Will anyone else use this home?",
    options: [JUST_ME, WITH_OTHERS],
    subline: "With other people, everyone in the home gets a chat together, with me in it.",
    chosen: null
  }
});

// step -> (context) => { messages, next, rename? }
export const ONBOARDING_STEPS = {
  start: ({ firstName }) => ({
    next: "ask-name",
    messages: [
      text({ text: `Good to have you here, ${firstName}. From now on I'll be looking after things for you, at work and at home.` }),
      {
        kind: "choice",
        role: "bot",
        body: {
          purpose: "bot-name",
          question: "First things first: pick a name for me. You're free to rename me any time.",
          options: pickNameOptions(),
          chosen: null
        }
      }
    ]
  }),
  confirm: ({ firstName, chosenName }) => ({
    next: "rename",
    messages: [text({ text: `${chosenName} it is. Nice to meet you properly, ${firstName}!` })]
  }),
  // Named, the main bot asks what the home is for while it has no other bot (`offerBots`), else whether anyone else will
  // use it (`askPeople`), each card waiting at its own step for the answer (onboarding.choiceAnswered).
  rename: ({ chosenName, offerBots = false, askPeople = false }) => ({
    next: offerBots ? "home-for" : askPeople ? "home-people" : "about",
    rename: chosenName,
    messages: [
      { kind: "event", role: "system", body: { text: `Renamed to ${chosenName}` } },
      ...(offerBots ? [homeForCard()] : askPeople ? [peopleCard()] : [])
    ]
  }),
  // After what the home is for is answered: whether anyone else will use it, while that's still worth asking.
  "people-offer": ({ askPeople = false }) => (askPeople ? { next: "home-people", messages: [peopleCard()] } : { next: "about", messages: [] }),
  about: () => ({
    next: "connect",
    messages: [
      text({
        heading: "A bit about how I work:",
        bullets: [
          "I keep going on my own computer while you're away.",
          "I can link up with your apps, like email and calendar, and use them the way you would."
        ]
      }),
      text({
        text:
          "Want to connect your email so I can find something to take off your plate straight away? I'll never send anything without your OK. Or just tell me what you need a hand with."
      })
    ]
  }),
  connect: () => ({
    next: "settle",
    messages: [
      {
        kind: "connect",
        role: "bot",
        body: {
          app: "Gmail",
          subtitle: "Let your bot read and draft email for you",
          footnote: "Your bot always checks with you before changing anything, and you can remove the account at any time."
        }
      }
    ]
  }),
  settle: () => ({ next: "await-nudge", messages: [] }),
  "await-nudge": () => ({
    next: null,
    messages: [text({ text: "Whenever you're ready, the Gmail card above is still there to connect." })]
  }),

  // A bot's first chat with a person (a bot made with New bot or opened from Team, or the main bot meeting someone new):
  // a bot on one of the templates greets with its template's greeting, which starts its setup questions; any other
  // with a generated greeting, then a generated first question.
  "intro-greet": async ({ firstName, bot, model, templateGreeting = "" }) => {
    if (templateGreeting) return { next: null, messages: [text({ text: templateGreeting })] };
    let greeting;
    try {
      greeting = model ? await writeGreeting(model, bot, firstName) : "";
    } catch (error) {
      if (isModelFailure(error)) console.warn(`Bot ${bot.id}'s welcome is the standard one: ${modelFailure(error)}`);
      greeting = "";
    }
    return {
      next: "intro-ask",
      messages: [text({ text: greeting || `Hi ${firstName}, I'm ${bot.name}. Happy to get started whenever you are.` })]
    };
  },
  "intro-ask": async ({ bot, model }) => {
    const multi = Math.random() < 0.5;
    let card;
    try {
      if (!model) throw new Error("No AI for the first question: the home's work is paused.");
      card = await writeFirstQuestion(model, bot, { multi });
    } catch (error) {
      if (isModelFailure(error)) console.warn(`Bot ${bot.id}'s first question is the standard one: ${modelFailure(error)}`);
      card = {
        question: "Where should I start helping?",
        options: ["Research a topic", "Keep an eye on prices", "Sort out bookings"],
        multi
      };
    }
    return {
      next: null,
      messages: [
        {
          kind: "choice",
          role: "bot",
          body: {
            purpose: "first-task",
            question: card.question,
            subline: multi ? "Pick as many as you like" : "",
            multi,
            options: card.options,
            openOption: "Something else",
            chosen: null
          }
        }
      ]
    };
  }
};

/** Whether the caller is one of the home's owners and admins, who decide whether others will use it. */
const managesHome = (options) => hasPermission(options?.context?.permissions || [], "workspace.settings.update");

// Steps waiting on a card, which typing instead moves on to "about".
const WAITING = new Set(["ask-name", "home-for", "home-people"]);

/**
 * The welcome chat and every bot's first chat with a person (D-10, D-112): the person's direct chat with the home's main
 * bot, made at their first visit (POST …/chats/welcome), and the script that runs there and in a new bot's direct chat
 * with its maker. A new home's main bot is made with it, named in the chat; it then asks what the home is for (Add bots,
 * D-109) and whether anyone else will use it (the everyone chat). A turn moves the script through `afterMessage` and
 * `choiceAnswered` (chatTurns.js), in its own transaction. Every method takes the call's options last: the person is
 * its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {{ get: (chatId: string, options: object) => Promise<{ chat: object }> }} dependencies.chats the chat routes'
 *   service (chatMembers.js): a chat as the page shows it
 * @param {import("./types.js").ChatModel} dependencies.model writes a bot's greeting and first question
 * @param {import("@local/account/server/types").Meter} dependencies.meter whether the home's AI work is paused (D-73), and
 *   whose those calls are
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {{ findById: (workspaceId: string, options: object) => Promise<{ name?: string } | null> }} dependencies.workspaces
 *   the home's name, which its everyone chat takes
 */
export function createOnboarding({ records, chats, model, meter, notices, workspaces }) {
  const { bots, chats: store, messages, newBots } = records;
  const { homeOf, personOf } = createCallerReaders();
  const tell = (people, event) => notices.publishEach("bots", people.map(String), event)
    .catch((error) => console.warn("Telling people about onboarding failed; they see it on their next read.", error));

  /**
   * The person's welcome chat: their direct chat with the home's main bot, made once (two first visits at once make
   * one). In a new home the main bot comes with it, on Mercbot's general template, and the chat starts its script at
   * "start"; a home that has one greets a newcomer at "intro-greet". Answers it as the chat list shows it.
   */
  async function welcome(options) {
    const { chat, made } = await retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      await bots.lockHome(txOptions);
      let main = await bots.main(txOptions);
      const made = !main;
      if (!main) {
        main = await bots.create({
          made_by: personOf(txOptions),
          name: DEFAULT_BOT_NAME,
          color: DEFAULT_BOT_COLOR,
          is_main: true,
          library_template: GENERAL.slug,
          template_since: new Date().toISOString()
        }, txOptions);
      }
      const chat = await store.direct(main.id, txOptions, { onboardingStep: made ? "start" : "intro-greet" });
      if ((await messages.latestId(chat.id, txOptions)) === null) {
        await messages.append(chat.id, [{ kind: "timestamp", role: "system", body: { at: new Date().toISOString() } }], txOptions);
      }
      return { chat, made: made ? main : null };
    }));
    if (made) await tell(await store.everyoneIn(options), { type: "bot", botId: String(made.id), change: "created" });
    return chats.get(chat.id, options);
  }

  /** The chat's bot and its script's context: only a direct chat has a script. */
  async function scriptOf(chat, options) {
    if (!chat.direct_bot_id) return null;
    return bots.find(chat.direct_bot_id, options);
  }

  /**
   * The greeting of the template a bot is on, for the person (`firstName`, or "there"): none for Mercbot's general
   * template, whose bot introduces itself with a written greeting.
   */
  async function templateGreeting(bot, firstName, options) {
    const template = await templateOf(bot, records.homeTemplates, options);
    if (!template || (template.source === "library" && template.slug === GENERAL.slug)) return "";
    const words = template.greeting || `Hi {firstName}, I'm ${bot.name}. ${template.description}`;
    return greetingWith({ ...template, greeting: words }, bot.name, firstName === "there" ? "" : firstName);
  }

  /** Whether the welcome chat should still ask what the home is for: while it has no bot but its main one. */
  const offersBots = async (bot, options) => Boolean(bot.is_main) && !(await newBots.anyBesidesMain(options));
  /** Whether it should still ask if anyone else will use the home: of an owner or admin, while it has no everyone chat. */
  const asksPeople = async (bot, options) => Boolean(bot.is_main) && managesHome(options) && !(await store.everyoneChat(options));

  /**
   * The step the page waited for (`expectedStep`), run once: its words come first, outside the transaction (a model
   * call is never held under the chat's lock nor made again when the transaction is retried), then are written only
   * while the chat is still at that step (another page may have moved it on). Answers the messages written and the chat.
   * @param {{ displayName?: string }} user the person, for their first name
   */
  async function advance(chatId, expectedStep, user, options) {
    const before = await store.get(chatId, options);
    const step = before.onboarding_step;
    const bot = await scriptOf(before, options);
    if (!bot || !step || step !== expectedStep || !Object.hasOwn(ONBOARDING_STEPS, step)) {
      return { messages: [], ...(await chats.get(before.id, options)) };
    }
    const chosenName = (await messages.latestOfKind(before.id, "choice", options))?.body?.chosen;
    const firstName = firstNameOf(user?.displayName);
    const offerBots = step === "rename" && (await offersBots(bot, options));
    const askPeople = (step === "rename" || step === "people-offer") && (await asksPeople(bot, options));
    // A paused home (D-73) gets the steps' own words, with no AI call.
    const paused = await meter.pausedMessage(String(bot.workspace_id));
    const result = await meter.track({ botId: String(bot.id) }, async () => ONBOARDING_STEPS[step]({
      firstName,
      chosenName,
      offerBots,
      askPeople,
      templateGreeting: step === "intro-greet" ? await templateGreeting(bot, firstName, options) : "",
      bot: { id: String(bot.id), name: bot.name },
      model: paused ? null : model
    }));
    const written = await retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const chat = await store.lock(before.id, txOptions);
      if (chat.onboarding_step !== step) return [];
      // A new bot's "what first?" card is pointless once the person has already asked for something: it would arrive
      // after their message and stay open.
      const started = step === "intro-ask" && (await messages.hasUserText(chat.id, txOptions));
      const list = (started ? result.messages.filter((message) => message.kind !== "choice") : result.messages)
        .map((message) => (message.role === "bot" ? { ...message, authorBotId: String(bot.id) } : message));
      const appended = await messages.append(chat.id, list, txOptions);
      await store.moveOnboarding(chat.id, step, result.next, txOptions);
      if (result.rename) await bots.update(bot.id, { name: result.rename }, txOptions);
      return appended;
    }));
    // A renamed bot is renamed for everyone in the home.
    if (written.length && step === "rename") {
      await tell(await store.everyoneIn(options), { type: "bot", botId: String(bot.id), change: "changed" });
    }
    return { messages: written, ...(await chats.get(before.id, options)) };
  }

  /** The bot's name chosen on its naming card: the card says so, and the script moves on to confirm it. */
  async function chooseName(chatId, name, options) {
    const changed = await retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const chat = await store.lock(chatId, txOptions, { writing: true });
      const choice = await messages.latestOfKind(chat.id, "choice", txOptions);
      if (chat.onboarding_step !== "ask-name" || choice?.body?.purpose !== "bot-name" || !choice.body.options.includes(name)) {
        throw new BotsError(409, "That choice isn't open any more.", { code: "bots_choice_closed" });
      }
      if (!(await store.moveOnboarding(chat.id, "ask-name", "confirm", txOptions))) {
        throw new BotsError(409, "That choice isn't open any more.", { code: "bots_choice_closed" });
      }
      return messages.setBody(choice.id, { ...choice.body, chosen: name }, txOptions);
    }));
    return { messages: [changed], ...(await chats.get(chatId, options)) };
  }

  /**
   * The person wrote in a chat at a step of its script (chatTurns.js sendMessage, in its transaction): the Gmail nudge
   * isn't needed any more, and a card waiting for its answer is passed over (the turn marks it inactive), so the script
   * carries on without a rename, without bots offered and without the everyone chat. Answers what the turn adds.
   * @param {{ id: string, onboarding_step: string | null }} chat
   */
  async function afterMessage(chat, txOptions) {
    const step = chat.onboarding_step;
    if (step === "await-nudge") await store.moveOnboarding(chat.id, step, null, txOptions);
    if (WAITING.has(step)) await store.moveOnboarding(chat.id, step, "about", txOptions);
    return {};
  }

  /**
   * A card of the script answered (chatTurns.js answerChoice, in its transaction, the card's chosen already set): what
   * the home is for opens Add bots on the page (`addBots`: "describe" or "teams", null for not now) and moves on to
   * whether anyone else will use it; that answer makes the home's everyone chat with the main bot in it, for an owner
   * or admin, and moves on to "about". Any other card adds nothing.
   * @param {{ id: string, onboarding_step: string | null, direct_bot_id?: string | null }} chat
   * @param {{ body: { purpose?: string } }} choice
   * @param {string[]} picks
   */
  async function choiceAnswered(chat, choice, picks, txOptions) {
    const purpose = choice?.body?.purpose;
    if (purpose === "home-for") {
      if (chat.onboarding_step === "home-for") await store.moveOnboarding(chat.id, "home-for", "people-offer", txOptions);
      return { addBots: ADD_BOTS[picks[0]] ?? null };
    }
    if (purpose === "home-people") {
      if (chat.onboarding_step === "home-people") await store.moveOnboarding(chat.id, "home-people", "about", txOptions);
      const bot = await scriptOf(chat, txOptions);
      if (picks[0] === WITH_OTHERS && bot?.is_main && managesHome(txOptions)) {
        const home = await workspaces.findById(homeOf(txOptions), passedOn(txOptions));
        await store.makeEveryoneChat({ title: String(home?.name || "Everyone").slice(0, 80), bots: [String(bot.id)] }, txOptions);
      }
      return {};
    }
    return {};
  }

  /**
   * Bots just added together (a team or Add bots' batch, D-105, D-109) introduced in the person's welcome chat, by the
   * main bot, as one message with a [Message] for each (`team`): they open no chats of their own.
   * @param {Array<{ id: string, name: string, color: string, shape: string }>} added
   */
  async function introduce(added, txOptions) {
    const main = await bots.main(txOptions);
    if (!main || !added.length) return null;
    const chat = await store.direct(main.id, txOptions);
    const names = added.map((bot) => bot.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    await messages.append(chat.id, [{
      kind: "text",
      role: "bot",
      authorBotId: String(main.id),
      body: {
        text: `Your home's new bots are here: ${list}. Start a chat with ${added.length === 1 ? "it" : "one of them"} whenever you like.`,
        team: added.map((bot) => ({ botId: String(bot.id), name: bot.name, color: bot.color, shape: cloudShape(bot.shape) }))
      }
    }], txOptions);
    return String(chat.id);
  }

  return Object.freeze({
    welcome,
    advance,
    chooseName,
    afterMessage,
    choiceAnswered,
    introduce
  });
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ pickNameOptions });
