import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { settledWithin } from "./backgroundWork.js";
import { BotsError } from "./botsError.js";
import { toMessage } from "./botRows.js";
import { CONNECT_WAITS } from "./cardTools.js";
import { RUN_LEASE, followUpCheckpoint, handOverRuns, keepLease } from "./runLease.js";

/** How long after the person starts signing in from a connect card the bot still carries on by itself. */
const CONNECT_WAIT_MINUTES = 30;
/** How long the server that marked a follow-up ready has to start it before a sweep may. */
const START_GRACE_SECONDS = 10;
/** How often every server sweeps, and how many follow-ups one sweep starts at most. */
const SWEEP_MS = 60000;
const SWEEP_BATCH = 20;

const closedCard = () => new BotsError(409, "That card isn't waiting for its app any more.", { code: "bots_connect_card_closed" });

/**
 * Connect follow-ups (D-77): once the person signs in to an app from a bot's connect card, the bot
 * finishes the task the card was for by itself, once, as a reply to the person's request in that chat. The card is the
 * person's it was made for (R4), and the follow-up runs as them, for the bot's seat in the chat (chat_bots.id).
 *
 * Pressing the card's button keeps a waiting row for it (records.followUps). The sign-in's callback, on whichever
 * server it lands, marks the rows its new connection reaches ready in the transaction that saves the connection
 * (`connected`), and that server starts them at once. Each start holds the chat for one reply and the row under a
 * 90-second lease on the database's clock, renewed as D-77's lost runs are, and a first start claims the card
 * ("connecting" → "connected"), so whichever server or release follows it up, it does so once. Only the run holding
 * the row posts its result, in the transaction that ends it. Every server sweeps once a minute for the rows whose
 * start or server was lost, reading only those, never the rows still waiting for a sign-in.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {ReturnType<typeof import("./chatSeats.js").createChatSeats>} dependencies.seats the bot's seat in a chat, and
 *   its background seat for the person who pressed the card
 * @param {import("./types.js").BotTurns} dependencies.turns
 * @param {import("./types.js").BotHistory} dependencies.chatHistory
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("./types.js").BackgroundWork} dependencies.background where starts and runs go, so a stopping server waits for them
 * @param {(seat: object, input: object, call: object, held: import("./types.js").RunCheckpoint) => Promise<unknown>} dependencies.runReply
 *   botReplies' reply run, with the follow-up's run held
 * @param {{ get: (chatId: string, options: object) => Promise<{ chat: object }> }} dependencies.chats chatMembers, for the chat's row
 * @param {typeof RUN_LEASE} [dependencies.lease]
 */
