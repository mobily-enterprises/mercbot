import { languageName } from "./botWriting.js";
import { toMessage } from "./botRows.js";
import { validTimeZone } from "./routineSchedule.js";
import { withoutPaths } from "./botAgent.js";
import { LEAKED_MARKUP, reportsActions, stoppedShort, toolRecord, withoutClosingWords, withoutMarkup } from "@jskit-ai/agent/server";
import { startResumer as startRunResumer } from "@jskit-ai/agent-runtime/server";
import { refusalOf } from "@local/account/meter";
import { settledWithin } from "./backgroundWork.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";
import { HAND_OVER_MS, RUN_LEASE, RunTakenOver, handOverRuns, keepLease, tellHandedOver } from "./runLease.js";
import { escape, mentionMarkers, mentionsIn, peopleNamed, withMentions } from "./mentions.js";
import { askedByBotPrompt, briefAnswerer, mentionedNext, pastTalkLimit } from "./botTalk.js";
import { UNCALLED } from "./joiningIn.js";
import { CHECKS, CLAIM_CHECKS, CUT_CHECK, claimsFiles, FILES_CHECK, ONLY_WHAT_WAS_ASKED, turnAbout, withoutRepeat } from "./replyChecks.js";

/** What a stopping server says once it has handed its person's replies over, and every server's resumer listens to. */
export const REPLIES_HANDED_OVER = "replies";

// Cards a person answers: only the one the bot worked for may (R4), and right after one is answered its bot speaks.
export const CARD_KINDS = new Set(["choice", "handover", "draft", "secure_form", "connect"]);
// A card's status once its person answered it.
const SETTLED = new Set(["done", "skipped", "submitted", "closed", "connected", "sent", "send", "discarded"]);

