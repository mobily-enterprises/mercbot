import { randomUUID } from "node:crypto";
import { REASONING } from "@jskit-ai/agent/server";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { WORK, aiKind } from "@local/account/model";
import { mayChangeBot } from "./botAdditions.js";
import { BotsError } from "./botsError.js";
import { discussionNow, toMessage } from "./botRows.js";
import { languageName } from "./botWriting.js";
import { plainMentions } from "./mentions.js";
import { validTimeZone } from "./routineSchedule.js";

// Discuss (D-115, plan 4.5): the bots of a chat with two or more of them talk a question over, in rounds, as the person
// who started it asks. A discussion is a card in the chat (a message of kind "discussion", written by that person),
// whose body the server alone keeps: the question, the bots taking part, the rounds chosen (1 to 3), how many have run,
// what it may cost and has cost, and how it ended.
// - Before it starts, the card shows what it may cost, from the meter's estimate (meter.estimateNano: Mercbot's list
//   prices, or a copy's own), for 1, 2 or 3 rounds and the wrap-up. Start fixes the rounds and, with them, the cap.
// - Each round is one turn per bot, in the chat's order: a reply that only talks (no tools, no checks that send it
//   back) and adds something new or says PASS. A round in which every bot passes ends the discussion.
// - Every round after the first, and the wrap-up (one bot sums it up), needs the person's press: no round runs by
//   itself. Only the person who started it presses Start, One more round and Wrap up; Stop is theirs and the chat
//   managers' (its maker, the home's owners and admins).
// - The cap is the server's: before each turn the discussion's spending so far plus that turn's estimate must stay
//   within it, or it stops there, mid-round if need be. Its spending is its own turns' AI calls only (meter.counting),
//   each priced as the meter counts it (meter.estimateNano on the call's figures), never the rest of the person's work
//   with those bots meanwhile.
// - A round holds every speaking bot's reply run in the chat (claimReply, kept alive by its heartbeat), so a message
//   written meanwhile finds the bots busy and is answered once the round lets go (answerWaiting). Stop ends the card at
//   once; the round sees it at its next heartbeat or turn, stops the turn in progress and lets go.
// - Each turn is metered to the person who started it and the bot that speaks (R8), as chat work.
// A round runs on the server that took the press. Its card is leased like the runs it holds: renewed at each heartbeat,
// and once the lease lapses (that server stopped) the card reads as interrupted (botRows.js discussionNow), by when
// those runs are stale too, so any server takes them over: its person may press One more round (unless it was wrapping
// up), Wrap up or Stop, and nothing is lost but the rest of that round.

export const DISCUSSION_LIMITS = Object.freeze({
  // The most rounds one discussion has, and what a new card offers first.
  rounds: 3,
  defaultRounds: 2,
  // The longest question.
  questionChars: 500,
  // How often a round renews its runs and its card's lease, and looks for a Stop: the runs' own heartbeat unless set.
  heartbeatMs: null,
  // How long a round's card holds without a renewal before it reads as interrupted: a heartbeat past the time its runs
  // go stale, unless set (tests), so a card read as interrupted has its runs free.
  leaseMs: null,
  // What one turn and the wrap-up may write: the reply's own output limit, so the estimate holds.
  turnOutputTokens: 1200,
  wrapOutputTokens: 2000,
  // A turn's input besides the chat itself, for the estimate: the bot's instructions, template, additions, Knowledge
  // and the state note, all at the uncached price (an upper bound: most of it is cached between turns).
  prefixTokens: 24000
});

/** The words a turn of round `round` is asked with. */
export function roundPrompt({ question, round, rounds, others, by }) {
  return `(A discussion ${by} started: "${question}". This is round ${round} of ${rounds}, with ${others}. ` +
    "Add something new that hasn't been said in this discussion yet: a point, a fact, a risk, a disagreement or a " +
    "question, in a few sentences. Don't repeat or sum up what the others said, and don't use tools. If you have " +
    "nothing new to add, reply with exactly PASS.)";
}

/** The words the wrap-up is asked with. */
export function wrapPrompt({ question }) {
  return `(Wrap up the discussion of "${question}": in a few short lines, say where the bots agreed, where they ` +
    "differed, and what is left to decide. Add no new points, and don't use tools.)";
}