export function createConnectFollowUps({
  records,
  systemContext,
  seats,
  turns,
  chatHistory,
  meter,
  background,
  runReply,
  chats,
  lease = RUN_LEASE
}) {
  const followUps = records.followUps;
  const system = () => ({ context: systemContext("connect follow-up") });
  const timing = Object.freeze({ minutes: CONNECT_WAIT_MINUTES, graceSeconds: START_GRACE_SECONDS });
  /** @type {Map<Promise<void>, import("./types.js").RunningRun>} */
  const running = new Map();
  let stopped = false;

  /**
   * The person started signing in from a connect card in a chat (`POST …/connect-cards/:messageId`): the card shows it's
   * connecting and keeps a waiting row, in the person's time zone and language from the page. Pressing it again starts
   * the wait again. Only the person the card was made for presses it (403 for anyone else). An app the home already has
   * connected (in Connect apps, or a sign-in that finished as the card was pressed) is followed up at once.
   * @returns {Promise<{ messages: object[], chat: object }>}
   */
  async function connectFromCard(chatId, messageId, input = {}, options) {
    const card = await records.messages.messageIn(String(chatId), String(messageId), options, { kind: "connect" });
    const pluginId = card?.body.plugin?.id;
    if (!card || !CONNECT_WAITS.includes(card.body.status) || !pluginId) throw closedCard();
    const me = String(resolveActorId(options.context) ?? "");
    if (card.body.for && String(card.body.for.id) !== me) {
      const { name } = card.body.for;
      throw new BotsError(403, `This is waiting for ${name}'s OK.`, { code: "bots_waiting_for_other", params: { name } });
    }
    const seat = card.author_bot_id ? await seats.seatIn(String(chatId), card.author_bot_id, me, options) : null;
    if (!seat?.chat_bot_id) throw closedCard();
    const page = { timeZone: String(input.timeZone || "").slice(0, 64), language: String(input.language || "").slice(0, 35) };
    const body = { ...card.body, status: "connecting", connectingAt: new Date().toISOString(), page };
    const id = await records.messages.withTransaction(options, async (txOptions) => {
      const fields = { messageId: card.id, chatBotId: seat.chat_bot_id, userId: me, pluginId };
      const waiting = await followUps.wait(fields, txOptions);
      // Only while the card still waits: one a follow-up claimed meanwhile is connected, and keeps its row.
      if (!(await records.messages.claimBody(card.id, card.body.status, body, txOptions))) throw closedCard();
      return waiting;
    });
    // Read once the row is saved: a sign-in that commits after this read marks the row itself.
    if ((await turns.hasConnected(seat, pluginId, options)) && (await followUps.markOneReady(id, START_GRACE_SECONDS, system()))) {
      background.add(start(id));
    }
    await seats.tell(seat.chat_id, { type: "messages" }, options);
    return { messages: [toMessage({ ...card, body })], chat: (await chats.get(seat.chat_id, options)).chat };
  }

  /**
   * An account was connected (integrations' whenConnected): the waiting follow-ups it reaches are marked ready in the
   * transaction that saves it. Answers what this server does once that has committed: mark any row that began waiting
   * while it ran (a card pressed at that very moment), and start them all.
   * @param {{ pluginId: string, userId: string, homeId: string }} connection
   * @param {object} txOptions the transaction that saves the connection
   */
  async function connected(connection, txOptions) {
    const marked = await followUps.markReady(connection, timing, { ...passedOn(txOptions), ...system() });
    return async () => {
      const late = await followUps.markReady(connection, timing, system());
      for (const id of new Set([...marked, ...late])) background.add(start(id));
    };
  }

  /**
   * Starts a ready follow-up on this server, unless another server holds it. One whose seat, chat or bot is gone or
   * archived, or whose person can no longer open the chat, is closed for good. One whose app isn't connected after all
   * waits for the next sign-in. One whose chat is busy starts when that chat's reply ends, or the next sweep; one
   * still not started 30 minutes after its sign-in began is closed, as its card would be.
   * @param {string} id
   */
  async function start(id) {
    if (stopped) return;
    try {
      await startOne(id);
    } catch (error) {
      console.warn(`Starting connect follow-up ${id} failed; a sweep tries again: ${error?.message || error}`);
    }
  }

  async function startOne(id) {
    const followUp = await followUps.startable(id, system());
    if (!followUp) return;
    const found = await seats.backgroundSeat(
      { chatBotId: followUp.chatBotId, homeId: followUp.workspaceId, userId: followUp.userId },
      "connect follow-up"
    );
    if (!found) {
      await followUps.close(id, system());
      return;
    }
    const { seat, call } = found;
    if (!followUp.runId && !(await turns.hasConnected(seat, followUp.pluginId, call))) {
      await followUps.waitAgain(id, system());
      return;
    }
    if (!(await chatHistory.claimReply(seat))) {
      if (!(await followUps.closeIfOlder(id, CONNECT_WAIT_MINUTES, system()))) await followUps.defer(id, SWEEP_MS / 1000, system());
      return;
    }
    let held = null;
    try {
      held = await followUps.withTransaction(call, async (txOptions) => {
        const run = await followUps.hold(id, lease.seconds, txOptions);
        if (!run) return null;
        const card = await records.messages.messageById(run.messageId, txOptions);
        // A first run claims its card, so it carries on once whichever server or release follows it up; a card already
        // settled (the release before this one followed it up) closes it.
        const claimed = !run.first || (card?.body.status === "connecting" &&
          (await records.messages.claimBody(card.id, "connecting", { ...card.body, status: "connected" }, txOptions)));
        if (claimed) return { run, card };
        await followUps.end(run, txOptions);
        return null;
      });
    } finally {
      if (!held) await chatHistory.runs.release(seat.chat_bot_id);
    }
    if (!held) return;
    if (held.run.first) await seats.tell(seat.chat_id, { type: "messages" }, call);
    carryOn(seat, call, held.run, held.card);
  }

  /**
   * The bot carries on, as a reply to the person, under the follow-up's lease: renewed every 20 seconds, it stops the run
   * at its next step once this server can't be sure it holds it (runLease.js keepLease), and a server stopping hands it
   * over (drain).
   */
  function carryOn(seat, call, run, card) {
    const held = keepLease(() => followUps.renew(run, lease.seconds, system()), `Connect follow-up ${run.id}`, lease);
    const checkpoint = followUpCheckpoint(followUps, run, call, held.signal);
    const input = { ...card.body.page, connected: { app: card.body.app, task: card.body.task } };
    const job = Promise.resolve()
      .then(() => meter.track({ userId: seat.user_id, botId: seat.id, workspaceId: seat.workspace_id }, () => runReply(seat, input, call, checkpoint)))
      .catch((error) => console.warn(`Connect follow-up ${run.id} failed: ${error?.message || error}`))
      .finally(() => {
        held.stop();
        running.delete(job);
      });
    // Handed over as this server stops, once the run has stopped here: the chat it held is freed first, so the server
    // that takes the follow-up over can reply in it at once.
    const release = async () => {
      await chatHistory.runs.release(seat.chat_bot_id);
      await followUps.handOver(run, system());
    };
    running.set(job, { lease: held, release });
    background.add(job);
  }

  /** A bot's reply in a chat ended: a follow-up of that seat that is ready starts now. */
  async function afterTurn(chatBotId) {
    if (stopped) return;
    const id = await followUps.startableIn(chatBotId, system());
    if (id) await start(id);
  }

  /**
   * One sweep: rows whose sign-in never finished go after 30 minutes (as do ready ones no server could start or carry on
   * for that long), and up to SWEEP_BATCH rows whose start is overdue (the server that marked them stopped, or their
   * chat was busy) or whose run's lease lapsed (its server stopped) are started, the most overdue first. The same few
   * statements when there is nothing to start, however many rows wait.
   */
  async function sweep() {
    await followUps.prune(CONNECT_WAIT_MINUTES, system());
    for (const id of await followUps.due(SWEEP_BATCH, system())) {
      if (stopped) return;
      await start(id);
    }
  }

  /**
   * Sweeps every `everyMs` until drained. Draining starts nothing more, gives follow-ups in progress up to `ms`, then
   * hands the rest over (handOverRuns): the server that takes one over posts its result instead of this one.
   * @param {{ everyMs?: number }} [options]
   */
  function startSweeping({ everyMs = SWEEP_MS } = {}) {
    let sweeping = null;
    const tick = () => {
      if (stopped || sweeping) return;
      sweeping = sweep()
        .catch((error) => console.warn(`Sweeping the connect follow-ups failed; the next sweep tries again: ${error?.message || error}`))
        .finally(() => {
          sweeping = null;
        });
    };
    const timer = setInterval(tick, everyMs);
    timer.unref();
    tick();
    return Object.freeze({
      async drain(ms) {
        stopped = true;
        clearInterval(timer);
        await settledWithin(Promise.allSettled([sweeping, ...running.keys()]), ms);
        await handOverRuns(running);
      }
    });
  }

  return Object.freeze({
    connectFromCard,
    connected,
    start,
    afterTurn,
    sweep,
    startSweeping
  });
}
