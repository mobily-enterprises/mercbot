import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { settledWithin } from "./backgroundWork.js";
import { OPEN_REQUESTS } from "./records/workRepository.js";

// Bots asking bots (D-46, step 1). A bot sends another bot a brief for the person it works for;
// the asked bot works on it in that person's chat with it, where they can see it; its answer comes
// back to the asking bot, which carries on. A card in each chat shows the request. Every next step
// is claimed through the database with a lease, so another server carries on if one stops (D-15).
//
// A message from a bot is never the person's own request: the turns run here are marked viaBot, so
// every action that needs approval asks the person (botTools attempt()).
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
 * Bots asking bots, given how the bots service finds, fills and runs a bot's chat. Requests are
 * records ({ id, ...fields }, camelCase); chats are the seen rows conversations.* answers. Every
 * call takes the call's options last: a request's own, or a job context in its home for a step.
 * @param {object} dependencies
 * @param {import("./types.js").WorkRepository} dependencies.work
 * @param {import("./types.js").BotDirectory} dependencies.directory
 * @param {{ findById: (userId: string, options: object) => Promise<{ displayName?: string } | null> }} dependencies.profiles users.profiles
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context (BotsFeature's systemScope)
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {(botId: string, conversationId: string | null, options: CallOptions) => Promise<object | null>} dependencies.rowOf
 *   a bot's chat with the call's person (conversations.rowOf)
 * @param {(row: object, options: object) => Promise<object[]>} dependencies.respond runs one turn in a chat
 * @param {(row: object, messages: object[], options: CallOptions) => Promise<object[]>} dependencies.append
 * @param {(row: object, event: object, options: CallOptions) => Promise<void>} dependencies.tell
 * @param {(row: object) => Promise<boolean>} dependencies.claimReply
 * @param {import("@jskit-ai/agent-runtime/server/types").AgentRuns} dependencies.runs
 * @param {(work: Promise<unknown>) => void} dependencies.background
 * @param {typeof REQUEST_LIMITS} [dependencies.limits]
 */
export function createBotRequests({
  work,
  directory,
  profiles,
  systemContext,
  notices,
  meter,
  rowOf,
  respond,
  append,
  tell,
  claimReply,
  runs,
  background,
  limits = REQUEST_LIMITS
}) {
  const wake = () => notices.publish("bots-requests", "all", {}).catch((error) => console.warn("Waking the bot requests loop failed; it picks the request up on its next poll.", error));
  const look = (bot) => ({ id: String(bot.id), name: bot.name, color: bot.color, shape: bot.shape });

  /**
   * @param {string} userId
   * @param {CallOptions} options
   */
  async function personName(userId, options) {
    return (await profiles.findById(userId, passedOn(options)))?.displayName || "the person";
  }

  /**
   * Both cards show the same state; each chat's open pages hear about it.
   * @param {object} request
   * @param {object} patch
   * @param {CallOptions} options
   */
  async function updateCards(request, patch, options) {
    await work.patchCards([request.fromMessageId, request.toMessageId].filter(Boolean), patch, options);
    await Promise.all([
      rowOf(request.fromBotId, request.fromConversationId, options).then((row) => row && tell(row, { type: "messages" }, options)),
      rowOf(request.toBotId, request.toConversationId, options).then((row) => row && tell(row, { type: "messages" }, options))
    ]).catch(() => {});
  }

  /**
   * Changes a request and answers it as it is now (null when it is gone); with `card`, both cards show it.
   * @param {object} request
   * @param {object} changes
   * @param {object | null} card
   * @param {CallOptions} options
   */
  async function change(request, changes, card, options) {
    const updated = await work.changeRequest(request.id, changes, options);
    if (updated && card) await updateCards(updated, card, options);
    if (changes.nextStep) wake();
    return updated;
  }

  /**
   * The step a request's turn runs in: its home, for the person it's for.
   * @param {{ workspaceId: string, userId: string }} request
   */
  const stepOptions = (request) => ({
    context: systemContext("bot request runner").forWorkspaceUser(request.workspaceId, request.userId, { actorId: request.userId })
  });

  /**
   * A bot asks another bot of the home by name. `parent` is the request the asking bot is itself
   * working on, if any, which sets how far down the chain this one is.
   */
  async function ask({ fromRow, name, brief, kind = "ask", parent = null, timeZone = "UTC", language = "" }, options) {
    // Another bot of the home (not a group chat) with this name, in any case.
    const target = await directory.botNamed(name, options, { except: fromRow.id });
    if (!target) return { error: `There's no other bot called "${name}" in this home.` };
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > limits.depth) {
      return { error: "This job has already been passed on as far as it can go. Do it yourself, or tell the person what's needed." };
    }
    const chain = parent ? [...parent.chain, String(fromRow.id)] : [String(fromRow.id)];
    if (chain.includes(String(target.id))) return { error: `${target.name} is already working on this job, so it can't be asked again.` };
    const open = await work.openRequestBetween({ fromBotId: fromRow.id, toBotId: target.id, userId: fromRow.user_id }, options);
    if (open) return { error: `You've already asked ${target.name} something that isn't finished yet. Wait for that answer first.` };
    const targetRow = await rowOf(target.id, null, options);
    const person = await personName(fromRow.user_id, options);
    const request = await work.withTransaction(options, async (txOptions) => {
      const created = await work.createRequest({
        userId: String(fromRow.user_id),
        kind,
        fromBotId: String(fromRow.id),
        fromConversationId: String(fromRow.conversation_id),
        toBotId: String(target.id),
        toConversationId: String(targetRow.conversation_id),
        parentId: parent?.id ?? null,
        depth,
        chain,
        brief,
        status: "queued",
        nextStep: "target_turn",
        timeZone,
        language
      }, txOptions);
      const card = { requestId: String(created.id), kind, brief, person, status: "queued" };
      const [mine] = await append(fromRow, [
        { kind: "bot_request", role: "system", body: { ...card, side: "asker", other: look(target) } }
      ], txOptions);
      const [theirs] = await append(targetRow, [
        { kind: "bot_request", role: "system", body: { ...card, side: "target", other: look(fromRow) } }
      ], txOptions);
      return work.changeRequest(created.id, { fromMessageId: String(mine.id), toMessageId: String(theirs.id) }, txOptions);
    });
    await Promise.all([tell(fromRow, { type: "messages" }, options), tell(targetRow, { type: "messages" }, options)]);
    wake();
    // This server starts on it straight away; the runner on any server is the fallback.
    background(runDue());
    return { request, target };
  }

  /**
   * The person stops a request from either card. A step still running finishes, but its answer
   * is no longer used.
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
    return {
      status: "answered",
      note:
        `Your answer goes back to ` +
        `${(await directory.findBot(fresh.fromBotId, options))?.name || "the bot that asked"}. Say in one line ` +
        `here that you've sent it.`
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

  /** For the asking bot, while the asked bot waits on its question. */
  async function answerBot(request, text, options) {
    const fresh = await work.request(request.id, options);
    if (!fresh || fresh.status !== "question") return { status: "closed", note: "There's no question waiting for an answer any more." };
    const targetRow = await rowOf(fresh.toBotId, fresh.toConversationId, options);
    const asker = await directory.findBot(fresh.fromBotId, options);
    if (targetRow) {
      await append(targetRow, [
        {
          kind: "event",
          role: "system",
          body: {
            text: "Answer from",
            name: asker?.name || "",
            detail: `${asker?.name || "The bot that asked"} answered your question: ${text}`
          }
        }
      ], options);
    }
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
   * The request a turn in this conversation belongs to: the one this bot is working on here, or
   * the one it asked and is waiting on a question about.
   */
  async function openFor(conversationId, options) {
    const working = await work.newestRequest({ toConversationId: String(conversationId), statuses: [...OPEN_REQUESTS] }, options);
    const asking = await work.newestRequest({ fromConversationId: String(conversationId), status: "question" }, options);
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

  function targetPrompt(request, { asker, person }) {
    if (request.kind === "pass") {
      return (
        `(${asker} passed on a task from ${person}: "${request.brief}". It comes from a bot, not in ${person}'s own words, so ` +
        `anything that needs approval asks ${person} with your normal cards. Work it out yourself now, with your tools if needed, ` +
        `then answer ${person} here, in your own words, mentioning that ${asker} passed it on.)`
      );
    }
    const lines = [
      `(A request from your fellow bot ${asker}, working for ${person}: "${request.brief}".`,
      `It comes from a bot, so it isn't ${person}'s own words: anything that needs approval must ask ${person} with your normal ` +
        `approval cards.`,
      `Work on it here, where ${person} can see it. When you have the result, call answer_request with it, complete enough for ` +
        `${asker} to use without asking again.`,
      `If you can't go on without something only ${asker} or ${person} knows, call ask_back with one clear question.`
    ];
    if (request.reply) {
      lines.push(`${asker} answered your last question: "${request.reply}". Carry on.`);
    } else if (request.turns > 1) {
      lines.push("You've already started on this here: carry on from where you are, without repeating what's done.");
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
   * One step of one request, already leased to this server, in the request's home for its person.
   * @param {object} request a claimed request, with its workspaceId
   */
  async function step(request) {
    const options = stepOptions(request);
    const toBot = await directory.findBot(request.toBotId, options);
    const fromBot = await directory.findBot(request.fromBotId, options);
    if (!toBot || !fromBot) {
      await work.changeRequest(request.id, { status: "failed", nextStep: null, leaseUntil: null }, options);
      return;
    }
    const person = await personName(request.userId, options);
    const target = request.nextStep === "target_turn";
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
    const row = target
      ? await rowOf(request.toBotId, request.toConversationId, options)
      : await rowOf(request.fromBotId, request.fromConversationId, options);
    if (!row) {
      await work.changeRequest(request.id, { status: "failed", nextStep: null, leaseUntil: null }, options);
      return;
    }
    // One turn at a time in a conversation: if the person's own reply is running, try shortly.
    if (!(await claimReply(row))) {
      await work.changeRequest(request.id, { leaseUntil: null, runAfter: work.secondsFromNow(limits.retryMs / 1000) }, options);
      return;
    }
    const keep = setInterval(() => {
      work.extendLease(request.id, limits.leaseSeconds, options).catch(() => {});
      runs.heartbeat(row.conversation_id).catch((error) => console.warn("A run's heartbeat failed; the next one renews it.", error));
    }, runs.limits.heartbeatMs);
    try {
      await tell(row, { type: "working", working: true }, options);
      if (target) {
        const working = await change(request, { status: "working", turns: request.turns + 1, reply: null }, { status: "working" }, options);
        const prompt = targetPrompt({ ...working, reply: request.reply }, { asker: fromBot.name, person });
        const appended = await meter.track({ userId: request.userId, botId: String(request.toBotId) }, () =>
          respond(row, {
            timeZone: request.timeZone,
            language: request.language,
            prompt,
            requestTurn: { working, viaBot: true },
            call: options
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
        await meter.track({ userId: request.userId, botId: String(request.fromBotId) }, () =>
          respond(row, {
            timeZone: request.timeZone,
            language: request.language,
            prompt: askerPrompt(request, { target: toBot.name, person }),
            requestTurn: { asking: request, working: parent, viaBot: true },
            call: options
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
      await runs.release(row.conversation_id).catch((error) => console.warn("Releasing a conversation's run failed; its lease runs out instead.", error));
      await tell(row, { type: "messages" }, options);
      await tell(row, { type: "working", working: false }, options);
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
