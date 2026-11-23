import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { refusalOf } from "@local/account/meter";
import { KNOWLEDGE_LIMITS } from "./botKnowledge.js";
import { isId } from "./botRows.js";
import { BotsError, archivedBotRefusal } from "./botsError.js";
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
// A whole piece of a bot's knowledge as JSON (KNOWLEDGE_LIMITS.piece characters, at up to 4 bytes each, and the escapes of
// its lines and quotes), which is past the server's usual body limit (D-107).
const KNOWLEDGE_BODY_LIMIT = KNOWLEDGE_LIMITS.piece * 8;
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
 * The bots' and chats' routes (D-36, D-112). Everything belongs to a home: routes live under
 * /api/w/:workspaceSlug/…, and JSKIT checks membership and fills request.workspace first.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Bots} capabilities.bots
 * @param {import("./types.js").Approvals} capabilities.approvals
 * @param {import("@local/notices/server/types").Notices} capabilities.notices
 * @param {import("@local/account/server/types").Meter} capabilities.meter
 * @param {import("./types.js").BotRecords} capabilities.records mercbot.bots.records, for the bot and the chat in the address
 * @param {Set<import("node:http").ServerResponse>} capabilities.streams the live event streams, ended on shutdown and when notices may have been missed
 */
export function registerRoutes(http, { bots, approvals, notices, meter, records, streams }) {
  /**
   * A bot or a chat in the address must be one the person may open in that same home, whatever its id: one check for
   * every route, so a member of one home can't reach another home's bots by their numbers, nor a private chat they
   * can't open (404, as for one that isn't there). An archived bot (D-108) and an archived chat are read-only: only a
   * route that says it takes one (`archived`) changes anything about it.
   */
  async function guard(request, options, { archived = false } = {}) {
    const { botId, chatId } = request.params || {};
    const writing = request.method !== "GET" && !archived;
    if (chatId !== undefined) {
      const chat = isId(chatId) ? await records.chats.find(String(chatId), options) : null;
      if (!chat) throw new BotsError(404, "Chat not found.", { code: "bots_chat_not_found" });
      if (chat.archived_at && writing) throw new BotsError(409, "This chat is archived. Unarchive it to continue.", { code: "bots_chat_archived" });
    }
    if (botId !== undefined) {
      const bot = isId(botId) ? await records.directory.findBot(String(botId), options) : null;
      if (!bot) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
      if (bot.archivedAt && writing) throw archivedBotRefusal(bot);
    }
  }

  /**
   * A route's work, given the request, its person and home, and the call options its reads and writes use. `archived`
   * lets it change an archived bot or chat (guard).
   */
  function handle(work, { archived = false } = {}) {
    return async function (request, reply) {
      try {
        const user = userOf(request);
        const options = await request.callOptions();
        await guard(request, options, { archived });
        // AI calls made for this request are recorded for its person, bot and home (D-73); in a chat, each speaking
        // bot's own (R8, the turns').
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
  const home = "/api/w/:workspaceSlug";
  const chat = `${home}/chats/:chatId`;
  const body = (request) => request.body || {};
  const { chats } = bots;

  // Chats (D-112, R2): the person's chat list, New room, the public rooms they aren't in (a page at a time, ?after= the
  // page before's next), one chat, and its members. Each change answers the chat as the page shows it (or the list),
  // and tells everyone in it, or everyone in the home for a public room (a `chat` event).
  router.register("GET", `${home}/chats`, auth, handle(async (request, _user, options) => {
    const { hidden, archived, after } = request.query || {};
    return chats.list({ hidden: hidden === "1", archived: archived === "1", after: after || null }, options);
  }));
  router.register("POST", `${home}/chats`, auth, handle(async (request, _user, options) => chats.create(body(request), options)));
  router.register("GET", `${home}/chats/public`, auth, handle(async (request, _user, options) =>
    chats.publicRooms({ after: typeof request.query?.after === "string" ? request.query.after : null }, options)));
  // A card's "Show hidden and archived": the person's hidden and archived chats a bot or a person shares, a page at a time.
  router.register("GET", `${home}/chats/shared`, auth, handle(async (request, _user, options) => {
    const { withBot, withPerson, after } = request.query || {};
    const text = (value) => (typeof value === "string" && value ? value : null);
    return chats.sharedTuckedAway({ withBot: text(withBot), withPerson: text(withPerson), after: text(after) }, options);
  }));
  router.register("GET", chat, auth, handle(async (request, _user, options) => chats.get(request.params.chatId, options)));
  // A chat's settings: its title, and whether its bots join in when useful (D-115), each written only when given.
  router.register("PATCH", chat, auth, handle(async (request, _user, options) =>
    chats.change(request.params.chatId, body(request), options)));
  router.register("DELETE", chat, auth, handle(async (request, _user, options) =>
    chats.remove(request.params.chatId, options), { archived: true }));
  router.register("POST", `${chat}/archive`, auth, handle(async (request, _user, options) =>
    chats.archive(request.params.chatId, options)));
  router.register("POST", `${chat}/unarchive`, auth, handle(async (request, _user, options) =>
    chats.unarchive(request.params.chatId, options), { archived: true }));
  router.register("POST", `${chat}/join`, auth, handle(async (request, _user, options) => chats.join(request.params.chatId, options)));
  router.register("POST", `${chat}/leave`, auth, handle(async (request, _user, options) =>
    chats.leave(request.params.chatId, options), { archived: true }));
  router.register("POST", `${chat}/people`, auth, handle(async (request, _user, options) =>
    chats.addPerson(request.params.chatId, request.body?.userId, options)));
  router.register("DELETE", `${chat}/people/:userId`, auth, handle(async (request, _user, options) =>
    chats.removePerson(request.params.chatId, request.params.userId, options)));
  router.register("POST", `${chat}/bots`, auth, handle(async (request, _user, options) =>
    chats.addBot(request.params.chatId, request.body?.botId, options)));
  // The bot in the address is the chat's: an archived one can be taken out of it.
  router.register("DELETE", `${chat}/bots/:botId`, auth, handle(async (request, _user, options) =>
    chats.removeBot(request.params.chatId, request.params.botId, options), { archived: true }));
  // The person's own place in a chat: pinned, its section, hidden, muted, unread; and how far they've read.
  router.register("PATCH", `${chat}/place`, auth, handle(async (request, _user, options) =>
    chats.changePlace(request.params.chatId, body(request), options), { archived: true }));
  router.register("POST", `${chat}/read`, auth, handle(async (request, _user, options) =>
    chats.markRead(request.params.chatId, request.body?.messageId, options), { archived: true }));
  // The person typing in a chat, or no longer: told to its other people at once. A page says it every few seconds while
  // the person types, so a generous limit per client address stops only a runaway page.
  router.register("POST", `${chat}/typing`, { ...auth, rateLimit: { max: 120, timeWindow: "1 minute" } }, handle(async (request, _user, options) =>
    chats.typing(request.params.chatId, request.body?.typing, options)));
  router.register("PUT", `${home}/chat-pins`, auth, handle(async (request, _user, options) =>
    chats.reorderPins(request.body?.chatIds, options)));
  router.register("POST", `${home}/chat-sections`, auth, handle(async (request, _user, options) =>
    chats.createSection({ name: request.body?.name, chatId: request.body?.chatId }, options)));
  router.register("PATCH", `${home}/chat-sections/:sectionId`, auth, handle(async (request, _user, options) =>
    chats.updateSection(request.params.sectionId, body(request), options)));
  router.register("POST", `${home}/chat-sections/:sectionId/move`, auth, handle(async (request, _user, options) =>
    chats.moveSection(request.params.sectionId, request.body?.direction, options)));
  router.register("DELETE", `${home}/chat-sections/:sectionId`, auth, handle(async (request, _user, options) =>
    chats.deleteSection(request.params.sectionId, options)));
  // Continue with others (D-114): the hand-over note the direct chat's bot writes for a new chat with more people and
  // bots, one billed call refused in a paused home; nothing is kept, and New chat's own route makes the chat.
  router.register("POST", `${chat}/hand-over-note`, auth, handle(async (request, _user, options) => {
    await unlessPaused(request);
    return bots.handOverNote(request.params.chatId, options);
  }));
  // A bot's [Message] (Team, its card): the person's direct chat with it, made on first use.
  router.register("POST", `${home}/bots/:botId/direct`, auth, handle(async (request, _user, options) =>
    chats.direct(request.params.botId, options)));
  // A person's [Message] (People, their card): the private chat between the two of them, made on first use.
  router.register("POST", `${home}/people/:userId/direct`, auth, handle(async (request, _user, options) =>
    chats.personDirect(request.params.userId, options)));

  // What is said in a chat (D-112; the turns, step 2's A, and onboarding, B): its messages a page at a time (`before`,
  // a message id) or what changed since a cursor (`since`), Find in chat, a person's message, the bots' reply to it
  // (who speaks, R3), the status line, reactions, and the cards' answers.
  router.register("GET", `${chat}/messages`, auth, handle(async (request, _user, options) =>
    bots.chat.messages(request.params.chatId, { since: request.query?.since, before: request.query?.before }, options)));
  router.register("GET", `${chat}/find`, auth, handle(async (request, _user, options) =>
    bots.chat.findOlder(request.params.chatId, { q: request.query?.q, before: request.query?.before }, options)));
  router.register("POST", `${chat}/messages`, auth, handle(async (request, _user, options) =>
    bots.chat.sendMessage(request.params.chatId, body(request), options)));
  router.register("POST", `${chat}/reply`, auth, handle(async (request, user, options) =>
    bots.chat.reply(request.params.chatId, body(request), user.displayName, options)));
  // The status line is an AI call of its own: a paused home's reply says why instead.
  router.register("POST", `${chat}/messages/:messageId/activity`, auth, handle(async (request, _user, options) =>
    (await meter.pausedMessage(request.workspace.id))
      ? { status: "", messages: [] }
      : bots.chat.describeWork(request.params.chatId, request.params.messageId, options)));
  router.register("PUT", `${chat}/messages/:messageId/reaction`, auth, handle(async (request, _user, options) =>
    bots.chat.react(request.params.chatId, request.params.messageId, request.body?.emoji, options)));
  router.register("POST", `${chat}/choices/:messageId`, auth, handle(async (request, _user, options) =>
    bots.chat.answerChoice(request.params.chatId, request.params.messageId, request.body?.selected, options)));
  router.register("POST", `${chat}/handover/:messageId`, auth, handle(async (request, _user, options) =>
    bots.chat.settleHandover(request.params.chatId, request.params.messageId, request.body?.outcome, options)));
  router.register("POST", `${chat}/secure-forms/:messageId`, auth, handle(async (request, _user, options) =>
    bots.chat.settleSecureForm(request.params.chatId, request.params.messageId, body(request), options)));
  // The person started signing in from a connect card: the bot finishes the task once it's connected.
  router.register("POST", `${chat}/connect-cards/:messageId`, auth, handle(async (request, _user, options) =>
    bots.chat.connectFromCard(request.params.chatId, request.params.messageId, body(request), options)));
  router.register("POST", `${chat}/drafts/:messageId`, auth, handle(async (request, _user, options) =>
    bots.chat.settleDraft(request.params.chatId, request.params.messageId, body(request), options)));
  // Discuss (D-115): a card proposed with its question, then Start, One more round, Wrap up, Cancel and Stop on it.
  const discussion = `${chat}/discussions/:messageId`;
  router.register("POST", `${chat}/discussions`, auth, handle(async (request, _user, options) =>
    bots.chat.discuss(request.params.chatId, body(request), options)));
  router.register("POST", `${discussion}/start`, auth, handle(async (request, _user, options) =>
    bots.chat.startDiscussion(request.params.chatId, request.params.messageId, body(request), options)));
  router.register("POST", `${discussion}/round`, auth, handle(async (request, _user, options) =>
    bots.chat.discussMore(request.params.chatId, request.params.messageId, body(request), options)));
  router.register("POST", `${discussion}/wrap`, auth, handle(async (request, _user, options) =>
    bots.chat.wrapUpDiscussion(request.params.chatId, request.params.messageId, body(request), options)));
  router.register("POST", `${discussion}/cancel`, auth, handle(async (request, _user, options) =>
    bots.chat.cancelDiscussion(request.params.chatId, request.params.messageId, options)));
  // Stop stays open in an archived chat, so a round running when it was archived can still be ended.
  router.register("POST", `${discussion}/stop`, auth, handle(async (request, _user, options) =>
    bots.chat.stopDiscussion(request.params.chatId, request.params.messageId, options), { archived: true }));
  // The welcome chat (B's onboarding): made at a person's first visit with the main bot, and its steps.
  router.register("POST", `${home}/chats/welcome`, auth, handle(async (_request, _user, options) => bots.chat.welcome(options)));
  router.register("POST", `${chat}/onboarding/advance`, auth, handle(async (request, user, options) =>
    bots.chat.advanceOnboarding(request.params.chatId, String(request.body?.step || ""), user, options)));
  router.register("POST", `${chat}/onboarding/name`, auth, handle(async (request, _user, options) =>
    bots.chat.chooseName(request.params.chatId, String(request.body?.name || ""), options)));
  // A bot in a chat: a voice call's seconds, and teaching it on the chat's computer (D14: the chat's).
  router.register("POST", `${chat}/bots/:botId/voice-call`, auth, handle(async (request, _user, options) =>
    bots.chat.recordVoiceCall(request.params.chatId, request.params.botId, request.body?.seconds, options)));
  router.register("POST", `${chat}/bots/:botId/teach/start`, auth, handle(async (request, _user, options) => {
    await unlessPaused(request);
    return bots.chat.startTeaching(request.params.chatId, request.params.botId, options);
  }));
  router.register("POST", `${chat}/bots/:botId/teach/stop`, auth, handle(async (request, _user, options) =>
    bots.chat.stopTeaching(request.params.chatId, request.params.botId, { discard: request.body?.discard === true }, options)));
  // Routines belong to a bot in a chat (D-112): a chat's, a bot's in the chats the person can open, and one switched
  // off, on or deleted.
  router.register("GET", `${chat}/routines`, auth, handle(async (request, _user, options) =>
    bots.chat.routinesIn(request.params.chatId, options)));
  router.register("GET", `${home}/bots/:botId/routines`, auth, handle(async (request, _user, options) =>
    bots.chat.routinesOf(request.params.botId, options)));
  router.register("PATCH", `${home}/routines/:routineId`, auth, handle(async (request, _user, options) =>
    bots.chat.switchRoutine(request.params.routineId, request.body?.enabled, options)));
  router.register("DELETE", `${home}/routines/:routineId`, auth, handle(async (request, _user, options) =>
    bots.chat.deleteRoutine(request.params.routineId, options)));
  // A request between bots is cancelled by the person it's for (D-46).
  router.register("POST", `${home}/bot-requests/:requestId/cancel`, auth, handle(async (request, _user, options) =>
    bots.cancelRequest(request.params.requestId, options)));

  // The home's bots (D-112: members of the home, in any number of chats): the Team page's list, one bot, New bot,
  // templates and teams, and a bot's own Details (instructions, knowledge, template, library).
  router.register("GET", `${home}/bots`, auth, handle(async (_request, _user, options) => bots.listBots(options)));
  router.register("GET", `${home}/bots/:botId`, auth, handle(async (request, _user, options) => ({
    bot: await bots.listedBot(request.params.botId, options)
  })));
  router.register("POST", `${home}/bots`, auth, handle(async (request, _user, options) => ({
    bot: await bots.createBot(body(request), options)
  })));
  router.register("PATCH", `${home}/bots/:botId`, auth, handle(async (request, _user, options) => {
    if (request.body?.main !== undefined && !manages(request)) {
      throw new BotsError(403, "Only the home's owners and admins can replace the main bot.", { code: "bots_main_bot_manage_forbidden" });
    }
    return { bot: await bots.updateBot(request.params.botId, body(request), options) };
  }));
  // A whole bot archived and unarchived for everyone in the home (D-108), by whoever made it and the home's owners and
  // admins. Each answers the bot as listed.
  router.register("POST", `${home}/bots/:botId/archive`, auth, handle(async (request, _user, options) =>
    bots.archiveBot(request.params.botId, options), { archived: true }));
  router.register("POST", `${home}/bots/:botId/unarchive`, auth, handle(async (request, _user, options) =>
    bots.unarchiveBot(request.params.botId, options), { archived: true }));
  router.register("DELETE", `${home}/bots/:botId`, auth, handle(async (request, _user, options) =>
    bots.deleteBot(request.params.botId, options), { archived: true }));
  router.register("GET", `${home}/bots/:botId/library`, auth, handle(async (request, _user, options) =>
    bots.library(request.params.botId, options)));
  router.register("POST", `${home}/bots/:botId/library/pin`, auth, handle(async (request, _user, options) =>
    bots.pinItem(request.params.botId, body(request), options)));
  // A page deleted from the Library, after the person confirmed: the Library again, and the page's cards.
  router.register("DELETE", `${home}/bots/:botId/library/pages/:messageId`, auth, handle(async (request, _user, options) =>
    bots.deletePage(request.params.botId, request.params.messageId, options)));
  // The "/" picker's skills in a chat (?chat=): the person's own only in a Private chat of theirs alone.
  router.register("GET", `${home}/bot-skills`, auth, handle(async (request, _user, options) => bots.skillsFor(request.query?.chat, options)));
  router.register("GET", `${home}/search`, auth, handle(async (request, _user, options) => bots.search(request.query?.q, options)));
  // Notices this server may have missed (its listening connection was replaced) end every open stream, and each page
  // connects again and catches up (useChatEvents.js). Heard from the first stream on: before it there's none to end.
  let endingOnMissed = false;
  const endStreamsOnMissed = () => {
    if (endingOnMissed) return;
    endingOnMissed = true;
    notices.onMissed(() => {
      for (const stream of streams) stream.end();
    });
  };
  // What changed for this person's chats and bots, as server-sent events from any server (D-15).
  router.register("GET", `${home}/bot-events`, auth, async (request, reply) => {
    endStreamsOnMissed();
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
  router.register("POST", `${home}/bots/from-template`, auth, handle(async (request, user, options) => ({
    bot: await bots.addFromTemplate(String(request.body?.slug || ""), user.displayName, options)
  })));
  // Teams (D-105): a team's bots as the home has them, and Add N bots, for everyone in the home, as New bot is.
  router.register("GET", `${home}/teams/:teamId`, auth, handle(async (request, _user, options) =>
    bots.teamFor(request.params.teamId, options)));
  router.register("POST", `${home}/teams/:teamId`, auth, handle(async (request, _user, options) =>
    bots.addTeam(request.params.teamId, request.body?.templates, options)));
  // Add bots' suggestions (D-109): a plan, one billed call like a reply, refused in a paused home, with nothing kept; and
  // Add N bots, the bots ticked on it, for everyone in the home, as One bot is.
  router.register("POST", `${home}/bots/plan`, auth, handle(async (request, _user, options) => {
    await unlessPaused(request);
    return bots.proposeBots(body(request), options);
  }));
  router.register("POST", `${home}/bots/batch`, auth, handle(async (request, _user, options) =>
    bots.addBots(body(request), options)));
  // A template drafted by the bot (D-98): one billed call, like a reply, refused in a paused home; nothing is kept.
  router.register("POST", `${home}/bots/templates/draft`, auth, handle(async (request, _user, options) => {
    await unlessPaused(request);
    return bots.draftTemplate(body(request), options);
  }));
  // The home's own templates (D-98), for everyone in it: each one's tag, description and how many bots use it. Its owners
  // and admins change one (PUT, naming the updatedAt they opened) and delete one no bot uses.
  router.register("GET", `${home}/home-templates`, auth, handle(async (_request, _user, options) => bots.homeTemplates(options)));
  router.register("GET", `${home}/home-templates/:templateId`, auth, handle(async (request, _user, options) =>
    bots.homeTemplate(request.params.templateId, options)));
  router.register("PUT", `${home}/home-templates/:templateId`, auth, handle(async (request, _user, options) =>
    bots.editHomeTemplate(request.params.templateId, { draft: request.body?.draft, updatedAt: request.body?.updatedAt }, options)));
  router.register("DELETE", `${home}/home-templates/:templateId`, auth, handle(async (request, _user, options) =>
    bots.deleteHomeTemplate(request.params.templateId, options)));
  // A bot's template and additions (D-98), for its Details panel's Instructions; PATCH …/bots/:botId changes its
  // additions, and PUT …/template points it at another template ({ library: slug } or { home: id }), or at a new one of
  // the home's made from a draft ({ draft, foldAdditions }).
  router.register("GET", `${home}/bots/:botId/instructions`, auth, handle(async (request, _user, options) =>
    bots.instructionsOf(request.params.botId, options)));
  router.register("PUT", `${home}/bots/:botId/template`, auth, handle(async (request, user, options) => ({
    bot: await bots.changeTemplate(request.params.botId, body(request), user.displayName, options)
  })));
  // What a bot knows (D-107), in its Details panel: everyone in the home reads it; its maker and the home's owners and
  // admins add pasted text ({ title, text }, up to a book: the body limit is a whole piece's) or a file they put in the
  // bot's folder ({ title, file }), change a piece's title or text, remove it, or try a failed one again. Each change
  // answers the whole list, as the list does.
  const knowledgeAt = `${home}/bots/:botId/knowledge`;
  const bookSized = { ...auth, bodyLimit: KNOWLEDGE_BODY_LIMIT };
  router.register("GET", knowledgeAt, auth, handle(async (request, _user, options) =>
    bots.knowledge.list(request.params.botId, options)));
  router.register("POST", knowledgeAt, bookSized, handle(async (request, _user, options) =>
    bots.knowledge.add(request.params.botId, body(request), options)));
  router.register("GET", `${knowledgeAt}/:knowledgeId`, auth, handle(async (request, _user, options) =>
    bots.knowledge.read(request.params.botId, request.params.knowledgeId, options)));
  router.register("PATCH", `${knowledgeAt}/:knowledgeId`, bookSized, handle(async (request, _user, options) =>
    bots.knowledge.change(request.params.botId, request.params.knowledgeId, body(request), options)));
  router.register("DELETE", `${knowledgeAt}/:knowledgeId`, auth, handle(async (request, _user, options) =>
    bots.knowledge.remove(request.params.botId, request.params.knowledgeId, options)));
  router.register("POST", `${knowledgeAt}/:knowledgeId/retry`, auth, handle(async (request, _user, options) =>
    bots.knowledge.retry(request.params.botId, request.params.knowledgeId, options)));

  // A bot's rooms memory (D-113), on its card, for everyone in the home: its digest of the public rooms it's in. The
  // home's common knowledge, in Settings, a page at a time (?after= the page before's next), each entry removed by the
  // person who asked for it or the home's owners and admins.
  router.register("GET", `${home}/bots/:botId/rooms-memory`, auth, handle(async (request, _user, options) =>
    bots.roomsMemory.roomsMemoryOf(request.params.botId, options)));
  router.register("GET", `${home}/common-knowledge`, auth, handle(async (request, _user, options) =>
    bots.commonKnowledge.list({ after: typeof request.query?.after === "string" ? request.query.after : null }, options)));
  router.register("DELETE", `${home}/common-knowledge/:entryId`, auth, handle(async (request, _user, options) =>
    bots.commonKnowledge.remove(request.params.entryId, options)));

  // A person's approval rules and auto-review are their own in each home (bot_policies, approval_rules).
  router.register("GET", `${home}/bot-policy`, auth, handle((_request, _user, options) => approvals.policy(options)));
  router.register("PATCH", `${home}/bot-policy`, auth, handle((request, _user, options) =>
    approvals.setAutoReview(request.body?.autoReview, options)));
  router.register("POST", `${home}/bot-policy/rules`, auth, handle((request, _user, options) => approvals.addRule(body(request), options)));
  router.register("PATCH", `${home}/bot-policy/rules/:ruleId`, auth, handle((request, _user, options) =>
    approvals.updateRule(request.params.ruleId, body(request), options)));
  router.register("DELETE", `${home}/bot-policy/rules/:ruleId`, auth, handle((request, _user, options) =>
    approvals.deleteRule(request.params.ruleId, options)));
}
