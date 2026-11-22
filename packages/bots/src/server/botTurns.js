import fs from "node:fs";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { buildTools } from "./botTools.js";
import { vaultPasswords } from "./vaultLogins.js";
import { describeRun, validTimeZone } from "./routineSchedule.js";
import { PICTURE_LIMIT, pictureType } from "./botAgent.js";
import { planningNotes } from "@jskit-ai/agent-runtime/server";
import { accountTitle, turnPerson } from "./connectedApps.js";
import { blankPasswords } from "./replyChecks.js";
import { templateOf } from "./botTemplate.js";
import { memoryToolsFor } from "./memoryTools.js";

/**
 * What a bot is told and given for one turn (D-14): the current state the server writes for the model, the pictures
 * it sees, its tools, and the vault passwords blanked from what it says. Each takes the turn's call
 * options (`call`) last: the model's reader (records.readers.forBot) for the bot in its chat and the person it works for.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {ReturnType<typeof import("./botKnowledge.js").createBotKnowledge>} dependencies.knowledge what each bot knows (D-107)
 * @param {import("./types.js").BotMemory} dependencies.memory what each bot remembers, and the
 *   home's notes (D-113)
 * @param {{ findById: (userId: string, options: object) => Promise<{ email?: string } | null> }} dependencies.profiles users.profiles
 * @param {import("@local/account/server/types").Account} dependencies.account the account capability (vault logins)
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").ChatModel} dependencies.model
 * @param {import("./types.js").Approvals} dependencies.approvals
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("@local/files/server/types").Files} dependencies.files
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("./types.js").BotRequests} dependencies.requests
 * @param {ReturnType<typeof import("./botCards.js").createBotCards>} dependencies.cards
 */
