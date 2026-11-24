import { startResumer as startRunResumer } from "@jskit-ai/agent-runtime/server";
import { HAND_OVER_MS, RunTakenOver, handOverRuns, keepLease, tellHandedOver } from "./runLease.js";

/** What a stopping server says once it has handed its person's replies over, and every server's resumer listens to. */
export const REPLIES_HANDED_OVER = "replies";

/**
 * Replies a stopped server left part-way (D-48, D-19): any server finds them by their stale heartbeat, takes one over
 * through the database and carries it on from its saved steps, with no page needed, for the person it worked for.
 * Only a person's own replies; goal rounds carry on through their own lease.
 */
const resumable = (query) => query.whereRaw("(input->>'human')::boolean");

/**
 * The person's replies as servers carry them on (botReplies.js): each runs among those its server keeps, so a stop
 * hands it over at once (handOverReplies), and the replies a stopped server left are taken over and carried on by any
 * server, at each scan and as soon as a stopping server says so.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {import("./types.js").BotHistory} dependencies.chatHistory
 * @param {import("./types.js").BackgroundWork} dependencies.background
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {import("@local/notices/server/types").Notices} dependencies.notices how a stopping server's handed-over
 *   replies are told to the other servers, and heard
 * @param {(seat: object) => object} dependencies.meteredAs who pays for a seat's turn
 * @param {Function} dependencies.replyOnRun botReplies' reply on its claimed run, with how a stop reaches it
 */
export function createReplyHandover({ records, systemContext, seats, chatHistory, background, meter, notices, meteredAs, replyOnRun }) {
  /**
   * The person's replies running here (runReply), each with how its server's stop hands it over (handOverReplies).
   * @type {Map<Promise<unknown>, import("./types.js").RunningRun>}
   */
  const replying = new Map();
  /** This server's reply resumers (startResumer), stopped first when it hands its replies over. */
  const resumers = new Set();
  // Set once this server is stopping: it takes up no more replies, and one that starts now is handed over at once.
  let stopping = false;

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
      if (!stopping) resumeStalled().catch((error) => console.error(`Resuming replies handed over: ${error?.message || error}`));
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
    stopping = true;
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

  /** Whether this server is stopping (handOverReplies), so a reply that ends starts nothing more here. */
  function handingOver() {
    return stopping;
  }

  /**
   * A person's reply's hold on its run, from just after its claim (replyOnRun), kept as a routine's lease is (keepLease,
   * D-59): once this server can't be sure it still holds it (another server took it over after this one stalled past
   * the staleness, or no heartbeat went through for most of it), or this server stops, the reply stops at its next
   * step, and what it would keep, post or free is refused, so it posts and frees nothing and only the server holding
   * the run answers. `replyRun` is what replyTurn keeps and posts through.
   * @param {object} seat
   * @param {import("./types.js").RunCheckpoint | null} held
   * @param {{ stopped?: boolean, keep?: object, own?: object }} handing how its server's stop reaches it (runReply)
   */
  async function holdRun(seat, held, handing) {
    const what = `Bot ${seat.id}'s reply in chat ${seat.chat_id}`;
    const own = await chatHistory.runs.hold(seat.chat_bot_id);
    const lease = keepLease(own.beat, what, {
      seconds: Number(chatHistory.runs.limits.staleSeconds),
      heartbeatMs: Number(chatHistory.runs.limits.heartbeatMs)
    });
    Object.assign(handing, { keep: lease, own });
    if (handing.stopped || stopping) lease.handOver();
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
    return { own, lease, replyRun };
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

  return Object.freeze({
    holdRun,
    runReply,
    resumeStalled,
    startResumer,
    handOverReplies,
    handingOver
  });
}
