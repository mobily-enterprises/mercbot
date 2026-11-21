import { appFor } from "@local/files/office-apps";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";

const ID = /^\d+$/u;

/**
 * Routes for the bots' computers, one per bot in each chat (D14): /bots/:botId/computer…?chat=<chatId> is that bot's
 * computer in that chat, for anyone who can open the chat; a chat they can't open, or a bot not in it, is a 404.
 * Any server can answer them; computers.js finds the server running the computer (D-15).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Computer} capabilities.computer
 * @param {import("@local/files/server/types").Files} capabilities.files
 * @param {{ directory: object, chats: object }} capabilities.records mercbot.bots.records: the bots and chats the caller
 *   may read
 * @param {Set<import("node:http").ServerResponse>} capabilities.streams The live streams open, which
 *   close first when this server shuts down.
 * @param {import("@local/account/server/types").Meter} capabilities.meter for whether the home is paused (D-73)
 */
export function registerRoutes(http, { computer, files, records, streams, meter }) {
  const router = http.router;
  const { directory, chats } = records;
  // Routes for things a home owns (D-36) live under /api/w/:workspaceSlug/…; JSKIT checks the
  // person belongs to that home and fills request.workspace before the handler runs.
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
  const base = "/api/w/:workspaceSlug/bots/:botId";

  /** The bot in the address, of the request's home, or null. */
  function botOf(request, options) {
    return ID.test(String(request.params.botId)) ? directory.findBot(String(request.params.botId), options) : null;
  }

  /**
   * The computer a request is about: the bot in the address, in the chat the query names (?chat=), as the caller may
   * read it (records.directory.computerOf's ComputerPlace), or a 404 sent and null.
   */
  async function placeOf(request, reply) {
    const options = await request.callOptions();
    const chatId = String(request.query?.chat ?? "");
    const seat = ID.test(String(request.params.botId)) && ID.test(chatId)
      ? await directory.chatBotOf(String(request.params.botId), chatId, options)
      : null;
    const found = seat && await directory.computerOf(seat.id, options);
    if (found) return found;
    reply.code(404).send({ error: "That computer isn't here.", code: "computer_not_found" });
    return null;
  }

  async function computerOf(request, reply) {
    return (await placeOf(request, reply))?.chatBotId ?? null;
  }

  /** A refusal the computer answered (AppError) as the route's answer; anything else goes on. */
  async function answered(reply, work) {
    try {
      reply.send(await work());
    } catch (error) {
      if (!error?.statusCode || error.statusCode >= 500) throw error;
      reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
    }
  }

  /**
   * A paused home wakes no computer (D-73), nor does an archived bot (D-108), whose computers were put to sleep: the
   * answer says why. One already awake in a paused home stays as it is, for the work running on it.
   */
  async function refusedWhilePaused(request, reply, computerId) {
    const bot = await botOf(request, await request.callOptions());
    if (bot?.archivedAt) {
      reply.code(409).send({ error: `${bot.name} is archived. Unarchive it to use its computer.`, code: "bots_bot_archived", params: { name: bot.name } });
      return true;
    }
    const paused = await meter.pausedMessage(request.workspace.id);
    if (!paused || (await computer.status(computerId))?.state === "awake") return false;
    reply.code(402).send({ error: paused, code: "work_paused" });
    return true;
  }

  router.register("GET", `${base}/computer`, home, async function computerStatus(request, reply) {
    const computerId = await computerOf(request, reply);
    if (computerId) reply.send(await computer.status(computerId));
  });

  router.register("POST", `${base}/computer/wake`, home, async function wakeComputer(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId || (await refusedWhilePaused(request, reply, computerId))) return;
    computer.wake(computerId).catch((error) => console.warn("Waking a computer failed; its screen shows it asleep.", error));
    reply.send(await computer.status(computerId));
  });

  // A one-time ticket for the VNC socket (D-13); the computer must be awake.
  router.register("POST", `${base}/computer/ticket`, home, async function screenTicket(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId) return;
    if ((await computer.status(computerId)).state !== "awake") {
      reply.code(409).send({ error: "The computer is asleep." });
      return;
    }
    reply.send({ ticket: await computer.issueTicket(computerId) });
  });

  // One of the computer's files opened in its app on the bot's desktop (D-23), for the person to
  // work on in the live view.
  router.register("POST", `${base}/computer/open`, home, async function openFile(request, reply) {
    const found = await placeOf(request, reply);
    const computerId = found?.chatBotId;
    if (!computerId || (await refusedWhilePaused(request, reply, computerId))) return;
    const virtualPath = String(request.body?.path || "");
    try {
      // The file is one of the computer's chat's folders (R6).
      const place = files.store.placeFor({ homeId: found.workspaceId, chatId: found.chatId, chatKind: found.chatKind, botId: found.botId });
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

  // Taking over the computer and handing it back (D16): anyone who can open the chat. Each posts its line in the chat
  // and answers it with who has control now: { messages, control }.
  router.register("POST", `${base}/computer/take-over`, home, async function takeOver(request, reply) {
    const computerId = await computerOf(request, reply);
    if (!computerId || (await refusedWhilePaused(request, reply, computerId))) return;
    await answered(reply, async () => computer.takeOver(computerId, await request.callOptions()));
  });
  router.register("POST", `${base}/computer/hand-back`, home, async function handBack(request, reply) {
    const computerId = await computerOf(request, reply);
    if (computerId) await answered(reply, async () => computer.handBack(computerId, await request.callOptions()));
  });

  // One computer starts afresh, its saved browser and sign-ins gone, which everyone who can open its chat uses: so only
  // by the person who started the chat (a direct chat's person) or the home's owners and admins, as they manage it.
  router.register("POST", `${base}/computer/reset`, home, async function resetComputer(request, reply) {
    const found = await placeOf(request, reply);
    const computerId = found?.chatBotId;
    if (!computerId) return;
    const chat = await chats.get(found.chatId, await request.callOptions());
    const starter = chat.direct_user_id ?? chat.made_by;
    if (!(starter != null && String(starter) === String(request.user.id)) && !hasPermission(request.permissions, "workspace.settings.update")) {
      reply.code(403).send({
        error: "Only the person who started this chat and the home's owners and admins can reset its computers.",
        code: "computer_reset_forbidden"
      });
      return;
    }
    await computer.reset(computerId);
    reply.send(await computer.status(computerId));
  });

  // Settings → Reset: the computers of the chats the person is alone in start fresh; a chat with other people keeps
  // its computers, which are theirs too (D14). Three reads, however many chats.
  router.register("POST", "/api/w/:workspaceSlug/computers/reset", home, async function resetComputers(request, reply) {
    const options = await request.callOptions();
    const ids = (await chats.ofPerson(options, { hidden: true })).map((chat) => String(chat.id));
    const people = await chats.peopleOf(ids, options);
    const alone = ids.filter((id) => (people.get(id) ?? []).every((person) => String(person.user_id) === String(request.user.id)));
    const own = [...(await chats.botsOf(alone, options)).values()].flat().map((seat) => String(seat.chat_bot_id));
    const results = await Promise.allSettled(own.map((id) => computer.reset(String(id))));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) {
      reply.code(502).send({ error: `${failed} of ${own.length} computers couldn't be reset. Try again.` });
      return;
    }
    reply.send({ reset: own.length });
  });

  // The computer's state and address as server-sent events; the screen itself is VNC.
  router.register("GET", `${base}/computer/stream`, home, async function streamComputer(request, reply) {
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

  router.register("GET", `${base}/screenshots/:name`, home, async function screenshotFile(request, reply) {
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
