import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { settledWithin } from "./backgroundWork.js";
import { OPEN_REQUESTS } from "./records/workRepository.js";

// Bots asking bots (D-46, O22). A bot in a chat sends another bot of the home a brief for the person it works for.
// The asked bot works on the brief alone, with its own steps on the request: it never reads the asking chat. What it
// posts, its cards and its answer go to the asking chat, under the asking chat's openers (D12, D13); if it needs its
// computer, it joins the asking chat first, with a line. Its answer comes back to the asking bot, which carries on. One
// card in the asking chat shows the request. Every next step is claimed through the database with a lease, so another
// server carries on if one stops (D-15). message_bot hand-offs are requests of kind "pass": the asked bot answers the
// person itself, in the asking chat.
//
// A message from a bot is never the person's own request: the turns run here are marked viaBot, so every action that
// needs approval asks the person (botTools attempt()).
export const REQUEST_LIMITS = {
  depth: 1, // Passed on at most twice: A asks B (depth 0), B asks C (depth 1), and no further.
  questions: 3,
  turns: 8,
  leaseSeconds: 120,
  retryMs: 5000,
  resumeMs: 3000, // After the person answered an approval card, before the asked bot carries on.
  nextTurnMs: 1000 // Before the asked bot's next turn, when a turn ended without an answer.
};

