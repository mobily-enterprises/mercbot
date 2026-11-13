import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { refusalOf } from "@local/account/meter";
import { BotsError } from "./botsError.js";
import { isModelFailure, modelFailure } from "./modelFailures.js";

/**
 * A model call that failed while a route worked, as the route answers it: our own refusal, never the provider's
 * status (401 for a refused key, 429 for its limit, 5xx), which the page would read as its own. That status and
 * the error's message go to the log in one line, without the error, which carries the request.
 * @param {{ method: string, url: string, routeOptions?: { url?: string } }} request
 * @param {unknown} error
 */
function modelRefusal(request, error) {
  console.warn(`${request.method} ${request.routeOptions?.url || request.url}: ${modelFailure(error)}`);
  return new BotsError(502, "The AI provider couldn't answer just now. Try again in a moment.", { code: "bots_model_failed" });
}

/**
 * New AI work refused in a paused home (D-73), saying why: before it starts, or when it's refused (meter.js refuseWork)
 * part-way, the same answer.
 * @param {string} text
 */
const pausedRefusal = (text) => new BotsError(402, text, { code: "work_paused" });

/**
 * The person and the home a request is for (D-36): JSKIT has already checked the person belongs
 * to the home in the address.
 */
function userOf(request) {
  return {
    id: request.user?.id,
    homeId: request.workspace?.id,
    displayName: request.user?.displayName || request.user?.display_name || request.user?.username
  };
}

/**
 * The bots' routes (D-36). Everything belongs to a home: routes live under
 * /api/w/:workspaceSlug/…, and JSKIT checks membership and fills request.workspace first.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Bots} capabilities.bots
 * @param {import("./types.js").Approvals} capabilities.approvals
 * @param {import("@local/notices/server/types").Notices} capabilities.notices
 * @param {import("@local/account/server/types").Meter} capabilities.meter
 * @param {import("./types.js").BotRecords} capabilities.records mercbot.bots.records, for the bot in the address
 * @param {Set<import("node:http").ServerResponse>} capabilities.streams the live event streams, ended on shutdown
 */