/** A bot's name as a word in a person's message (R3), in any case. */
const namedAsWord = (text, name) => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(name)}(?![\\p{L}\\p{N}_])`, "iu").test(text);

/**
 * The bots a person's message is for (R3). With one person in the chat: every bot, in order, or only those
 * @-mentioned. With several: a bot named as a word, @-mentioned, replied to, or everyone (<@everyone>); with the chat's
 * bots joining in (`joinIn`, D-115, D-129), every other live bot too, in order, marked `mayPass`: it decides whether to
 * reply. Archived bots never speak. `bots` are records.chats.bots rows.
 * @param {{ body?: { text?: string, replyTo?: { botId?: string } } } | null} message
 * @param {{ people: object[], bots: object[], joinIn?: boolean }} present
 */
export function addressedBots(message, { people, bots, joinIn = false }) {
  const live = bots.filter((bot) => !bot.archived_at);
  const text = String(message?.body?.text || "");
  if (text.includes("<@everyone>")) return live;
  const mentioned = new Set(mentionsIn(text));
  if (people.length <= 1) {
    const named = live.filter((bot) => mentioned.has(String(bot.bot_id)));
    return named.length ? named : live;
  }
  const words = text.replace(/<@[^>]+>/gu, " ");
  const repliedTo = message?.body?.replyTo?.botId ? String(message.body.replyTo.botId) : null;
  const called = live.filter((bot) =>
    mentioned.has(String(bot.bot_id)) || String(bot.bot_id) === repliedTo || namedAsWord(words, bot.name));
  return joinIn ? live.map((bot) => (called.includes(bot) ? bot : { ...bot, mayPass: true })) : called;
}

/** Messages read from storage as every route gives them to the page (toMessage): who said each, and never a reply's
 * transcript or what started it. */
const pageShaped = (rows) => rows.map(toMessage);

/**
 * The bots' replies in chats (D-48, R3): to a person's message, after a card they answered, a scheduled routine and a
 * task from Apps, each one bot's own run in its chat (keyed by its chat_bots id), with its steps saved, checked against
 * what its tools did, and carried on after a server stops. Every turn reads and writes through the model's reader for
 * its seat and the person it works for (D12, R4).
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {import("./types.js").BotHistory} dependencies.chatHistory
 * @param {import("./types.js").BackgroundWork} dependencies.background
 * @param {import("./types.js").BotRequests} dependencies.requests
 * @param {import("./types.js").Goals} dependencies.goals
 * @param {import("./types.js").BotTurns} dependencies.turns
 * @param {typeof import("./botAgent.js").generateReply} dependencies.reply
 * @param {((text: string, record: string) => Promise<string[]>) | null} dependencies.checkClaims the final-reply check, or null
 * @param {() => { afterTurn: (chatBotId: string) => Promise<unknown> }} dependencies.followUps the connect follow-ups, once made
 * @param {ReturnType<typeof import("./joiningIn.js").createJoiningIn>} dependencies.joiningIn whether a bot the message
 *   doesn't call replies to it (D-115, D-129)
 * @param {import("@local/notices/server/types").Notices} dependencies.notices how a stopping server's handed-over
 *   replies are told to the other servers, and heard
 */
export function createBotReplies({
  records,
  systemContext,
  meter,
  computer,
  seats,
  chatHistory,
  background,
  requests,
  goals,
  turns,
  reply,
  checkClaims,
  followUps,
  joiningIn,
  notices
}) {
  const { say, tell, working } = seats;
  // The person's replies running here (runReply), each with how its server's stop hands it over (handOverReplies).
  /** @type {Map<Promise<unknown>, import("./types.js").RunningRun>} */
  const replying = new Map();
  // This server's reply resumers (startResumer), stopped first when it hands its replies over.
  const resumers = new Set();
  // Set once this server is stopping: it takes up no more replies, and one that starts now is handed over at once.
  let handingOver = false;

  /**
   * A paused home (D-73, R3): one line in the chat, from Mercbot, and nothing runs. Background work no one is waiting on
   * posts it once, not again until someone says something in the chat: Mercbot's own lines meanwhile (a task's title)
   * don't count, and only its last few lines after the chat's latest words are read.
   */
  async function pausedLine(seat, text, { human = false, call }) {
    if (!human) {
      const words = await records.turns.latestMessage(seat.chat_id, { notKind: "event" }, call);
      const since = { kind: "event", role: "system", ...newerThan(words?.id) };
      const lines = await records.turns.messages(seat.chat_id, since, { newestFirst: true, limit: PAUSED_LINES_READ }, call);
      if (lines.some((line) => line.body?.paused)) return [];
    }
    const line = await say(seat, [{ kind: "event", role: "system", body: { text, paused: true } }], call);
    await tell(seat.chat_id, { type: "messages" }, call);
    return line;
  }

  /**
   * In a paused home the bot says why instead of replying: when it's paused before the turn starts, and when the turn's
   * work is refused part-way (meter.js refuseWork), the same way. A routine's or a task's run ends there unfailed, and a
   * goal's rounds stop, as after any error; the person asks to carry on once it's resumed.
   */
  async function pausedTurn(seat, text, { human = false, goalTurn = false, checkpoint = null, call }) {
    if (checkpoint) await records.chats.withTransaction(call, (txOptions) => checkpoint.settle(txOptions, { failed: false }));
    const line = await pausedLine(seat, text, { human, call });
    if (goalTurn) throw new Error(text);
    return line;
  }

  async function respond(seat, options) {
    const paused = await meter.pausedMessage(seat.workspace_id);
    if (paused) return pausedTurn(seat, paused, options);
    try {
      return await replyTurn(seat, options);
    } catch (error) {
      const refusal = refusalOf(error);
      if (!refusal) throw error;
      return pausedTurn(seat, refusal.notice, options);
    }
  }

  /**
   * One bot's turn in one chat. `present` is who is in the chat, read once for the turns it decides; `followUp` a turn
   * of R3's follow-up round (another bot mentioned it: it may PASS); `briefOnly` a request's turn (O22), which reads no
   * chat history, only its brief (the prompt) and its own steps on the request (`steps`, kept by `save`); `join` seats
   * a request's bot in the asking chat when it first uses its computer. `discussion` is a turn of a discussion
   * (discussions.js, D-115): it only talks, with no tools and none of the checks that send a reply back, answers no
   * person's message, and may PASS; its message names the discussion and its round, and `signal` stops it. A request's
   * turn's `signal` is its server's stop (botRequests.js), which ends it at its next step.
   */
  async function replyTurn(
    seat,
    {
      timeZone,
      language = "",
      prompt = "",
      routineRun = false,
      routine = null,
      recentOnly = false,
      appsVia = null,
      requestTurn = null,
      briefOnly = null,
      join = null,
      human = false,
      goalTurn = false,
      followUp = false,
      answersBot = null,
      present = null,
      checkpoint = null,
      discussion = null,
      replyRun = null,
      signal = null,
      call
    }
  ) {
    const posted = [];
    const chatBots = present?.bots ?? await records.chats.bots(seat.chat_id, call);
    const members = chatBots.map((bot) => ({ id: String(bot.bot_id), name: bot.name }));
    const turn = requestTurn || { ...(seat.chat_bot_id ? await requests.openFor(seat, call) : {}), viaBot: false };
    // What a person writes while this reply works reaches it with its next tool result (D-48), when it's for this bot
    // (R3); heard.upTo is the newest message it has seen, so that one isn't answered again afterwards.
    const heard = { upTo: Infinity };
    const inbox =
      (human || goalTurn) && !routineRun && !requestTurn
        ? async () => {
          if (!Number.isFinite(heard.upTo)) return [];
          const fresh = await records.turns.messages(seat.chat_id, { role: "user", kind: "text", ...newerThan(heard.upTo) }, {}, call);
          if (!fresh.length) return [];
          heard.upTo = Number(fresh.at(-1).id);
          const people = present?.people ?? await records.chats.people(seat.chat_id, call);
          return fresh
            .filter((message) => addressedBots(message, { people, bots: chatBots }).some((bot) => String(bot.bot_id) === seat.id))
            .map((message) => peopleNamed(message.body.text, message.body.mentionedPeople).slice(0, 2000));
        }
        : null;
    // A person's chat remembers the bot's other chats; a routine's or a request's run reads less (R5, D-113), and a
    // discussion's turn reads none of it, so the card's cap covers what it reads (D-115). Only the person's own turn
    // may ask to tell everyone in the home.
    const remembers = !routineRun && !briefOnly && !discussion;
    const { run, isBuilder, builder, toolSwitches, template, knowledge: known } = await turns.turnTools(seat, {
      timeZone,
      language,
      turn,
      remembers,
      tells: remembers && !turn.viaBot && !appsVia,
      routineRun,
      routine,
      appsVia,
      inbox,
      join,
      // Goals for a bot in a chat (not a bot's request); only the person's own turn can open one, and a goal round can
      // work on it.
      goalOperations: seat.chat_bot_id && !routineRun && !turn.viaBot && (human || goalTurn)
        ? goals.operationsFor(seat, { human, timeZone, language })
        : null,
      // A line the person should see before the reply is done, such as "I'll draw it now".
      post: async (messages) => {
        posted.push(...messages.map((message) => message.body.text));
        await say(seat, messages, call);
        await tell(seat.chat_id, { type: "messages" }, call);
      }
    }, call);
    const bot = { ...seat, isBuilder, template, additions: seat.additions || "", knowledge: known };
    const { summary, history } = briefOnly
      ? { summary: "", history: [] }
      : routine
        ? await chatHistory.routineHistory(seat, routine.id, call)
        : recentOnly ? await chatHistory.recentHistory(seat, call) : await chatHistory.chatHistory(seat, call);
    // Straight after an approval decision the bot only reports back; it doesn't act again. A discussion's turn only
    // talks too (D-115).
    const lastTurn = [...history].reverse().find((message) => message.kind !== "event");
    const decided =
      Boolean(discussion) ||
      (!prompt &&
        String(lastTurn?.authorBotId) === seat.id &&
        ((lastTurn?.kind === "choice" && lastTurn.body.purpose === "approval" && lastTurn.body.chosen) ||
          (lastTurn?.kind === "handover" && lastTurn.body.status === "skipped")));
    let replyText;
    let transcript;
    /**
     * A person's reply or a goal round saves its steps as each one finishes (D-48, as Claude Code
     * keeps its transcript). If this bot's reply in this chat was left part-way by a server that
     * stopped, and nothing newer was asked since, it carries on from its last saved step.
     */
    const checkpointed = Boolean(seat.chat_bot_id) && (human || goalTurn) && !routineRun && !requestTurn;
    const asked = Number([...history].reverse().find((message) => message.role === "user")?.id) || 0;
    heard.upTo = asked;
    const saved = checkpointed ? await chatHistory.runs.saved(seat.chat_bot_id) : null;
    // A routine's, an Apps task's or a request's run keeps its steps on its own row instead (D-59, O22): one its server
    // left part-way carries on from them on the server that took it over.
    const resumed = checkpoint
      ? checkpoint.steps
      : briefOnly
        ? briefOnly.steps || []
        : saved?.steps?.length && saved.input?.answers === asked && (saved.input?.prompt || "") === prompt ? saved.steps : [];
    // What carries a person's reply on if its server stops (D-48), kept on its run from before its first step: a reply
    // whose server stopped before any step finished is started over by another server, not lost. One that keeps its
    // steps on a row of its own (a connect follow-up's) is carried on from there, so nothing of it goes on the run.
    const onRun = checkpointed && !checkpoint && !briefOnly?.save;
    const runInput = { prompt, human, goalTurn, timeZone, language, answers: asked, followUp };
    // A person's reply keeps them through its hold on its run (runReply), which refuses once another server holds it; a
    // goal round's go on its run as before.
    const keepOnRun = (steps) => (replyRun ? replyRun.save(steps, runInput) : chatHistory.runs.save(seat.chat_bot_id, steps, runInput));
    if (onRun) {
      await keepOnRun(resumed).catch((error) => {
        if (error instanceof RunTakenOver) throw error;
        console.warn("Keeping a reply's start on its run failed; it's kept with its first step instead.", error);
      });
    }
    const onSteps = checkpoint
      ? (steps) => checkpoint.save([...resumed, ...steps])
      : briefOnly?.save
        ? (steps) => briefOnly.save([...resumed, ...steps])
        : onRun
          ? (steps) => keepOnRun([...resumed, ...steps])
          : keepNoSteps;
    // What stops the reply at its next step: its own run taken over (runReply), a follow-up's or a routine's lease, a
    // request's server stopping, a discussion's stop.
    const stopping = replyRun?.signal ?? checkpoint?.signal ?? signal ?? undefined;
    /**
     * Background work (a routine, a watch run, a task) that fails before doing anything ends with
     * its error, which its runner posts and counts; one that fails part-way still ends with its
     * account of what it did, and counts as failed all the same.
     */
    let failed = false;
    /**
     * Where a routine's run read each events feed up to (D-94) is kept only when the run went well, by the server still
     * holding it, before the run ends: a failed run, or one another server took over, reads the same events again.
     */
    const keepFeeds = async (options) => {
      const feeds = routine?.runId && !failed ? run.feeds() : null;
      if (feeds) await records.work.changeRoutineRun(routine, { feeds: { ...(routine.feeds || {}), ...feeds } }, options);
    };
    const throwIf = routineRun
      ? (_error, steps) => {
          failed = true;
          return !steps.length;
        }
      : undefined;
    try {
      const turnedOff = toolSwitches?.turnedOff || [];
      const state = await turns.currentState(seat, history, { timeZone, language, turnedOff, known, present, remembers, builder }, call);
      const seen = await turns.withPictures(seat, history);
      const sofar = { kind: "text", role: "bot", authorBotId: seat.id, body: { text: "", transcript: resumed, ...(prompt ? { trigger: prompt } : {}) } };
      let unfinished = "";
      // The engine's own account of a pass that stopped early (out of steps or time, or failed after
      // some work) already says where it got to; each check's pass below brings its own.
      let account = "";
      let [passed, cut] = [false, false];
      ({
        text: replyText,
        transcript,
        unfinished = "",
        account = "",
        passed = false,
        cut = false
      } = await reply(
        bot,
        resumed.length ? [...seen, sofar] : seen,
        decided ? {} : run.tools,
        state,
        resumed.length ? CHECKS.resumed : prompt,
        {
          summary,
          onSteps,
          followUp: followUp || Boolean(discussion?.mayPass),
          carriesOn: checkpointed,
          throwIf,
          signal: stopping ?? discussion?.signal,
          ...discussion?.model
        }
      ));
      // A follow-up with nothing to add stays quiet (R3): nothing is posted, and nothing it made is shown.
      if (passed) return [];
      // Out of steps or time with the job not done: it carries on by itself in goal rounds
      // (D-48), never waiting for the person to say "carry on". A goal round's own goal goes on.
      if (unfinished && checkpointed && !(await goals.openGoal(seat.chat_bot_id))) {
        const request =
          [...history].reverse().find((message) => message.role === "user" && message.kind === "text")?.body.text || "the person's request";
        await goals.openFor(seat, request, { timeZone, language });
      }
      transcript = [...resumed, ...transcript];
      /**
       * A check sends the reply back once, carrying on from where it got to (D-48): the second pass
       * sees the first one's steps, so it neither redoes them nor says they didn't happen, and
       * the stored transcript keeps both.
       */
      const again = async (check) => {
        const steps = withoutClosingWords(transcript);
        const sofar = { kind: "text", role: "bot", authorBotId: seat.id, body: { text: replyText, transcript: steps, ...(prompt ? { trigger: prompt } : {}) } };
        const next = await reply(bot, [...seen, sofar], run.tools, state, `${check}\n\n${ONLY_WHAT_WAS_ASKED}`, { summary, signal: stopping });
        return { ...next, transcript: [...steps, ...next.transcript] };
      };
      // Cut off by the provider: written again, whole, once. Then each claim its tools don't back sends it back once.
      if (!decided && cut) ({ text: replyText, transcript, account = "" } = await again(CUT_CHECK));
      if (!decided) {
        const about = turnAbout(history.slice(-8), seat.id);
        for (const claimCheck of CLAIM_CHECKS) {
          const check = claimCheck(run, replyText, about);
          if (check) ({ text: replyText, transcript, account = "" } = await again(check));
        }
      }
      let carriedOn = false;
      const carryOn = async (check) => {
        carriedOn = true;
        ({ text: replyText, transcript } = await again(check));
      };
      // Raw model markup in the reply (a tool call written out as text, DeepSeek's own tokens)
      // means a malformed step: it carries on once, told that nothing in the markup ran (D-48).
      if (!decided && Object.keys(run.tools).length && LEAKED_MARKUP.test(replyText)) {
        await carryOn(CHECKS.markup);
      } else if (
        // A reply that stopped at "let me…" carries on once (D-47), for any bot with tools (D-48).
        // With a goal active, its next round carries on instead. The engine's own account of a reply
        // that stopped early is never sent back, nor one whose card (an approval) waits for the person.
        !decided &&
        Object.keys(run.tools).length &&
        !account && !run.showsCard() &&
        stoppedShort(replyText.trim()) &&
        (!seat.chat_bot_id || (await goals.openGoal(seat.chat_bot_id))?.status !== "active")
      ) {
        await carryOn(CHECKS.stoppedShort);
      }
      // A reply that says files are attached when no card will show sends them, or says plainly
      // what it couldn't find (D-48).
      if (!decided && run.tools.sendFiles && claimsFiles(replyText, run.showsCard()) && !(await run.fileCards()).length) {
        await carryOn(FILES_CHECK);
      }
      // The final-reply check (D-48): a reply that says it did something is compared with what its
      // tools did; a claim they don't support sends it back once to do it or say otherwise.
      if (!decided && !carriedOn && checkClaims && Object.keys(run.tools).length && reportsActions(replyText)) {
        const events = run.before.filter((message) => message.kind === "event").map((message) => message.body.detail || message.body.text);
        const unsupported = await checkClaims(replyText, toolRecord(transcript, events, "Mercbot"));
        if (unsupported.length) await carryOn(CHECKS.unsupported(unsupported));
      }
      // People never see raw markup or Mercbot's internal paths, whatever the second pass wrote.
      replyText = withoutPaths(withoutMarkup(replyText));
      // A line already posted (I'll draw it now) isn't said again at the top of the reply.
      replyText = withoutRepeat(replyText, posted);
      // A run with nothing new posts nothing; it still moves on in the feeds it read.
      if (run.quiet()) {
        await keepFeeds(call);
        return [];
      }
      await run.finish();
    } finally {
      await run.close();
    }
    // The card and the waiting state are written together, so they can't disagree (D-14).
    const handover = run.after.find((message) => message.kind === "handover");
    // A password kept in the home's vault never shows in the chat, whatever the bot read.
    replyText = await turns.withoutSecrets(replyText, call);
    const answers = Math.max(asked, Number.isFinite(heard.upTo) ? heard.upTo : 0);
    // "@Name" for a bot of the chat is written as its mention (R3's follow-up round reads them).
    const body = withMentions({
      text: mentionMarkers(replyText, members),
      transcript,
      // A discussion's turn answers no person's message: one written meanwhile is still taken up after it (D-115).
      answers: discussion ? 0 : answers,
      ...(prompt ? { trigger: prompt } : {}),
      ...(answersBot ? { answersBot: String(answersBot) } : {}),
      ...(routine ? { routine: String(routine.id) } : {}),
      ...(discussion ? { discussion: String(discussion.id), round: discussion.round } : {})
    }, members);
    // Cards are for the person the bot works for (R4): only they answer them.
    const asker = { id: seat.user_id, name: (await records.chats.names([seat.user_id], call)).get(seat.user_id) || "the person" };
    const forAsker = (message) => (CARD_KINDS.has(message.kind) ? { ...message, body: { ...message.body, for: asker } } : message);
    const appended = await records.chats.withTransaction(call, async (txOptions) => {
      await keepFeeds(txOptions);
      // A routine's or a task's run ends with its result, so only the server holding it posts it; a person's reply's run
      // gives up what would carry it on, as its reply is posted.
      const ending = checkpoint ? await checkpoint.settle(txOptions, { failed }) : [];
      // A person's reply posts only while it still holds its run: one another server took over posts nothing.
      if (replyRun) {
        if (!(await replyRun.settle(txOptions))) throw new RunTakenOver(`Bot ${seat.id}'s reply in chat ${seat.chat_id}`);
      } else if (checkpointed) await chatHistory.runs.settle(seat.chat_bot_id, txOptions);
      const messages = await say(seat, [
        ...run.before,
        ...(replyText ? [{ kind: "text", role: "bot", body }] : []),
        ...run.after.map(forAsker),
        ...ending
      ], txOptions);
      if (handover && seat.chat_bot_id) {
        await records.chats.updateChatBot(seat.chat_bot_id, { waiting_task: handover.body.task }, txOptions);
      }
      return messages;
    });
    if (handover && seat.chat_bot_id) {
      computer
        .hold(String(seat.chat_bot_id), true)
        .catch((error) => console.warn("Holding the bot's computer awake for a hand-over failed.", error));
    }
    chatHistory.compactLater(seat.chat_id);
    // What it said in a public chat is for its memory, and its chat's other bots' (D-113). A discussion's turn asks for
    // no refresh: the next one another message asks for reads what it said (D-115).
    if (!discussion) turns.remembered(seat);
    return appended;
  }

  /**
   * The chat's bots answer (R3): those the latest message is for, each its own run in order, then one follow-up round
   * for the bots another bot mentioned (PASS stays quiet). A people-only chat makes no model call. A page that lost its
   * server mid-reply asks again (D-19): bots that already answered aren't asked twice (after a card, since the card and
   * the page's last message), and with none left to answer, what was said since the page's last message is the answer.
   * A bot still busy with an earlier reply in the chat answers once it's free (runReply's answerWaiting), so a request
   * that only found bots busy is told it's pending. With several people and the chat's "Bots join in when useful" on,
   * every live bot reads the message, and one it doesn't call first decides whether to reply (joiningIn.js, D-129), in
   * the background work the request starts. The page sets only these four: a turn's prompt is the server's own.
   * @param {string} chatId
   * @param {{ timeZone?: string, language?: string, afterMessageId?: string | number, afterCard?: boolean }} input
   * @param {import("./types.js").CallOptions} options the person's request
   * @returns {Promise<{ messages: object[] } | { pending: true }>}
   */
  async function replyIn(chatId, { timeZone, language, afterMessageId, afterCard = false }, options) {
    const chat = await records.chats.get(String(chatId), options);
    const present = await presentIn(records, chat.id, chat.bots_join_in, options);
    const after = Number(afterMessageId) || 0;
    const since = async () => ({ messages: after > 0 ? pageShaped(await records.messages.messagesAfter(chat.id, after, options)) : [] });
    if (!present.bots.some((bot) => !bot.archived_at)) return since();
    const { bots, asked, askerId, cardId } = await whoSpeaks(records.turns, chat.id, { afterCard }, present, options);
    if (!bots.length || !askerId) return since();
    const busy = new Set();
    const job = (async () => {
      const since = cardId ? Math.max(cardId, after) : asked - 1;
      const done = await answeredBy(records.turns, chat.id, asked, bots.map((bot) => bot.bot_id), options, since);
      const speaking = bots.filter((bot) => !done.has(String(bot.bot_id)));
      if (!speaking.length) return null;
      return speakInTurn(chat, speaking, { timeZone, language, afterCard: Boolean(cardId), asked }, askerId, present, { busy });
    })();
    background.add(job);
    const settled = await settledWithin(job, REPLY_WAIT_MS);
    if (settled === null) return since();
    return settled && (settled.length || !busy.size) ? { messages: settled } : { pending: true };
  }

  /** The bots' system context in a chat's home, to find a seat before its reader exists. */
  const inHome = (chat) => ({ context: systemContext("a bot's seat in a chat is read to start its turn").forWorkspace(String(chat.workspace_id)) });

  /**
   * The bots speak one after another, then the bots they mentioned answer them in the chat, round after round (R3),
   * until none is mentioned or the bot-to-bot limit stops them. A paused home's line stops them all (D-73). Answers what
   * they posted; a bot whose run in the chat was still going is added to `busy`. A message that arrived while the bot
   * was busy is named, as answerWaiting names it. An entry with `botAsked` answers that bot (its mention, or a brief).
   */
  async function speakInTurn(chat, speaking, input, askerId, present, { followUp = false, busy = new Set() } = {}) {
    const posted = [];
    for (const entry of speaking) {
      const seat = await seats.seatIn(chat.id, entry.bot_id, askerId, inHome(chat));
      if (!seat?.chat_bot_id) continue;
      const call = seats.readerOf(seat);
      if (entry.botAsked && await pastTalkLimit({ turns: records.turns, seats }, seat, entry.botAsked, present.bots, posted)) continue;
      if (!(await chatHistory.claimReply(seat))) {
        busy.add(String(entry.bot_id));
        continue;
      }
      const waiting = input.afterCard || followUp ? "" : await arrivedWhileBusy(records.turns, seat, input.asked, call);
      const asked = { followUp, botAsked: entry.botAsked ?? null, brief: Boolean(entry.brief), mayPass: Boolean(entry.mayPass) };
      const out = await meter.track(meteredAs(seat), () =>
        runReply(seat, { ...input, ...asked, ...(waiting ? { waiting } : {}) }, call, null, present));
      posted.push(...out.messages);
      if (out.paused) return posted;
    }
    // The bots just mentioned by another bot answer it here, each once a round (PASS stays quiet).
    const next = mentionedNext(posted, present.bots);
    if (next.length) posted.push(...await speakInTurn(chat, next, { ...input, afterCard: false }, askerId, present, { followUp: true }));
    return posted;
  }

  const answerBrief = briefAnswerer({ records, background, speak: speakInTurn });

  /**
   * Replies a stopped server left part-way (D-48, D-19): any server finds them by their stale heartbeat, takes one over
   * through the database and carries it on from its saved steps, with no page needed, for the person it worked for.
   * Only a person's own replies; goal rounds carry on through their own lease.
   */
  const resumable = (query) => query.whereRaw("(input->>'human')::boolean");

  async function resumeRun(run) {
    const place = await records.directory.computerOf(String(run.conversation_id), { context: systemContext("reply resumer") });
    const found = place && await seats.backgroundSeat({ chatBotId: place.chatBotId, homeId: place.workspaceId, userId: run.user_id }, "reply resumer");
    if (!found) return chatHistory.runs.release(run.conversation_id);
    const { seat, call } = found;
    background.add(meter.track(meteredAs(seat), () => runReply(seat, { resume: run.input }, call)));
  }

  async function resumeStalled() {
    await Promise.all((await chatHistory.runs.takeOverStalled({ resumable })).map(resumeRun));
  }

  /**
   * Carries on the replies stopped servers left: at each scan (agent-runtime's resumer), and at once when a stopping
   * server says it handed its replies over (handOverReplies).
   * @param {{ everyMs?: number }} [options]
   */
  function startResumer(options) {
    const scans = startRunResumer({ runs: chatHistory.runs, resume: resumeRun, resumable, ...options });
    const unsubscribe = notices.subscribe(REPLIES_HANDED_OVER, "all", () => {
      if (!handingOver) resumeStalled().catch((error) => console.error(`Resuming replies handed over: ${error?.message || error}`));
    });
    const resumer = {
      /** @param {number} ms */
      async drain(ms) {
        unsubscribe();
        resumers.delete(resumer);
        await scans.drain(ms);
      }
    };
    resumers.add(resumer);
    return resumer;
  }

  /**
   * This server is stopping (D-19): it takes up no more replies, and each person's reply still running stops at once,
   * mid model call too, with its steps kept, and its run is handed over (stale now, hold's handOver), then every server
   * is told, so another carries it on straight away from those steps and posts it. One that doesn't stop in time (in a
   * tool's call that doesn't end) keeps its run, which another server takes over once it's stale. Answers how many
   * were handed over.
   * @returns {Promise<number>}
   */
  async function handOverReplies() {
    handingOver = true;
    await Promise.all([...resumers].map((resumer) => resumer.drain(HAND_OVER_MS)));
    let handed = 0;
    // A reply that started meanwhile is handed over in the next round; one that didn't stop in time ends the rounds.
    while (replying.size) {
      const left = replying.size;
      handed += await handOverRuns(replying);
      if (replying.size >= left) break;
    }
    await tellHandedOver(notices, REPLIES_HANDED_OVER, handed);
    return handed;
  }

  /**
   * One person's reply (replyOnRun), kept among those this server runs while it runs, so a stop hands it over. A connect
   * follow-up's (`held`) is handed over by its own runner instead (connectFollowUps.js), with the chat's run it holds.
   * @param {object} seat
   * @param {object} input
   * @param {object} call
   * @param {import("./types.js").RunCheckpoint | null} [held]
   * @param {object | null} [present]
   */
  function runReply(seat, input, call, held = null, present = null) {
    if (held) return replyOnRun(seat, input, call, held, present);
    const handing = {
      lease: { handOver: () => ((handing.stopped = true), handing.keep?.handOver()) },
      release: () => handing.own?.handOver() ?? Promise.resolve(false)
    };
    const run = replyOnRun(seat, input, call, held, present, handing).finally(() => replying.delete(run));
    replying.set(run, handing);
    return run;
  }

  /**
   * One bot's reply in its chat, its run already claimed (claimReply). Tells the chat it's working, posts what it said
   * or a sorry, frees the run, then takes up a message for it that arrived meanwhile and lets a goal or a follow-up
   * carry on. Answers what it posted and whether the home was paused.
   * @param {import("./types.js").RunCheckpoint | null} [held] a connect follow-up's run (connectFollowUps.js), which
   *   ends with the reply's result, so only the server holding it posts it
   * @param {object | null} [present]
   * @param {{ stopped?: boolean, keep?: object, own?: object }} [handing] how its server's stop reaches it (runReply)
   */
  async function replyOnRun(seat, input, call, held = null, present = null, handing = {}) {
    // The reply's run is kept as a routine's lease is (keepLease, D-59): once this server can't be sure it still holds
    // it (another server took it over after this one stalled past the staleness, or no heartbeat went through for most
    // of it), the reply stops at its next step, and what it would keep, post or free is refused, so it posts and frees
    // nothing and only the server holding the run answers.
    const what = `Bot ${seat.id}'s reply in chat ${seat.chat_id}`;
    const own = await chatHistory.runs.hold(seat.chat_bot_id);
    const lease = keepLease(own.beat, what, {
      seconds: Number(chatHistory.runs.limits.staleSeconds),
      heartbeatMs: Number(chatHistory.runs.limits.heartbeatMs)
    });
    Object.assign(handing, { keep: lease, own });
    if (handing.stopped || handingOver) lease.handOver();
    const refused = new AbortController();
    const replyRun = {
      signal: AbortSignal.any([lease.signal, refused.signal, ...(held?.signal ? [held.signal] : [])]),
      save: async (steps, runInput) => {
        if (await own.save(steps, runInput)) return;
        refused.abort(new RunTakenOver(what));
        throw refused.signal.reason;
      },
      settle: own.settle
    };
    let answered = Number(input.asked) || 0;
    // Whether this server still holds the follow-up it runs: one another server took over is that server's to end.
    let mine = true;
    let paused = false;
    try {
      // A bot the message doesn't call decides first (D-129): a pass ends here, unseen, and the bot is free as after a reply.
      if (input.mayPass && !(await joiningIn.replies(seat, input.asked, present.bots))) return { messages: [], paused };
      const timeZone = validTimeZone(input.timeZone) ? input.timeZone : "UTC";
      let appended;
      try {
        await working(seat, true, null, call);
        if (held?.givenUp) throw new Error(`its server stopped ${RUN_LEASE.attempts} times while it ran`);
        // A message that arrived while the bot was busy is named, so the reply answers it, not the one before it.
        const prompt = input.resume
          ? input.resume.prompt || ""
          : input.connected
            ? connectedPrompt(input.connected)
            : input.waiting
              ? `(The message "${input.waiting}" arrived while you were busy with the one ` +
                `before, so it hasn't been answered yet. ${input.mayPass ? UNCALLED : "Answer it now."})`
              : input.mayPass
                ? `(${UNCALLED})`
                : askedByBotPrompt(input);
        // A reply carried on after its server stopped keeps the settings it started with (D-48).
        appended = input.resume
          ? await respond(seat, {
            timeZone: input.resume.timeZone || timeZone,
            language: input.resume.language || "",
            prompt,
            human: true,
            followUp: Boolean(input.resume.followUp),
            replyRun,
            call
          })
          : await respond(seat, {
            timeZone,
            language: languageName(input.language),
            prompt,
            human: true,
            followUp: Boolean(input.followUp || input.mayPass),
            answersBot: input.botAsked?.id ?? null,
            present,
            checkpoint: held,
            replyRun,
            call
          });
        paused = appended.some((message) => message.kind === "event" && message.body?.paused);
        // A follow-up that posted ended with its post; one with nothing new ends here.
        if (held && !appended.length) mine = Boolean(await held.end({ failed: false }, call));
      } catch (error) {
        if (error instanceof RunTakenOver) {
          // Stopped for its lease (keepLease said why), or another server holds it: nothing is posted here.
          if (!held?.signal?.aborted && !lease.signal.aborted) console.warn(error.message);
          mine = false;
          appended = [];
        } else {
          console.error(`Bot ${seat.id}'s reply failed: ${isModelFailure(error) ? modelFailure(error) : error?.message || error}`);
          const sorry = {
            kind: "text",
            role: "bot",
            body: {
              text: "Sorry, something went wrong on my side and I couldn't finish that. Ask me again and I'll pick it up from where things are.",
              answers: Number(input.asked) || 0
            }
          };
          appended = await records.chats.withTransaction(call, async (txOptions) => {
            if (held) mine = Boolean(await held.end({ failed: true }, txOptions));
            // Its run gives up its steps as the sorry is posted, as a reply's does, while the reply still holds it.
            else mine = await own.settle(txOptions);
            return mine ? say(seat, [sorry], txOptions) : [];
          });
        }
      }
      if (!mine) return { messages: [], paused };
      if (appended.length) await tell(seat.chat_id, { type: "messages" }, call);
      await working(seat, false, null, call);
      answered = Math.max(answered, ...appended.map((message) => Number(message.body?.answers) || 0));
      return { messages: appended, paused };
    } finally {
      lease.stop();
      // A follow-up taken over leaves the chat's reply to the server that took it over, and a run another server took
      // over is that server's to free.
      if (mine) {
        await own
          .release()
          .catch((error) => console.warn("Releasing a bot's run in a chat failed; its lease runs out instead.", error));
      }
      // A stopping server starts nothing more here: what's left is the server's that carries the reply on.
      if (!paused && !handingOver) {
        // A message for this bot that arrived while this reply ran gets its own reply now, whether or not a page is still
        // waiting for it.
        background.add(answerWaiting(seat, input, answered, call));
        // Once the bot is free in this chat, an open goal carries on in another round (D-48), and a connect follow-up
        // that waited for this reply starts.
        background.add(goals.afterTurn(seat.chat_bot_id));
        background.add(followUps().afterTurn(seat.chat_bot_id));
      }
    }
  }

  /** The latest person's message for this bot that it hasn't answered, answered now (R3: only messages for it count). */
  async function answerWaiting(seat, input, answered, call) {
    if (input.followUp) return;
    const latest = await records.turns.latestMessage(seat.chat_id, { role: "user", kind: "text", ...newerThan(answered) }, call);
    if (!latest) return;
    const present = await presentIn(records, seat.chat_id, seat.chat?.bots_join_in, call);
    const entry = addressedBots(latest, present).find((bot) => String(bot.bot_id) === seat.id);
    if (!entry) return;
    if ((await answeredBy(records.turns, seat.chat_id, Number(latest.id), [seat.id], call)).size) return;
    // A chat or bot archived meanwhile (D-101, D-108) leaves it unanswered: nothing runs where nobody may write.
    const fresh = await seats.seatIn(seat.chat_id, seat.id, String(latest.authorUserId), call);
    if (!fresh?.chat_bot_id || fresh.chat.archived_at || fresh.archived_at) return;
    if (!(await chatHistory.claimReply(fresh))) return;
    // The waiting message is what it answers, not the connected app it followed up (connectFollowUps.js) nor a card.
    const next = { ...input, connected: null, afterCard: false, waiting: waitingWords(latest), asked: Number(latest.id) };
    const reader = seats.readerOf(fresh);
    await meter.track(meteredAs(fresh), () => runReply(fresh, { ...next, mayPass: Boolean(entry.mayPass) }, reader, null, present));
  }

  /** A bot freed by a discussion (D-115) answers a message for it newer than `since`, as after a reply of its own. */
  const takeUpWaiting = (seat, since, input, call) => background.add(answerWaiting(seat, input, Number(since) || 0, call));

  return Object.freeze({
    respond,
    pausedLine,
    replyIn,
    answerBrief,
    runReply,
    takeUpWaiting,
    resumeStalled,
    startResumer,
    handOverReplies
  });
}