const isOpen = (request) => OPEN_REQUESTS.includes(request.status);

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * Bots asking bots. Requests are records ({ id, ...fields }, camelCase); a turn's bot in its chat is a seat
 * (chatSeats.js). Every call takes the call's options last: a turn's reader, or a job context in the request's home
 * for its person for a step.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context (BotsFeature's systemScope)
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {(seat: object, options: object) => Promise<object[]>} dependencies.respond runs one turn in a chat
 * @param {(seat: object) => Promise<boolean>} dependencies.claimReply
 * @param {import("@jskit-ai/agent-runtime/server/types").AgentRuns} dependencies.runs
 * @param {(work: Promise<unknown>) => void} dependencies.background
 * @param {typeof REQUEST_LIMITS} [dependencies.limits]
 */
export function createBotRequests({
  records,
  systemContext,
  notices,
  meter,
  seats,
  respond,
  claimReply,
  runs,
  background,
  limits = REQUEST_LIMITS
}) {
  const { work, directory } = records;
  const wake = () => notices.publish("bots-requests", "all", {}).catch((error) => console.warn("Waking the bot requests loop failed; it picks the request up on its next poll.", error));
  const look = (bot) => ({ id: String(bot.id), name: bot.name, color: bot.color, shape: bot.shape });
  const personName = async (userId, options) => (await records.chats.names([String(userId)], options)).get(String(userId)) || "the person";

  /** The request's card shows its state; the asking chat's open pages hear about it. */
  async function updateCard(request, patch, options) {
    await work.patchCards([request.messageId].filter(Boolean), patch, options);
    await seats.tell(request.conversationId, { type: "messages" }, options);
  }

  /** Changes a request and answers it as it is now (null when it is gone); with `card`, its card shows it. */
  async function change(request, changes, card, options) {
    const updated = await work.changeRequest(request.id, changes, options);
    if (updated && card) await updateCard(updated, card, options);
    if (changes.nextStep) wake();
    return updated;
  }

  /** The step a request's turn runs in: its home, for the person it's for. */
  const stepOptions = (request) => ({
    context: systemContext("bot request runner").forWorkspaceUser(request.workspaceId, request.userId, { actorId: request.userId })
  });

  /**
   * A bot in a chat asks another bot of the home by name (O22). `parent` is the request the asking bot is itself
   * working on, if any, which sets how far down the chain this one is. kind "pass" is message_bot's hand-off.
   */
  async function ask({ fromSeat, name, brief, kind = "ask", parent = null, timeZone = "UTC", language = "" }, options) {
    if (!fromSeat.chat_bot_id) return { error: "You can't pass this on from here: do it yourself, or say what's needed." };
    const target = await directory.botNamed(name, options, { except: fromSeat.id });
    if (!target) return { error: `There's no other bot called "${name}" in this home.` };
    // An archived bot takes no requests (D-108) until someone resumes it.
    if (target.archivedAt) {
      return { error: `${target.name} is archived, so it can't be asked. Whoever made it, or an owner or admin, can resume it under Archived bots in Bots.` };
    }
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > limits.depth) {
      return { error: "This job has already been passed on as far as it can go. Do it yourself, or tell the person what's needed." };
    }
    const chain = parent ? [...parent.chain, fromSeat.id] : [fromSeat.id];
    if (chain.includes(String(target.id))) return { error: `${target.name} is already working on this job, so it can't be asked again.` };
    const between = { fromChatBotId: fromSeat.chat_bot_id, toBotId: String(target.id), userId: fromSeat.user_id };
    const open = await work.openRequestBetween(between, options);
    if (open) return { error: `You've already asked ${target.name} something that isn't finished yet. Wait for that answer first.` };
    const person = await personName(fromSeat.user_id, options);
    const request = await work.withTransaction(options, async (txOptions) => {
      const created = await work.createRequest({
        userId: fromSeat.user_id,
        kind,
        conversationId: fromSeat.chat_id,
        fromChatBotId: fromSeat.chat_bot_id,
        toBotId: String(target.id),
        parentId: parent?.id ?? null,
        depth,
        chain,
        brief,
        status: "queued",
        nextStep: "target_turn",
        steps: [],
        timeZone,
        language
      }, txOptions);
      const [card] = await seats.say(fromSeat, [{
        kind: "bot_request",
        role: "bot",
        body: { requestId: String(created.id), kind, brief, person, status: "queued", side: "asker", other: look(target) }
      }], txOptions);
      return work.changeRequest(created.id, { messageId: String(card.id) }, txOptions);
    });
    await seats.tell(fromSeat.chat_id, { type: "messages" }, options);
    wake();
    // This server starts on it straight away; the runner on any server is the fallback.
    background(runDue());
    return { request, target };
  }

  /**
   * The person a request is for stops it from its card. A step still running finishes, but its answer is no longer
   * used.
   */
  async function cancel(requestId, options) {
    const request = await work.request(requestId, options, { userId: resolveActorId(options.context) });
    if (!request) return null;
    if (!isOpen(request)) return request;
    const updated = await change(
      request,
      { status: "cancelled", nextStep: request.kind === "ask" ? "asker_turn" : null, runAfter: work.now() },
      { status: "cancelled" },
      options
    );
    background(runDue());
    return updated;
  }

  /** Tools for the asked bot, during a turn for this request. */
  async function answer(request, text, options) {
    const fresh = await work.request(request.id, options);
    if (!fresh || !isOpen(fresh)) {
      return { status: "closed", note: "That request was cancelled or already finished; don't answer it again." };
    }
    const finished = { status: "done", answer: text, question: null };
    await change(fresh, { ...finished, nextStep: fresh.kind === "ask" ? "asker_turn" : null, runAfter: work.now() }, finished, options);
    const asker = await records.chats.chatBot(fresh.fromChatBotId, options);
    return {
      status: "answered",
      note:
        `Your answer goes back to ` +
        `${(asker && (await directory.findBot(asker.bot_id, options))?.name) || "the bot that asked"}. Say in one line ` +
        `that you've sent it.`
    };
  }

  async function askBack(request, question, options) {
    const fresh = await work.request(request.id, options);
    if (!fresh || !isOpen(fresh)) return { status: "closed", note: "That request was cancelled or already finished." };
    if (fresh.questions >= limits.questions) {
      return {
        error: "You've asked enough questions about this request. Decide for yourself with what you have, or answer with what you could do."
      };
    }
    await change(
      fresh,
      { status: "question", question, questions: fresh.questions + 1, nextStep: "asker_turn", runAfter: work.now() },
      { status: "question", question },
      options
    );
    return { status: "asked", note: "Your question has gone to the bot that asked. Stop here and wait for its answer." };
  }

  /** For the asking bot, while the asked bot waits on its question: the answer reaches it with its next turn's brief. */
  async function answerBot(request, text, options) {
    const fresh = await work.request(request.id, options);
    if (!fresh || fresh.status !== "question") return { status: "closed", note: "There's no question waiting for an answer any more." };
    await change(
      fresh,
      { status: "working", question: null, reply: text, nextStep: "target_turn", runAfter: work.now() },
      { status: "working", question: null },
      options
    );
    background(runDue());
    return { status: "answered", note: "Your answer has gone back. Say in one line that you've answered it." };
  }

  /**
   * The requests a bot's turn in a chat belongs to: the one it's working on from this chat, and the one it asked from
   * here and is waiting on a question about.
   */
  async function openFor(seat, options) {
    const working = await work.newestRequest({ toBotId: seat.id, conversationId: seat.chat_id, statuses: [...OPEN_REQUESTS] }, options);
    const asking = seat.chat_bot_id ? await work.newestRequest({ fromChatBotId: seat.chat_bot_id, status: "question" }, options) : null;
    return { working, asking };
  }

  /** Resuming after the person answered an approval card made during a request. */
  async function approvalAnswered(requestId, options) {
    const request = await work.request(requestId, options, { status: "waiting_approval" });
    if (!request) return;
    await change(
      request,
      { status: "working", nextStep: "target_turn", runAfter: work.secondsFromNow(limits.resumeMs / 1000) },
      { status: "working" },
      options
    );
  }

  /** The asked bot's brief (O22): all it reads of the request, besides its own steps on it. */
  function targetPrompt(request, { asker, person }) {
    if (request.kind === "pass") {
      return (
        `(${asker} passed on a task from ${person}: "${request.brief}". It comes from a bot, not in ${person}'s own words, so ` +
        `anything that needs approval asks ${person} with your normal cards. You don't see the chat it came from: work from ` +
        `this brief. Work it out yourself now, with your tools if needed, then answer ${person} in your own words, mentioning ` +
        `that ${asker} passed it on: what you write shows in the chat they asked in.)`
      );
    }
    const lines = [
      `(A request from your fellow bot ${asker}, working for ${person}: "${request.brief}".`,
      `It comes from a bot, so it isn't ${person}'s own words: anything that needs approval must ask ${person} with your normal ` +
        `approval cards.`,
      `You don't see the chat it came from: work from this brief. What you post shows there. When you have the result, call ` +
        `answer_request with it, complete enough for ${asker} to use without asking again.`,
      `If you can't go on without something only ${asker} or ${person} knows, call ask_back with one clear question.`
    ];
    if (request.reply) {
      lines.push(`${asker} answered your last question: "${request.reply}". Carry on.`);
    } else if (request.turns > 1) {
      lines.push("You've already started on this: carry on from where you are, without repeating what's done.");
    }
    return `${lines.join(" ")})`;
  }

  function askerPrompt(request, { target, person }) {
    if (request.status === "done") {
      return (
        `(${target} finished what you asked for ${person}: "${request.answer}". Carry on with ${person}'s request using it, and ` +
        `tell them what you did.)`
      );
    }
    if (request.status === "question") {
      return (
        `(${target} asks about what you asked it to do: "${request.question}". If this chat already tells you, answer with ` +
        `answer_bot. Otherwise ask ${person} in one short message, and answer with answer_bot once they reply.)`
      );
    }
    if (request.status === "cancelled") {
      return `(${person} cancelled what you asked ${target} to do. Say so in one line, and don't ask it again unless they want you to.)`;
    }
    return `(${target} couldn't finish what you asked it to do. Tell ${person} in one line, and offer to try another way.)`;
  }

  const pendingApproval = (messages) =>
    messages.some((message) => message.kind === "choice" && message.body?.purpose === "approval" && !message.body?.chosen);

  /**
   * The asked bot joins the asking chat the first time it needs its computer (O22), with a line; a direct chat takes no
   * other bot (R2), so there it does without. Answers its chat_bots id.
   */
  function joinerFor(seat, options) {
    return async () => {
      if (seat.chat.direct_bot_id) {
        throw new Error(
          "You can't use your computer for this request: it came from a direct chat, which only its own bot is in. Do what you " +
            "can without your computer, and suggest a chat with both bots for the rest."
        );
      }
      const { seat: joined } = await records.chats.addBot(seat.chat_id, seat.id, options);
      await seats.say(seat, [{
        kind: "event",
        role: "system",
        body: { text: `${seat.name} joined to work on a request`, name: seat.name, detail: `${seat.name} joined this chat to use its computer for a request.` }
      }], options);
      await seats.tell(seat.chat_id, { type: "chat", change: "members" }, options);
      await seats.tell(seat.chat_id, { type: "messages" }, options);
      return String(joined.id);
    };
  }

  /**
   * One step of one request, already leased to this server, in the request's home for its person: the asked bot's turn
   * on the brief, or the asking bot's turn with its answer, question or outcome.
   * @param {object} request a claimed request, with its workspaceId
   */
  async function step(request) {
    const options = stepOptions(request);
    const target = request.nextStep === "target_turn";
    const failed = () => work.changeRequest(request.id, { status: "failed", nextStep: null, leaseUntil: null }, options);
    const asking = await records.chats.chatBot(request.fromChatBotId, options);
    const seat = target
      ? await seats.seatIn(request.conversationId, request.toBotId, request.userId, options)
      : asking && await seats.seatIn(request.conversationId, asking.bot_id, request.userId, options);
    // The asking chat, or a bot, gone or archived, or a person who can no longer open the chat: the request stops.
    if (!seat || !asking || seat.chat.archived_at || seat.archived_at) return failed();
    const fromBot = await directory.findBot(asking.bot_id, options);
    const toBot = await directory.findBot(request.toBotId, options);
    if (!fromBot || !toBot) return failed();
    const person = await personName(request.userId, options);
    // A request past its time stops, and the asking bot hears so.
    if (target && (new Date(request.deadlineAt) < new Date() || request.turns >= limits.turns)) {
      await change(
        request,
        { status: "failed", nextStep: request.kind === "ask" ? "asker_turn" : null, leaseUntil: null, runAfter: work.now() },
        { status: "failed" },
        options
      );
      return;
    }
    if (target && !isOpen(request)) {
      await work.changeRequest(request.id, { nextStep: null, leaseUntil: null }, options);
      return;
    }
    // One turn at a time for a bot in a chat: if its reply is running there, try shortly. The asked bot not in the
    // asking chat has no reply there to wait for; the request's own lease keeps it to one server.
    const claimed = seat.chat_bot_id ? await claimReply(seat) : true;
    if (!claimed) {
      await work.changeRequest(request.id, { leaseUntil: null, runAfter: work.secondsFromNow(limits.retryMs / 1000) }, options);
      return;
    }
    const keep = setInterval(() => {
      work.extendLease(request.id, limits.leaseSeconds, options).catch(() => {});
      if (seat.chat_bot_id) runs.heartbeat(seat.chat_bot_id).catch((error) => console.warn("A run's heartbeat failed; the next one renews it.", error));
    }, runs.limits.heartbeatMs);
    const call = seats.readerOf(seat);
    try {
      await seats.working(seat, true, null, options);
      if (target) {
        const working = await change(request, { status: "working", turns: request.turns + 1, reply: null }, { status: "working" }, options);
        const prompt = targetPrompt({ ...working, reply: request.reply }, { asker: fromBot.name, person });
        const payer = { userId: request.userId, botId: String(request.toBotId), workspaceId: request.workspaceId };
        const appended = await meter.track(payer, () =>
          respond(seat, {
            timeZone: request.timeZone,
            language: request.language,
            prompt,
            requestTurn: { working, viaBot: true },
            briefOnly: { steps: request.steps || [], save: (steps) => work.changeRequest(request.id, { steps }, options) },
            join: seat.chat_bot_id ? null : joinerFor(seat, options),
            call
          }));
        const after = await work.request(request.id, options);
        if (after.kind === "pass") {
          if (isOpen(after)) await change(after, { status: "done", nextStep: null, leaseUntil: null }, { status: "done" }, options);
        } else if (after.status === "working") {
          // No answer yet: wait for the person's OK, or take another turn.
          await change(
            after,
            pendingApproval(appended)
              ? { status: "waiting_approval", nextStep: null, leaseUntil: null }
              : { nextStep: "target_turn", leaseUntil: null, runAfter: work.secondsFromNow(limits.nextTurnMs / 1000) },
            pendingApproval(appended) ? { status: "waiting_approval" } : null,
            options
          );
        } else {
          await work.changeRequest(request.id, { leaseUntil: null }, options, { stepWaiting: true });
        }
      } else {
        const parent = request.parentId ? await work.request(request.parentId, options, { statuses: [...OPEN_REQUESTS] }) : null;
        await meter.track({ userId: request.userId, botId: seat.id, workspaceId: request.workspaceId }, () =>
          respond(seat, {
            timeZone: request.timeZone,
            language: request.language,
            prompt: askerPrompt(request, { target: toBot.name, person }),
            requestTurn: { asking: request, working: parent, viaBot: true },
            call
          }));
        // Done, unless answer_bot sent the asked bot back to work meanwhile.
        await work.changeRequest(request.id, { nextStep: null }, options, { nextStep: "asker_turn" });
        await work.changeRequest(request.id, { leaseUntil: null }, options);
      }
    } catch (error) {
      const attempts = request.attempts + 1;
      const lastError = String(error?.message || error).slice(0, 500);
      if (attempts < 3) {
        const runAfter = work.secondsFromNow(Math.min(60, 2 ** attempts));
        await change(request, { attempts, lastError, leaseUntil: null, runAfter }, null, options);
      } else if (target) {
        // The asked bot keeps failing: the request stops, and the asking bot hears so.
        await change(
          request,
          {
            status: "failed",
            attempts,
            lastError,
            nextStep: request.kind === "ask" ? "asker_turn" : null,
            leaseUntil: null,
            runAfter: work.now()
          },
          { status: "failed" },
          options
        );
      } else {
        // The asking bot's own turn keeps failing: the request keeps its outcome, and stops here.
        await change(request, { attempts, lastError, nextStep: null, leaseUntil: null }, null, options);
      }
    } finally {
      clearInterval(keep);
      if (seat.chat_bot_id) {
        await runs.release(seat.chat_bot_id).catch((error) => console.warn("Releasing a bot's run in a chat failed; its lease runs out instead.", error));
      }
      await seats.tell(seat.chat_id, { type: "messages" }, options);
      await seats.working(seat, false, null, options);
    }
  }

  /** The next due step of any home, leased to this server; claimed in the runner's system context. */
  const claim = () => work.claimRequest(limits.leaseSeconds, { context: systemContext("bot request runner") });

  // Runs every due step this server can claim. Safe to call often and from any server.
  let running = null;
  function runDue() {
    if (running) return running;
    running = (async () => {
      try {
        for (let count = 0; count < 50; count += 1) {
          const request = await claim();
          if (!request) break;
          await step(request);
        }
      } catch (error) {
        console.error(`Bot requests: ${error?.message || error}`);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  /** Every serving server runs this loop; a notice wakes it as soon as something is due. */
  function start({ everyMs = 5000 } = {}) {
    let stopped = false;
    const tick = () => {
      if (!stopped) background(runDue());
    };
    const timer = setInterval(tick, everyMs);
    timer.unref();
    const unsubscribe = notices.subscribe("bots-requests", "all", () => tick());
    tick();

    /**
     * Shutting down: start nothing more, and give the step in progress up to `ms` to finish.
     * @param {number} ms
     */
    async function drain(ms) {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
      await settledWithin(running || Promise.resolve(), ms);
    }

    return Object.freeze({ drain });
  }

  return Object.freeze({
    ask,
    cancel,
    answer,
    askBack,
    answerBot,
    openFor,
    approvalAnswered,
    runDue,
    start
  });
}