export function createBotTurns({
  records,
  knowledge,
  memory,
  profiles,
  account,
  env,
  model,
  approvals,
  computer,
  integrations,
  files,
  apps,
  requests,
  cards
}) {
  /**
   * Passwords from the home's vault, blanked out of a reply: a bot may read one on a
   * page or a form, but never writes it in the chat.
   */
  async function withoutSecrets(text, call) {
    if (!text) return text;
    const secrets = await vaultPasswords(account, env, call).catch(() => []);
    return blankPasswords(
      secrets.filter((secret) => secret.length >= 4).reduce((result, secret) => result.split(secret).join("•••"), text)
    );
  }

  /** The bot's folders in this chat (R6): the chat's, its own and the home's (D13 keeps a private chat's wider ones read-only). */
  const filePlace = (seat) => files.store.placeFor({
    homeId: seat.workspace_id,
    chatId: seat.chat_id,
    chatKind: seat.chat.kind,
    botId: seat.id
  });

  /** The newest of the chat's, the bot's own and the home's shared files, so it can find what was made earlier (D-21). */
  async function recentFiles(seat) {
    try {
      const { chat = [], bot = [], shared = [] } = await files.store.list(filePlace(seat));
      const recent = [...chat, ...bot, ...shared].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 12);
      return recent.length ? recent.map((file) => file.path).join("; ") : "none";
    } catch (error) {
      // A home's Google Drive to sign in again (D-80) says so, so the bot can tell the person.
      return error?.code === "files_storage_sign_in_again" ? `unavailable: ${error.message}` : "unavailable right now";
    }
  }

  /**
   * The home's signed-in accounts from Connect apps (D-31, D-111), in any chat (R4), each with who connected it, e.g.
   * "Gmail (pat@example.com, connected by them)": a mailbox someone else connected shows its sign-in codes and links to
   * no bot but theirs. The account whose address is the asker's own sign-in is theirs: "my calendar" means it.
   */
  async function connectedAccounts(seat, call) {
    const reachable = await integrations.reachableAccounts(call);
    // Grouped per app, so "Gmail: 2 accounts" is never read as three mailboxes.
    const own = String((await profiles.findById(seat.user_id, passedOn(call)))?.email || "").toLowerCase();
    const person = turnPerson(call);
    const connectedOnes = reachable.filter((entry) => entry.status === "connected");
    const names = await integrations.namesOf([...new Set(connectedOnes.map((entry) => entry.userId))], call);
    const byApp = new Map();
    for (const connected of connectedOnes) {
      const app = integrations.appName(connected.pluginId);
      const by = connected.userId === person ? "them" : names.get(connected.userId) || "someone else in the home";
      const ownAddress = own && String(connected.label || "").toLowerCase() === own ? "the person's own, " : "";
      const title = `${accountTitle(connected) || "address unknown"} (${ownAddress}connected by ${by})`;
      byApp.set(app, [...(byApp.get(app) || []), title]);
    }
    const connected = [...byApp]
      .map(([app, titles]) => `${app}: ${titles.length > 1 ? `${titles.length} accounts, ` : ""}${titles.join("; ")}`)
      .join(". ");
    // Accounts added but not signed in yet, so the bot can mention them.
    const waiting = reachable.filter((entry) => entry.status === "needs-auth");
    const waitingText = waiting.length
      ? ` Added but waiting for sign-in in Connect apps: ${waiting
        .map((entry) => `${integrations.appName(entry.pluginId)}${accountTitle(entry) ? ` (${accountTitle(entry)})` : ""}`)
        .join("; ")}.`
      : "";
    return `${connected || "none signed in"}.${waitingText}`;
  }

  // The asker's own skills the state names (read_skill opens any of them by name).
  const SKILLS_SHOWN = 30;

  /**
   * How much of the chat the bot reads, for the state note, when it was invited after the chat had started and reads it
   * from a message on (its seat's start): from when, and how many earlier messages it doesn't see. None otherwise.
   */
  async function windowLines(seat, timeZone, call) {
    if (!seat.chat_bot_id || seat.reads_from_message_id == null) return [];
    const window = await records.chats.windowOf({ conversation_id: seat.chat_id, reads_from_message_id: seat.reads_from_message_id }, call);
    if (!window?.earlier) return [];
    const earlier = `${window.earlier} earlier ${window.earlier === 1 ? "message isn't" : "messages aren't"} in your view`;
    return [
      `- You read this chat from ${describeRun(window.from, timeZone)}: ${earlier}. If someone asks you to read further ` +
        "back, call read_further_back."
    ];
  }

  /** What this chat is, for the state note (R5): its name and kind, who's in it, and who asked. */
  async function chatLines(seat, present, call) {
    const { chat } = seat;
    const people = present?.people ?? await records.chats.people(seat.chat_id, call);
    const bots = (present?.bots ?? await records.chats.bots(seat.chat_id, call)).filter((bot) => !bot.archived_at);
    const asker = people.find((person) => String(person.user_id) === String(seat.user_id))?.name
      ?? (await records.chats.names([seat.user_id], call)).get(String(seat.user_id)) ?? "the person";
    const name = chat.direct_bot_id ? `the direct chat between ${asker} and you` : `"${chat.title || "Untitled chat"}"`;
    const kind = chat.kind === "public" ? "public: everyone in this home can open it" : "private: only the people in it can open it";
    const others = bots.filter((bot) => String(bot.bot_id) !== String(seat.id)).map((bot) => bot.name);
    return [
      `- This chat: ${name}, ${kind}.${chat.everyone ? " It's the home's chat with everyone in it." : ""}`,
      `- People in it: ${people.map((person) => person.name).join(", ") || "nobody yet"}. ${
        others.length ? `The other bots in it: ${others.join(", ")}.` : "You're the only bot in it."
      }${seat.chat_bot_id ? "" : " You aren't in it: you're working on a request from it."}`,
      `- Who you're working for now: ${asker}. Cards you make are for ${asker}, and only ${asker} can answer them.`
    ];
  }

  /**
   * What's true right now, written by the server for the model each turn (D-14), with the parts of the bot's searched
   * knowledge that match the person's latest message (D-107; `known`, turnTools' knowledge). The chat's own framing
   * (R5) is here, not in the instructions, so their start is the same in every chat of the bot. Last come what the bot
   * remembers (D-113): the home's notes, and in a turn that `remembers` (a person's chat, not a routine's or a
   * request's run) its digest of its public chats and "since then", so the chat before it stays cached.
   * @param {object} seat the bot in the chat, for its asker (chatTurns.js)
   * @param {Array<object>} history
   * @param {{ timeZone: string, language?: string, turnedOff?: string[], known?: object | null, present?: object, remembers?: boolean }} turn
   * @param {object} call the model's reader
   */
  async function currentState(seat, history, { timeZone, language = "", turnedOff = [], known = null, present = null, remembers = false }, call) {
    const latest = [...history].reverse().find((message) => message.role === "user" && message.kind === "text")?.body?.text || "";
    const status = seat.chat_bot_id ? await computer.status(String(seat.chat_bot_id)) : null;
    const routines = seat.chat_bot_id ? await records.work.routinesOf(seat.chat_bot_id, call) : [];
    const skills = await integrations.skillNames(call, { limit: SKILLS_SHOWN });
    // An app's chat with the Builder (owner, 2026-10-30).
    const chatApp = seat.chat.app_id ? await apps.apps.findApp(String(seat.chat.app_id), call) : null;
    // An archived bot (D-108) isn't offered: it takes no requests.
    const otherBots = (await records.directory.listHomeBots(call)).filter((bot) => String(bot.id) !== String(seat.id) && !bot.archived);
    const approvals = history
      .filter(
        (message) => message.kind === "choice" && message.body.purpose === "approval" && !message.body.chosen && !message.body.inactive &&
          String(message.authorBotId) === String(seat.id)
      )
      .map((message) => message.body.question);
    const folders = seat.chat.kind === "private"
      ? "/files/chat (this chat's), and /files/bot and /files/shared to read (saving there needs share_file and a person's OK, as this chat is private)"
      : "/files/chat (this chat's), /files/bot (yours, in every chat you're in) and /files/shared (the home's)";
    return [
      "Current state, from the system. It is the truth; earlier messages may be out of date:",
      ...(await chatLines(seat, present, call)),
      // A person's chat the bot joined after it started: how much of it it reads.
      ...(remembers ? await windowLines(seat, timeZone, call) : []),
      `- Their time zone: ${timeZone}. It's now ${describeRun(new Date(), timeZone)} there.`,
      ...(language ? [`- Their language: ${language}. Reply in it unless they write to you in another language.`] : []),
      ...(chatApp ? [`- This chat is for the app "${chatApp.name}" (slug ${chatApp.slug}); work on that app here.`] : []),
      `- Your computer in this chat: ${
        !status
          ? "not here yet; using it adds you to this chat"
          : status.control
            ? `${status.control.name} has control of it: wait until they hand it back`
            : status.state === "awake" ? `awake, showing ${status.url || "a blank page"}` : "asleep"
      }. Everyone who can open this chat can use what it's signed in to.`,
      `- Hand-over: ${
        seat.waiting_task
          ? `waiting for the person to: ${seat.waiting_task}`
          : "none pending. The person can't reach your screen right now; if they want it, call ask_for_help, because saying it in words does nothing"
      }.`,
      `- Waiting for their approval: ${approvals.length ? approvals.join("; ") : "nothing"}.`,
      `- Secure form: ${
        history.some((message) => message.kind === "secure_form" && message.body.status === "pending" && String(message.authorBotId) === String(seat.id))
          ? "waiting for the person to fill it in"
          : "none open"
      }.`,
      `- The other bots in this home (ask_bot, message_bot): ${otherBots.map((bot) => bot.name).join(", ") || "none"}.`,
      `- The home's connected accounts, which you use for the person you're working for: ${await connectedAccounts(seat, call)}`,
      ...(turnedOff.length
        ? [
            `- Switched off in Connect apps, so never do these, not with the app's ` +
              `tools and not on its website in your browser either: ${turnedOff.join("; ")}. If ` +
              `asked, say in a line that they're switched off in Connect apps and can be turned ` +
              `back on there; don't try another way.`
          ]
        : []),
      `- The person's own skills (use read_skill): ${
        skills.length
          ? skills
            .map((skill) => `${skill.name}${skill.description ? ` (${skill.description})` : ""}`)
            .join("; ")
          : "none"
      }.`,
      `- Your folders here: ${folders}.`,
      `- Recent files you can open, kept by Mercbot (not a Google Drive or ` +
        `OneDrive; use list_drive_files for those): ${await recentFiles(seat)}.`,
      `- Your routines in this chat: ${
        routines.length
          ? routines
            .map((routine) => `${routine.name} (${routine.enabled ? routine.schedule : "paused"}${
              routine.cron ? `; cron ${routine.cron} in ${routine.timezone}` : ""
            })`)
            .join("; ")
          : "none"
      }.`,
      // The job's open to-do list and the bot's notes (D-48), so they outlast summaries and restarts.
      ...(seat.chat_bot_id ? await planningNotes(records.turns.planning(call), seat.chat_bot_id) : []),
      // As it changes with every message: what its searched knowledge says about the latest one (D-107).
      ...(await knowledge.stateLines(seat, known, latest, call)),
      // Last: the home's notes, and what it remembers of its other chats (D-113).
      ...(await memory.stateLines(seat, { timeZone, remembers }, call))
    ].join("\n");
  }

  /**
   * The pictures attached to the person's latest message, loaded so the model sees them.
   * Older pictures stay a note; the bot looks again with read_file when asked about one.
   */
  async function withPictures(seat, history) {
    const index = history.findLastIndex((message) => message.kind === "text" && message.role === "user");
    const latest = history[index];
    if (!latest?.body.attachments?.length) return history;
    const attachments = await Promise.all(latest.body.attachments.map(async (file) => {
      const mediaType = pictureType(file.path);
      if (!mediaType) return file;
      try {
        const { real } = await files.store.existingFile(filePlace(seat), file.path);
        const data = await fs.promises.readFile(real);
        return data.length > PICTURE_LIMIT ? file : { ...file, picture: { data, mediaType } };
      } catch {
        return file;
      }
    }));
    return history.with(index, { ...latest, body: { ...latest.body, attachments } });
  }

  /**
   * The reply may use the bot's actions: results land before the text, approval cards after it.
   * A routine run replies the same way, to the scheduler's prompt instead of a message. Passing a task on
   * (message_bot) is a request too (D-46, O22): the other bot answers in this chat.
   */
  function requestToolsFor(seat, turn, { timeZone, language }, call) {
    const working = turn.working && String(turn.working.toBotId) === String(seat.id) ? turn.working : null;
    const asking = turn.asking && turn.asking.status === "question" ? turn.asking : null;
    const zone = validTimeZone(timeZone) ? timeZone : "UTC";
    return {
      ask: (name, brief) => requests.ask({ fromSeat: seat, name, brief, parent: working, timeZone: zone, language }, call),
      handOff: (name, brief) => requests.ask({ fromSeat: seat, name, brief, kind: "pass", parent: working, timeZone: zone, language }, call),
      answer: working && working.kind === "ask" ? (text) => requests.answer(working, text, call) : null,
      askBack: working && working.kind === "ask" ? (question) => requests.askBack(working, question, call) : null,
      answerBot: asking ? (text) => requests.answerBot(asking, text, call) : null
    };
  }

  /**
   * A bot's tools for one turn in one chat, for the person it works for (R4): the home's accounts, vault and apps in
   * any chat, its computer the chat's (D14). A request's bot that isn't in the asking chat (O22) has no seat until its
   * computer is first used: `join` seats it then and answers its chat_bots id. A turn that `remembers` searches and
   * reads its other chats (recall, read_chat), and one that `tells` (the person's own) may ask to tell everyone (D-113).
   */
  async function turnTools(
    seat,
    {
      timeZone,
      language,
      turn,
      routineRun = false,
      routine = null,
      appsVia = null,
      place = null,
      post,
      join = null,
      goalOperations = null,
      inbox = null,
      remembers = false,
      tells = false
    },
    call
  ) {
    // Actions switched off for an app in Connect apps: the home's (plugin_actions_off).
    const toolSwitches = await integrations.toolSwitches(call);
    /** The home's Builder gets the Apps tools and, in its instructions, what scripts can do. */
    const isBuilder = (await apps.apps.builder(call))?.id === String(seat.id);
    // The template it points at (D-98), whose skills it reads with read_skill.
    const template = await templateOf(seat, records.homeTemplates, call);
    // What it knows (D-107): in its instructions, and searched with its tools and in the current state.
    const known = await knowledge.forTurn(seat, call);
    const run = buildTools({
      call,
      records,
      profiles,
      account,
      env,
      model,
      approvals,
      computer,
      files,
      seat,
      join,
      routineRun,
      routine,
      botSkills: template?.skills || [],
      apps,
      appsVia,
      isBuilder,
      integrations,
      place: place || filePlace(seat),
      toolSwitches,
      settleDraft: (messageId, input) => cards.settleDraft(seat.chat_id, messageId, input, call),
      // Requests between bots (D-46): the one this bot is working on here, and the one it asked
      // and owes an answer to. A turn the runner started for a bot is viaBot.
      requestTools: requestToolsFor(seat, turn, { timeZone, language }, call),
      viaBot: Boolean(turn.viaBot),
      workingRequestId: turn.working?.id ?? null,
      goalOperations,
      inbox,
      post,
      knowledgeTools: knowledge.toolsFor(seat, known, call),
      memoryTools: memoryToolsFor({
        records,
        memory,
        seat,
        turn: { remembers, tells, timeZone, home: tells ? await memory.homeName(seat.workspace_id, call) : "" },
        withoutSecrets: (text) => withoutSecrets(text, call),
        call
      })
    });
    return { run, isBuilder, toolSwitches, template, knowledge: known };
  }

  /**
   * Whether the home has a connected account of the app (R4: the home's, in any chat).
   * @param {object} seat
   * @param {string} pluginId
   * @param {import("./types.js").CallOptions} call
   */
  function hasConnected(_seat, pluginId, call) {
    return integrations.hasConnected(pluginId, call);
  }

  /** A bot's words in a public chat ask for its chat's bots' memory refreshes, in the background (D-113). */
  function remembered(seat) {
    if (seat.chat?.kind === "public") memory.noticedLater(seat.workspace_id, seat.chat_id);
  }

  return Object.freeze({
    remembered,
    withoutSecrets,
    filePlace,
    currentState,
    withPictures,
    turnTools,
    hasConnected
  });
}