// A reply runs on the server as background work: the request waits up to 20 seconds for it, and a longer one
// finishes on its own and tells the page through the bot events. One reply per bot in a chat is claimed in
// agent_runs, so a retried request or another page doesn't start a second one; a reply whose server stopped beating
// for a minute is taken over by the next request (D-15, D-19). Every reply ends with a message.
const REPLY_WAIT_MS = 20000;

// How many of Mercbot's lines after the chat's latest words a paused home's check reads: a run posts one or two.
const PAUSED_LINES_READ = 10;

/** The messages after a message id; every one when there is none yet (0: nothing read or answered). */
/** Who is in a chat for R3 (addressedBots): its people, its bots, and whether its bots join in (D-115, D-129). */
const presentIn = async ({ chats }, chatId, joinIn, call) =>
  ({ people: await chats.people(chatId, call), bots: await chats.bots(chatId, call), joinIn });

const newerThan = (id) => (Number(id) > 0 ? { afterId: String(id) } : {});

/** A waiting message's words, as the prompt that names it quotes them, the people it mentions by name (D-114). */
const waitingWords = (message) => peopleNamed(message.body.text, message.body.mentionedPeople).slice(0, 1500);

/**
 * Who speaks now (R3), for the chat's latest person's message or, after a card was answered, for that card's bot: the
 * chat's latest card from a bot, whatever its bot said after it (such as "Tap what fits"). Answers the bots in order
 * (addressedBots: one marked `mayPass` decides first), the message they answer (its id, 0 for none), the person they
 * work for, and after a card, the card's id.
 */