export function registerRoutes(http, { bots, approvals, notices, meter, records, streams }) {
  /**
   * A bot or group in the address must be one the person sees in that same home, whatever its id:
   * one check for every route, so a member of one home can't reach another home's bots by their
   * numbers, nor a group chat they aren't in.
   */
  async function guard(request, options) {
    const { botId, groupId } = request.params || {};
    const id = String(botId || groupId || "");
    if (!id) return;
    if (/^[1-9]\d{0,18}$/u.test(id) && (await records.directory.findBot(id, options))) return;
    if (botId) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    throw new BotsError(404, "Group not found.", { code: "bots_group_not_found" });
  }

  /** A route's work, given the request, its person and home, and the call options its reads and writes use. */
  function handle(work) {
    return async function (request, reply) {
      try {
        const user = userOf(request);
        const options = await request.callOptions();
        await guard(request, options);
        // AI calls made for this request are recorded for its person, bot and home (D-73).
        const who = { userId: user.id, botId: request.params?.botId, workspaceId: request.workspace?.id };
        reply.code(200).send(await meter.track(who, () => work(request, user, options)));
      } catch (thrown) {
        // A refusal can come wrapped as a model call's failure, so it's looked for first.
        let error = thrown;
        const refusal = refusalOf(thrown);
        if (refusal) error = pausedRefusal(refusal.notice);
        else if (isModelFailure(thrown)) error = modelRefusal(request, thrown);
        if (error instanceof BotsError || Number.isInteger(error?.statusCode)) {
          reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
          return;
        }
        throw error;
      }
    };
  }

  /** New AI work in a paused home is refused, saying why (D-73). */
  async function unlessPaused(request) {
    const paused = await meter.pausedMessage(request.workspace.id);
    if (paused) throw pausedRefusal(paused);
  }

  const router = http.router;
  // Everything here belongs to a home (D-36): routes live under /api/w/:workspaceSlug/…, and
  // JSKIT checks membership and fills request.workspace first.
  const auth = { auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") };
  /** Owners and admins of the home in the address may change what's shared there (D-36). */
  const manages = (request) => hasPermission(request.permissions, "workspace.settings.update");

  router.register("GET", "/api/w/:workspaceSlug/bots", auth, handle(async (_request, _user, options) => bots.listBots(options)));
  // One bot as the list shows it, read again when it has news (D-15).
  router.register("GET", "/api/w/:workspaceSlug/bots/:botId", auth, handle(async (request, _user, options) => ({
    bot: await bots.listedBot(request.params.botId, options)
  })));
  // What the person's bots remember about them, to see and remove.
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/secure-forms/:messageId", auth, handle(async (request, _user, options) =>
    bots.settleSecureForm(request.params.botId, request.params.messageId, request.body || {}, options)));
  router.register(
    "GET",
    "/api/w/:workspaceSlug/bots/:botId/library",
    auth,
    handle(async (request, _user, options) => bots.library(request.params.botId, options))
  );
  router.register(
    "POST",
    "/api/w/:workspaceSlug/bots/:botId/library/pin",
    auth,
    handle(async (request, _user, options) => bots.pinItem(request.params.botId, request.body || {}, options))
  );
  // A page deleted from the Library, after the person confirmed: the Library again, and the page's cards.
  router.register(
    "DELETE",
    "/api/w/:workspaceSlug/bots/:botId/library/pages/:messageId",
    auth,
    handle(async (request, _user, options) => bots.deletePage(request.params.botId, request.params.messageId, options))
  );
  // The person started signing in from a connect card: the bot finishes the task once it's connected.
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/connect-cards/:messageId", auth, handle(async (request, _user, options) =>
    bots.connectFromCard(request.params.botId, request.params.messageId, request.body || {}, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/drafts/:messageId", auth, handle(async (request, _user, options) =>
    bots.settleDraft(request.params.botId, request.params.messageId, request.body || {}, options)));
  router.register("GET", "/api/w/:workspaceSlug/memories", auth, handle(async (_request, _user, options) => bots.memories(options)));
  router.register(
    "DELETE",
    "/api/w/:workspaceSlug/memories/:memoryId",
    auth,
    handle(async (request, _user, options) => bots.forgetMemory(request.params.memoryId, options))
  );
  router.register("GET", "/api/w/:workspaceSlug/bot-skills", auth, handle(async (_request, _user, options) => bots.skillsFor(options)));
  router.register(
    "GET",
    "/api/w/:workspaceSlug/search",
    auth,
    handle(async (request, _user, options) => bots.search(request.query?.q, options))
  );
  // What changed for this person's bots, as server-sent events from any server (D-15).
  router.register("GET", "/api/w/:workspaceSlug/bot-events", auth, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    reply.raw.write(": connected\n\n");
    const unsubscribe = notices.subscribe("bots", request.user.id, ({ type, ...data }) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
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
  router.register("POST", "/api/w/:workspaceSlug/bots", auth, handle(async (request, _user, options) => ({
    bot: await bots.createBot(request.body || {}, options)
  })));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/choices/:messageId", auth, handle(async (request, _user, options) =>
    bots.answerChoice(request.params.botId, request.params.messageId, request.body?.selected, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/handover/:messageId", auth, handle(async (request, _user, options) =>
    bots.settleHandover(request.params.botId, request.params.messageId, request.body?.outcome, options)));
  /** Bot templates: the gallery and a template's page are public; adding one is the person's. */
  const open = (work) => async (request, reply) => {
    try {
      reply.code(200).send(await work(request));
    } catch (error) {
      if (!(error instanceof BotsError)) throw error;
      reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
    }
  };
  router.register("GET", "/api/templates", { auth: "public" }, open(() => bots.templateGallery()));
  // A template's page reads with the request's own options: a visitor's name no one.
  router.register("GET", "/api/templates/:slug", { auth: "public" }, open(async (request) =>
    bots.templateDetails(request.params.slug, await request.callOptions())));
  router.register("POST", "/api/w/:workspaceSlug/bots/from-template", auth, handle(async (request, user, options) => ({
    bot: await bots.addFromTemplate(String(request.body?.slug || ""), user.displayName, options)
  })));
  // Group chats: created by their first message; members added and removed in Details.
  router.register("POST", "/api/w/:workspaceSlug/groups", auth, handle(async (request, user, options) =>
    bots.createGroup(request.body || {}, user.displayName, options)));
  router.register("POST", "/api/w/:workspaceSlug/groups/:groupId/members", auth, handle(async (request, _user, options) =>
    bots.addMember(request.params.groupId, request.body?.botId, options)));
  router.register("DELETE", "/api/w/:workspaceSlug/groups/:groupId/members/:botId", auth, handle(async (request, _user, options) =>
    bots.removeMember(request.params.groupId, request.params.botId, options)));
  // People in a group (D-46): anyone in it adds; its maker, owners and admins remove; anyone leaves.
  router.register("POST", "/api/w/:workspaceSlug/groups/:groupId/people", auth, handle(async (request, _user, options) =>
    bots.addPerson(request.params.groupId, String(request.body?.userId || ""), options)));
  router.register("DELETE", "/api/w/:workspaceSlug/groups/:groupId/people/:userId", auth, handle(async (request, _user, options) =>
    bots.removePerson(request.params.groupId, request.params.userId, { manages: manages(request) }, options)));
  router.register(
    "POST",
    "/api/w/:workspaceSlug/bots/first",
    auth,
    handle(async (_request, _user, options) => ({ bot: await bots.ensureFirstBot(options) }))
  );
  // A chat's newest messages; with `before` (a message id) the page before it, as the person scrolls
  // back; with `since` (an earlier answer's cursor) only what changed after it (D-15).
  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/messages", auth, handle(async (request, _user, options) =>
    bots.messages(request.params.botId, request.query?.room || null, {
      since: request.query?.since,
      before: request.query?.before
    }, options)));
  // Find in chat in the part of a chat the page hasn't read: how often the words appear before `before`.
  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/find", auth, handle(async (request, _user, options) =>
    bots.findOlder(request.params.botId, request.query?.room || null, {
      q: request.query?.q,
      before: request.query?.before
    }, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/messages", auth, handle(async (request, _user, options) =>
    bots.sendMessage(request.params.botId, request.body || {}, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/reply", auth, handle(async (request, user, options) =>
    bots.replyTo(request.params.botId, request.body || {}, user.displayName, options)));
  // The status line is an AI call of its own: a paused home's reply says why instead.
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/messages/:messageId/activity", auth, handle(async (request, _user, options) =>
    (await meter.pausedMessage(request.workspace.id)) ? { status: "", messages: [] } : bots.describeWork(request.params.botId, request.params.messageId, options)));
  router.register("PUT", "/api/w/:workspaceSlug/bots/:botId/messages/:messageId/reaction", auth, handle(async (request, _user, options) =>
    bots.react(request.params.botId, request.params.messageId, request.body?.emoji, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/onboarding/advance", auth, handle(async (request, user, options) =>
    bots.advanceOnboarding(request.params.botId, String(request.body?.step || ""), user, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/onboarding/name", auth, handle(async (request, _user, options) =>
    bots.chooseName(request.params.botId, String(request.body?.name || ""), options)));

  // A request between bots is cancelled by the person it's for (D-46).
  router.register("POST", "/api/w/:workspaceSlug/bot-requests/:requestId/cancel", auth, handle(async (request, _user, options) =>
    bots.cancelRequest(request.params.requestId, options)));
  router.register("PATCH", "/api/w/:workspaceSlug/bots/:botId", auth, handle(async (request, _user, options) => {
    // Who sees what in a bot is for the home's owners and admins (D-36).
    if (request.body?.sharing !== undefined && !manages(request)) {
      throw new BotsError(403, "Only the home's owners and admins can change who sees what.", { code: "bots_visibility_manage_forbidden" });
    }
    if (request.body?.main !== undefined && !manages(request)) {
      throw new BotsError(403, "Only the home's owners and admins can replace the main bot.", { code: "bots_main_bot_manage_forbidden" });
    }
    return { bot: await bots.updateBot(request.params.botId, request.body || {}, options) };
  }));
  // A mixed bot's home notebook (D-36): everyone reads it, a page at a time (?after= the page before's
  // next); a note's author, owners and admins remove notes.
  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/notebook", auth, handle(async (request, _user, options) =>
    bots.notebook(request.params.botId, { manages: manages(request), after: request.query?.after || null }, options)));
  router.register("DELETE", "/api/w/:workspaceSlug/bots/:botId/notebook/:noteId", auth, handle(async (request, _user, options) =>
    bots.removeNote(request.params.botId, request.params.noteId, { manages: manages(request) }, options)));
  // A shared bot's conversations, each a named tab (D-36).
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/rooms", auth, handle(async (request, _user, options) =>
    bots.createRoom(request.params.botId, request.body || {}, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/rooms/app", auth, handle(async (request, _user, options) =>
    bots.roomForApp(request.params.botId, request.body || {}, options)));
  router.register("PATCH", "/api/w/:workspaceSlug/bots/:botId/rooms/:roomId", auth, handle(async (request, _user, options) =>
    bots.renameRoom(request.params.botId, request.params.roomId, request.body || {}, options)));
  router.register("DELETE", "/api/w/:workspaceSlug/bots/:botId", auth, handle(async (request, _user, options) =>
    bots.deleteBot(request.params.botId, options)));
  router.register("GET", "/api/w/:workspaceSlug/bots/:botId/routines", auth, handle(async (request, _user, options) => ({
    routines: await bots.routines(request.params.botId, options)
  })));
  router.register("PATCH", "/api/w/:workspaceSlug/bots/:botId/routines/:routineId", auth, handle(async (request, _user, options) => ({
    routine: await bots.setRoutineEnabled(request.params.botId, request.params.routineId, request.body?.enabled, options)
  })));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/voice-call", auth, handle(async (request, _user, options) =>
    bots.recordVoiceCall(request.params.botId, request.body?.seconds, options)));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/teach/start", auth, handle(async (request, _user, options) => {
    await unlessPaused(request);
    return bots.startTeaching(request.params.botId, options);
  }));
  router.register("POST", "/api/w/:workspaceSlug/bots/:botId/teach/stop", auth, handle(async (request, _user, options) =>
    bots.stopTeaching(request.params.botId, { discard: request.body?.discard === true }, options)));
  router.register("DELETE", "/api/w/:workspaceSlug/bots/:botId/routines/:routineId", auth, handle(async (request, _user, options) =>
    bots.deleteRoutine(request.params.botId, request.params.routineId, options)));
  router.register("PUT", "/api/w/:workspaceSlug/bot-pins", auth, handle(async (request, _user, options) => ({
    bots: await bots.reorderPins(request.body?.botIds, options)
  })));
  router.register("POST", "/api/w/:workspaceSlug/bot-sections", auth, handle(async (request, _user, options) =>
    bots.createSection({ name: request.body?.name, botId: request.body?.botId }, options)));
  router.register("PATCH", "/api/w/:workspaceSlug/bot-sections/:sectionId", auth, handle(async (request, _user, options) => ({
    section: await bots.updateSection(request.params.sectionId, request.body || {}, options)
  })));
  router.register("POST", "/api/w/:workspaceSlug/bot-sections/:sectionId/move", auth, handle(async (request, _user, options) =>
    bots.moveSection(request.params.sectionId, request.body?.direction, options)));
  router.register("DELETE", "/api/w/:workspaceSlug/bot-sections/:sectionId", auth, handle(async (request, _user, options) =>
    bots.deleteSection(request.params.sectionId, options)));

  // A person's approval rules and auto-review are their own, the same in every home (bot_policies, approval_rules).
  router.register("GET", "/api/w/:workspaceSlug/bot-policy", auth, handle((_request, _user, options) => approvals.policy(options)));
  router.register("PATCH", "/api/w/:workspaceSlug/bot-policy", auth, handle((request, _user, options) =>
    approvals.setAutoReview(request.body?.autoReview, options)));
  router.register("POST", "/api/w/:workspaceSlug/bot-policy/rules", auth, handle((request, _user, options) =>
    approvals.addRule(request.body || {}, options)));
  router.register("PATCH", "/api/w/:workspaceSlug/bot-policy/rules/:ruleId", auth, handle((request, _user, options) =>
    approvals.updateRule(request.params.ruleId, request.body || {}, options)));
  router.register("DELETE", "/api/w/:workspaceSlug/bot-policy/rules/:ruleId", auth, handle((request, _user, options) =>
    approvals.deleteRule(request.params.ruleId, options)));
}
