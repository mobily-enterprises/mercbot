import { appFor } from "@local/files/office-apps";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";

const ID = /^\d+$/u;

/**
 * Routes for the bot's computer. Every route checks that the bot belongs to the person.
 * Any server can answer them; computers.js finds the server running the computer (D-15).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Computer} capabilities.computer
 * @param {import("@local/files/server/types").Files} capabilities.files
 * @param {object} capabilities.directory records.directory: the bots and conversations the request's home holds
 * @param {Set<import("node:http").ServerResponse>} capabilities.streams The live streams open, which
 *   close first when this server shuts down.
 * @param {import("@local/account/server/types").Meter} capabilities.meter for whether the home is paused (D-73)
 */
export function registerRoutes(http, { computer, files, directory, streams, meter }) {
  const router = http.router;
  // Routes for things a home owns (D-36) live under /api/w/:workspaceSlug/…; JSKIT checks the
  // person belongs to that home and fills request.workspace before the handler runs.
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });

  /**
   * The computer a request is about (D-36): the person's own with the bot in the address, or
   * for a shared bot the conversation asked for, else the tab the person has open, else the first.
   */
  /** The bot in the address, of the request's home and a bot (not a group chat), or null. */
  function botOf(request, options) {
    return ID.test(String(request.params.botId)) ? directory.findBot(String(request.params.botId), options, { kind: "bot" }) : null;
  }

  async function computerOf(request, reply) {
    const options = await request.callOptions();
    const bot = await botOf(request, options);
    // A member bot's own computer for a group (?group=), for the group's people only (D-46).
    if (bot && request.query?.group) {
      const seat = ID.test(String(request.query.group)) ? await directory.groupSeat(bot.id, String(request.query.group), options) : null;
      if (!seat) {
        reply.code(404).send({ error: "Bot not found." });
        return null;
      }
      return String(seat.id);
    }
    const seat = bot && await directory.seatOf(bot.id, options);
    let found = seat;
    if (bot?.sharing === "shared") {
      const room = (id) => (id != null && ID.test(String(id)) ? directory.roomOf(bot.id, id, options) : null);
      found = (await room(request.query?.room)) || (await room(seat?.roomId)) || (await directory.roomOf(bot.id, null, options));
    }
    if (!found) {
      reply.code(404).send({ error: "Bot not found." });
      return null;
    }
    return String(found.id);
  }

  /**
   * A paused home wakes no computer (D-73): the answer says why. One already awake stays
   * as it is, for the work running on it.
   */
  async function refusedWhilePaused(request, reply, computerId) {
    const paused = await meter.pausedMessage(request.workspace.id);
    if (!paused || (await computer.status(computerId))?.state === "awake") return false;
    reply.code(402).send({ error: paused, code: "work_paused" });
    return true;
  }

  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/computer", home, async function computerStatus(request, reply) {
    const computerId = await computerOf(request, reply);
    if (computerId) reply.send(await computer.status(computerId));
  });

  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/computer/wake", home, async function wakeComputer(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId || (await refusedWhilePaused(request, reply, computerId))) return;
    computer.wake(computerId).catch((error) => console.warn("Waking a computer failed; its screen shows it asleep.", error));
    reply.send(await computer.status(computerId));
  });

  // A one-time ticket for the VNC socket (D-13); the computer must be awake.
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/computer/ticket", home, async function screenTicket(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId) return;
    if ((await computer.status(computerId)).state !== "awake") {
      reply.code(409).send({ error: "The computer is asleep." });
      return;
    }
    reply.send({ ticket: await computer.issueTicket(computerId) });
  });

  // One of the bot's files opened in its app on the bot's desktop (D-23), for the person to
  // work on in the live view.
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/computer/open", home, async function openFile(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId || (await refusedWhilePaused(request, reply, computerId))) return;
    const virtualPath = String(request.body?.path || "");
    try {
      const bot = await botOf(request, await request.callOptions());
      const place = files.store.placeFor({ id: bot.id, workspace_id: request.workspace.id, sharing: bot.sharing }, request.user.id);
      await files.store.existingFile(place, virtualPath);
    } catch (error) {
      reply.code(error.statusCode || 400).send({ error: error.message, code: error.code, params: error.params });
      return;
    }
    if (!appFor(virtualPath)) {
      reply.code(415).send({ error: "There's no app on the computer for this kind of file." });
      return;
    }
    try {
      reply.send(await computer.open(computerId, virtualPath));
    } catch (error) {
      reply.code(503).send({ error: error.message });
    }
  });

  // Settings → Reset: the person's own computers with every bot in the home start
  // fresh; shared conversations' computers are everyone's and stay.
  router.register("POST", "/api/w/:workspaceSlug/computers/reset", home, async function resetComputers(request, reply) {
    const own = await directory.ownSingleBotSeatIds(await request.callOptions());
    const results = await Promise.allSettled(own.map((id) => computer.reset(String(id))));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) {
      reply.code(502).send({ error: `${failed} of ${own.length} computers couldn't be reset. Try again.` });
      return;
    }
    reply.send({ reset: own.length });
  });

  // The computer's state and address as server-sent events; the screen itself is VNC.
  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/computer/stream", home, async function streamComputer(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    const send = (event, data) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = computer.subscribe(computerId, send);
    const keepAlive = setInterval(() => reply.raw.write(": keep-alive\n\n"), 20000);
    streams.add(reply.raw);
    const stop = () => {
      clearInterval(keepAlive);
      unsubscribe();
      streams.delete(reply.raw);
    };
    // A page that went while the request was checked has already closed, so the stream stops at once.
    if (request.raw.destroyed) stop();
    else request.raw.on("close", stop);
  });

  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/screenshots/:name", home, async function screenshotFile(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId) return;
    const data = await computer.screenshotData(computerId, request.params.name);
    if (!data) {
      reply.code(404).send({ error: "Screenshot not found." });
      return;
    }
    reply.header("content-type", "image/jpeg").header("cache-control", "private, max-age=86400").send(data);
  });

  // Another Mercbot server passing work to the computer this one runs (D-15). It's signed with
  // the shared secret instead of a person's session.
  router.register("POST", "/api/internal/computer", { auth: "public", csrfProtection: false }, async function passedWork(request, reply) {
    try {
      reply.send({ result: (await computer.answer(request.headers, request.body)) ?? null });
    } catch (error) {
      reply.code(error.statusCode || 500).send({ error: error.message });
    }
  });
}