async function whoSpeaks(turns, chatId, { afterCard = false }, present, call) {
  const latestText = await turns.latestMessage(chatId, { role: "user", kind: "text" }, call);
  if (afterCard) {
    const card = await turns.latestMessage(chatId, { role: "bot", kinds: [...CARD_KINDS] }, call);
    const settled = card && (card.body?.chosen || SETTLED.has(card.body?.status));
    const bot = settled ? present.bots.find((entry) => String(entry.bot_id) === String(card.authorBotId) && !entry.archived_at) : null;
    if (bot) {
      const askerId = String(card.body?.for?.id || latestText?.authorUserId || "");
      return { bots: [bot], asked: Number(latestText?.id) || 0, askerId, cardId: Number(card.id) };
    }
  }
  if (!latestText) return { bots: [], asked: 0, askerId: null, cardId: 0 };
  const asked = Number(latestText.id);
  return { bots: addressedBots(latestText, present), asked, askerId: String(latestText.authorUserId), cardId: 0 };
}

/**
 * The bots of `botIds` that already answered the person's message `asked` (body.answers, the newest person's message
 * a reply read): one that started before a message arrived mid-reply didn't, so that message still gets its reply.
 */
async function answeredBy(turns, chatId, asked, botIds, call, since = asked - 1) {
  if (!asked) return new Set();
  const found = await Promise.all(botIds.map(async (botId) =>
    (await turns.latestMessage(chatId, { role: "bot", kind: "text", authorBotId: String(botId), ...newerThan(since), answersFrom: asked }, call))
      ? String(botId)
      : null));
  return new Set(found.filter(Boolean));
}