/**
 * The tokens a discussion of `bots` bots may use, for each choice of rounds (1 to DISCUSSION_LIMITS.rounds): all its
 * turns and the wrap-up, its costliest turn (the last of its last round) and the wrap-up alone. Each turn reads
 * `baseTokens` (the chat and a bot's prefix) and everything said before it in the discussion, at most a turn's output
 * each, and writes at most a turn's output.
 * @param {{ bots: number, baseTokens: number, limits?: typeof DISCUSSION_LIMITS }} input
 */
export function discussionTokens({ bots, baseTokens, limits = DISCUSSION_LIMITS }) {
  const out = limits.turnOutputTokens;
  return Array.from({ length: limits.rounds }, (_, index) => {
    const turns = bots * (index + 1);
    const wrap = { input: baseTokens + turns * out, output: limits.wrapOutputTokens };
    const rounds = { input: turns * baseTokens + (out * turns * (turns - 1)) / 2, output: turns * out };
    return {
      rounds: index + 1,
      all: { input: rounds.input + wrap.input, output: rounds.output + wrap.output },
      turn: { input: baseTokens + (turns - 1) * out, output: out },
      wrap
    };
  });
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/account/server/types").Meter} dependencies.meter estimates, the turns' tickets and their calls
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env which provider the chat AI runs on
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {import("./types.js").BotHistory} dependencies.chatHistory the reply runs a round holds, and the chat's summary
 * @param {import("./types.js").BotReplies} dependencies.replies
 * @param {{ add: (work: Promise<unknown>) => void }} dependencies.background
 * @param {Partial<typeof DISCUSSION_LIMITS>} [dependencies.limits]
 */
export function createDiscussions({ records, systemContext, meter, env, seats, chatHistory, replies, background, limits = {} }) {
  const LIMITS = { ...DISCUSSION_LIMITS, ...limits };
  const { runs } = chatHistory;
  const heartbeatMs = LIMITS.heartbeatMs || runs.limits.heartbeatMs;
  const leaseMs = LIMITS.leaseMs || Number(runs.limits.staleSeconds) * 1000 + Number(runs.limits.heartbeatMs);
  const leaseFrom = () => new Date(Date.now() + leaseMs).toISOString();
  const inHome = (homeId) => ({ context: systemContext("a discussion's card is kept as it runs").forWorkspace(String(homeId)) });
  const refused = (status, message, code) => new BotsError(status, message, { code });
  const notFound = () => refused(404, "Discussion not found.", "bots_discussion_not_found");
  const live = (present, ids) => present.bots.filter((bot) => !bot.archived_at && (!ids || ids.has(String(bot.bot_id))));

  /** The caller, one of the chat's people. */
  async function person(chat, options) {
    const me = String(resolveActorId(options.context) ?? "");
    if (!me || !(await records.chats.isPerson(chat.id, me, options))) {
      throw refused(403, "Join this chat to start a discussion in it.", "bots_chat_join_first");
    }
    return me;
  }

  /** What tokens of the chat AI cost the home, per million in and out, at its prices now (two estimates). */
  async function pricesPerMillion(homeId) {
    const at = { workspaceId: String(homeId), kind: WORK.chat.kind, provider: aiKind(env, WORK.chat.kind)?.layer.id || "" };
    const [input, output] = await Promise.all([meter.estimateNano({ ...at, cacheMiss: 1e6 }), meter.estimateNano({ ...at, output: 1e6 })]);
    return (tokens) => Math.ceil((tokens.input * Number(input || 0) + tokens.output * Number(output || 0)) / 1e6);
  }

  /** What a discussion in this chat may cost, for 1 to 3 rounds: two reads of the chat (its summary and what's after). */
  async function estimate(chat, bots, options) {
    const { summary = "", after = 0 } = (await chatHistory.compaction.current(String(chat.id))) || {};
    const rows = await records.messages.messagesAfter(String(chat.id), after, options);
    const tokensOf = (text) => Math.ceil(String(text).length / 4);
    const chatTokens = tokensOf(summary) + rows.reduce((sum, row) => sum + tokensOf(JSON.stringify(row.body ?? {})), 0);
    const cost = await pricesPerMillion(chat.workspace_id);
    return discussionTokens({ bots: bots.length, baseTokens: LIMITS.prefixTokens + chatTokens, limits: LIMITS }).map((choice) => ({
      rounds: choice.rounds,
      upToNano: cost(choice.all),
      turnNano: cost(choice.turn),
      wrapNano: cost(choice.wrap)
    }));
  }

  /**
   * A discussion card in a chat with two or more live bots, for the person who writes the question (one of the chat's
   * people): proposed, with its estimate, waiting for their Start. Everyone in the chat sees it. The question is kept in
   * the words everyone reads: the composer's mentions of the chat's bots and of its other people as "@Name" (D-114),
   * as the card, the chat list and each turn's prompt show it.
   * @returns {Promise<{ messages: object[] }>}
   */
  async function propose(chatId, { question } = {}, options) {
    const chat = await records.chats.get(String(chatId), options);
    const me = await person(chat, options);
    const [chatBots, people] = await Promise.all([records.chats.bots(chat.id, options), records.chats.people(chat.id, options)]);
    const named = plainMentions(
      String(question ?? ""),
      chatBots.map((bot) => ({ id: String(bot.bot_id), name: bot.name })),
      people.filter((one) => String(one.user_id) !== me).map((one) => ({ id: String(one.user_id), name: one.name }))
    );
    const asked = named.replace(/\s+/gu, " ").trim();
    if (!asked) throw refused(400, "Write what the bots should discuss first.", "bots_discussion_empty");
    if (asked.length > LIMITS.questionChars) {
      throw new BotsError(400, `A discussion's question can be up to ${LIMITS.questionChars} characters.`, {
        code: "bots_discussion_too_long", params: { limit: LIMITS.questionChars }
      });
    }
    const bots = live({ bots: chatBots });
    if (bots.length < 2) throw refused(409, "A discussion needs two or more bots in the chat.", "bots_discussion_needs_bots");
    const name = (await records.chats.names([me], options)).get(me) || "Someone";
    const body = {
      question: asked,
      status: "proposed",
      for: { id: me, name },
      authorName: name,
      bots: bots.map((bot) => ({ id: String(bot.bot_id), name: bot.name })),
      rounds: LIMITS.defaultRounds,
      round: 0,
      choices: await estimate(chat, bots, options),
      capNano: null,
      spentNano: 0,
      spentByBot: {},
      passed: [],
      ended: null
    };
    const messages = await records.messages.append(chat.id, [{ kind: "discussion", role: "user", body }], options);
    await seats.tell(chat.id, { type: "messages" }, options);
    return { messages };
  }

  /**
   * A card changed under a lock, so of two presses (or a press and a round's end, on any servers) one goes first and
   * the other sees what it did. `change(body)` answers the new body, or null to leave it; it may throw a refusal.
   * Answers the card as the page shows it, and whether it changed; the chat's people hear of a change.
   */
  async function changeCard(chatId, cardId, options, change) {
    const result = await records.chats.withTransaction(options, async (txOptions) => {
      const card = await records.messages.lockMessageIn(String(chatId), String(cardId), txOptions, { kind: "discussion" });
      if (!card) throw notFound();
      const next = change(discussionNow(card.body));
      if (!next) return { message: toMessage(card), changed: false };
      return { message: await records.messages.setBody(String(card.id), next, txOptions), changed: true };
    });
    if (result.changed) await seats.tell(String(chatId), { type: "messages" }, options);
    return result;
  }

  // A card keeps the token of the round that last ran (`run`), so that round still adds up what its last turn cost after
  // a Stop ended the card; only that round's runner writes while it says "running".
  const isRunning = (body, token) => body.status === "running" && body.run === token;
  const ended = (body, why, more = {}) => ({ ...body, status: "ended", ended: why, leaseUntil: null, ...more });
  // Waiting for a press: after a round, or once its round was interrupted.
  const awaitsPress = (body) => body.status === "waiting" || body.status === "interrupted";

  /** Only the person who started it presses Start, One more round and Wrap up (it's their work, R8). */
  function requireStarter(body, me) {
    if (String(body.for?.id) !== String(me)) {
      throw refused(403, `Only ${body.for?.name || "the person who started it"} can do that: it's their discussion.`, "bots_discussion_forbidden");
    }
  }

  /**
   * The bots that speak in a round and their runs in the chat, claimed: the card's bots still in the chat and not
   * archived, two or more. A bot still busy with a reply there refuses the press (409) and lets go of the others.
   */
  async function claimSpeakers(chat, body, starter) {
    const home = inHome(chat.workspace_id);
    const present = { people: await records.chats.people(chat.id, home), bots: await records.chats.bots(chat.id, home) };
    const speakers = live(present, new Set(body.bots.map((bot) => String(bot.id))));
    if (speakers.length < 2) throw refused(409, "A discussion needs two or more of its bots still in the chat.", "bots_discussion_needs_bots");
    const held = [];
    for (const bot of speakers) {
      const seat = await seats.seatIn(chat.id, bot.bot_id, starter, home);
      if (seat?.chat_bot_id && await chatHistory.claimReply(seat)) {
        held.push({ seat, call: seats.readerOf(seat) });
        continue;
      }
      await release(held);
      throw new BotsError(409, `${bot.name} is still answering. Try again once it has.`, { code: "bots_discussion_busy", params: { name: bot.name } });
    }
    return { held, present };
  }

  /** The runs a round held, let go. */
  async function release(held) {
    await Promise.all(held.map(({ seat }) => runs.release(seat.chat_bot_id)
      .catch((error) => console.warn("Releasing a bot's run after a discussion failed; its lease runs out instead.", error))));
  }

  /** The chat as a press finds it, with the caller, the card's body and what the page sends. */
  async function pressed(chatId, options) {
    const chat = await records.chats.get(String(chatId), options);
    return { chat, me: await person(chat, options) };
  }

  /** A round (or the wrap-up) starting from a press: claims, the card changed, then the round in the background. */
  async function startRound(chatId, cardId, input, options, change) {
    const { chat, me } = await pressed(chatId, options);
    const card = await records.messages.messageIn(String(chat.id), String(cardId), options, { kind: "discussion" });
    if (!card) throw notFound();
    requireStarter(card.body, me);
    change(discussionNow(card.body));
    const { held, present } = await claimSpeakers(chat, card.body, me);
    const token = randomUUID();
    const since = Number(await records.messages.latestId(chat.id, options)) || 0;
    let result;
    try {
      result = await changeCard(chat.id, cardId, options, (body) => ({ ...change(body), status: "running", run: token, passed: [], leaseUntil: leaseFrom() }));
    } catch (error) {
      await release(held);
      throw error;
    }
    const where = { timeZone: validTimeZone(input.timeZone) ? input.timeZone : "UTC", language: languageName(input.language) };
    background.add(runRound(chat, String(cardId), token, held, present, where, since));
    return { message: result.message };
  }

  /** Start: the rounds chosen (1 to 3, else the card's), its cap fixed, and round 1. */
  function start(chatId, cardId, input = {}, options) {
    const rounds = input.rounds === undefined ? null : Number(input.rounds);
    if (rounds !== null && !(Number.isInteger(rounds) && rounds >= 1 && rounds <= LIMITS.rounds)) {
      throw new BotsError(400, `A discussion has 1 to ${LIMITS.rounds} rounds.`, { code: "bots_discussion_rounds", params: { limit: LIMITS.rounds } });
    }
    return startRound(chatId, cardId, input, options, (body) => {
      if (body.status !== "proposed") throw refused(409, "This discussion has started already.", "bots_discussion_started");
      const chosen = rounds ?? body.rounds;
      const choice = body.choices.find((entry) => entry.rounds === chosen);
      const startedAt = body.startedAt || new Date().toISOString();
      const { upToNano: capNano, turnNano, wrapNano } = choice;
      return { ...body, rounds: chosen, round: 1, capNano, turnNano, wrapNano, startedAt };
    });
  }

  /** One more round, after the last one ended, while the rounds chosen allow. */
  function nextRound(chatId, cardId, input = {}, options) {
    return startRound(chatId, cardId, input, options, (body) => {
      if (!awaitsPress(body) || body.wrapping) throw refused(409, "This discussion isn't waiting for another round.", "bots_discussion_not_waiting");
      if (body.round >= body.rounds) throw refused(409, `This discussion had all its ${body.rounds} rounds. Wrap it up, or start a new one.`, "bots_discussion_rounds_done");
      return { ...body, round: body.round + 1 };
    });
  }

  /** Wrap up: one bot sums the discussion up, and it ends. */
  function wrapUp(chatId, cardId, input = {}, options) {
    return startRound(chatId, cardId, input, options, (body) => {
      if (!awaitsPress(body)) throw refused(409, "This discussion isn't waiting to be wrapped up.", "bots_discussion_not_waiting");
      return { ...body, wrapping: true };
    });
  }

  /** Cancel, before it starts. */
  async function cancel(chatId, cardId, options) {
    const { chat, me } = await pressed(chatId, options);
    const { message } = await changeCard(chat.id, cardId, options, (body) => {
      requireStarter(body, me);
      if (body.status !== "proposed") throw refused(409, "This discussion has started already: stop it instead.", "bots_discussion_started");
      return ended(body, "cancelled");
    });
    return { message };
  }

  /**
   * Stop, at any time before it ends, by the person who started it or a manager of the chat: the card ends at once, and
   * a running round stops at its next heartbeat or turn and lets go of the bots' runs.
   */
  async function stop(chatId, cardId, options) {
    const { chat, me } = await pressed(chatId, options);
    const name = (await records.chats.names([me], options)).get(me) || "Someone";
    const { message } = await changeCard(chat.id, cardId, options, (body) => {
      if (String(body.for?.id) !== me && !mayChangeBot(chat.made_by, me, options)) {
        throw refused(403, "Only the person who started this discussion, and the chat's managers, can stop it.", "bots_discussion_forbidden");
      }
      if (body.status === "ended") return null;
      return ended(body, body.status === "proposed" ? "cancelled" : "stopped", { stoppedBy: { id: me, name } });
    });
    return { message };
  }

  /**
   * One round, or the wrap-up, holding its speakers' runs: each turn in order, each checked against the cap first and
   * metered to the person and the bot (R8). It stops when the card no longer says this round runs (Stop), at the cap,
   * in a paused home, or when a turn fails; then it lets go of the runs and the bots take up what was written meanwhile.
   */
  async function runRound(chat, cardId, token, held, present, where, since) {
    const home = inHome(chat.workspace_id);
    const control = new AbortController();
    const current = async () => {
      const card = await records.messages.messageIn(String(chat.id), cardId, home, { kind: "discussion" });
      return card ? discussionNow(card.body) : null;
    };
    const stopped = () => control.abort(new Error("The discussion was stopped."));
    // Each heartbeat renews the runs and the card's lease while the card says this round runs; once it doesn't (Stop,
    // or a lease that lapsed meanwhile), the turn in progress stops.
    const heartbeat = setInterval(() => {
      for (const { seat } of held) {
        runs.heartbeat(seat.chat_bot_id).catch((error) => console.warn("A discussion's heartbeat failed; the next one renews it.", error));
      }
      changeCard(chat.id, cardId, home, (body) => (isRunning(body, token) ? { ...body, leaseUntil: leaseFrom() } : null)).then(
        ({ changed }) => changed || stopped(),
        (error) => (error?.statusCode === 404 ? stopped() : console.warn("Renewing a discussion's lease failed; the next heartbeat renews it.", error))
      );
    }, heartbeatMs);
    const finish = (change) => changeCard(chat.id, cardId, home, (body) => (isRunning(body, token) ? change(body) : null));
    // What each bot's turns cost so far, written while the card is this round's, running or stopped meanwhile.
    const record = (seat, cost, outcome) => changeCard(chat.id, cardId, home, (now) => {
      if (now.run !== token) return null;
      const spentByBot = { ...now.spentByBot, [seat.id]: Number(now.spentByBot?.[seat.id] || 0) + cost };
      const passed = outcome === "passed" ? [...now.passed, seat.id] : now.passed;
      return { ...now, spentByBot, spentNano: Object.values(spentByBot).reduce((sum, value) => sum + Number(value || 0), 0), passed };
    });
    try {
      let body = await current();
      const speakers = body?.wrapping ? held.slice(0, 1) : held;
      const spoke = new Set();
      for (const { seat: claimed } of speakers) {
        body = await current();
        if (!body || !isRunning(body, token)) return;
        const estimate = body.wrapping ? body.wrapNano : body.turnNano;
        if (Number(body.spentNano) + Number(estimate) > Number(body.capNano)) {
          await finish((now) => ended(now, "cap"));
          return;
        }
        const seat = await seats.seatIn(chat.id, claimed.id, body.for.id, home);
        // An archived chat stops it (D-101): nothing runs where nobody may write. A bot gone or archived misses its turn.
        if (seat?.chat?.archived_at) {
          await finish((now) => ended(now, "stopped"));
          return;
        }
        if (!seat?.chat_bot_id || seat.archived_at) continue;
        const { outcome, cost } = await turn(seat, cardId, body, present, where, control.signal);
        await record(seat, cost, outcome);
        if (outcome === "stopped") return;
        if (outcome === "paused" || outcome === "failed") {
          await finish((now) => ended(now, outcome));
          return;
        }
        if (outcome === "spoke") spoke.add(seat.id);
      }
      await finish((now) => {
        if (now.wrapping) return ended(now, "wrapped", { wrappedBy: speakers[0]?.seat.id ?? null });
        if (!spoke.size) return ended(now, "passed");
        return { ...now, status: "waiting", run: null, leaseUntil: null };
      });
    } catch (error) {
      console.error(`A discussion in chat ${chat.id} stopped: ${error?.message || error}`);
      await finish((now) => ended(now, "failed")).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await release(held);
      for (const { seat, call } of held) replies.takeUpWaiting(seat, since, where, call);
    }
  }

  /**
   * One bot's turn: a reply that only talks, with the round's words or the wrap-up's, through the replies' own turn
   * (the bot's instructions, the chat as it reads it, the state note), metered to the person and the bot, as chat work.
   * Answers how it went, "spoke", "passed", "paused", "stopped" or "failed", and what its own AI calls cost.
   */
  async function turn(seat, cardId, body, present, where, signal) {
    const call = seats.readerOf(seat);
    const others = body.bots.filter((bot) => bot.id !== seat.id).map((bot) => bot.name).join(", ");
    const prompt = body.wrapping ? wrapPrompt(body) : roundPrompt({ ...body, others, by: body.for.name });
    const discussion = {
      id: String(cardId),
      round: body.wrapping ? "wrap" : body.round,
      mayPass: !body.wrapping,
      signal,
      model: {
        reasoning: REASONING.off,
        modelSettings: { maxOutputTokens: body.wrapping ? LIMITS.wrapOutputTokens : LIMITS.turnOutputTokens }
      }
    };
    const calls = [];
    let outcome;
    await seats.working(seat, true, null, call);
    try {
      const posted = await meter.counting(calls, () => meter.track(
        { userId: seat.user_id, botId: seat.id, workspaceId: seat.workspace_id, work: "chat" },
        () => replies.respond(seat, { ...where, prompt, present, discussion, call })
      ));
      if (posted.length) await seats.tell(seat.chat_id, { type: "messages" }, call);
      // Nothing said: it passed, unless its home is paused (the turn then left one line saying so, or found one).
      if (posted.some((message) => message.role === "bot" && message.kind === "text")) outcome = "spoke";
      else outcome = (await meter.pausedMessage(seat.workspace_id)) ? "paused" : "passed";
    } catch (error) {
      if (!signal.aborted) console.error(`Bot ${seat.id}'s turn in a discussion failed: ${error?.message || error}`);
      outcome = signal.aborted ? "stopped" : "failed";
    } finally {
      await seats.working(seat, false, null, call);
    }
    return { outcome, cost: await costOf(seat.workspace_id, calls) };
  }

  /** What a turn's own AI calls cost the home, in nanodollars, each as the meter counts it (R8). */
  async function costOf(homeId, calls) {
    const used = await Promise.all(calls);
    const costs = await Promise.all(used.map(({ provider, kind, ...figures }) =>
      meter.estimateNano({ ...figures, workspaceId: String(homeId), kind: kind || WORK.chat.kind, provider })));
    return costs.reduce((sum, nano) => sum + Math.round(Number(nano) || 0), 0);
  }

  return Object.freeze({
    propose,
    start,
    nextRound,
    wrapUp,
    cancel,
    stop
  });
}