/**
 * The words of the person's message `asked` when this bot posted a reply after it that didn't answer it (the reply
 * read the chat before it arrived; answeredBy left it to answer), for the prompt that names it; "" otherwise.
 */
async function arrivedWhileBusy(turns, seat, asked, call) {
  if (!asked) return "";
  const since = await turns.latestMessage(seat.chat_id, { role: "bot", kind: "text", authorBotId: seat.id, ...newerThan(asked) }, call);
  if (!since || Number(since.body.answers) >= asked) return "";
  const [message] = await turns.messages(seat.chat_id, { role: "user", kind: "text", ...newerThan(asked - 1) }, { limit: 1 }, call);
  return message ? waitingWords(message) : "";
}

/** Who pays for a seat's turn (R8): the person it works for, in its home. */
const meteredAs = (seat) => ({ userId: seat.user_id, botId: seat.id, workspaceId: seat.workspace_id });

/** What the bot is told when the app it was waiting for is connected. */
const connectedPrompt = ({ app, task }) =>
  `(${app} is connected now: the person signed in from your card. Finish what you said you'd do once it was: ${task}. ` +
  `Do it now with your ${app} tools, unless the chat above shows it's already done or no longer wanted, and tell the person briefly.)`;

/** A reply that isn't checkpointed keeps none of its steps along the way. */
async function keepNoSteps() {}
