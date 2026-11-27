import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { ACTIONS, APPROVAL_OPTIONS, EMAIL_ADDRESS } from "./botActions.js";
import { MAIL } from "./mailTools.js";
import { saveLogin } from "./vaultLogins.js";
import { ConnectedAppError, appBusy, connectedKey, sendOrSimulate } from "./connectedApps.js";
import { sendSednaMessage } from "./sednaActions.js";
import { SednaUncertainError } from "./sednaApi.js";
import { BotsError } from "./botsError.js";
import { SHARE_YES, shareFile } from "./fileTools.js";
import { SIGN_IN_LINE } from "./signInCodes.js";
import { GITHUB_ALWAYS, GITHUB_CARD, GITHUB_NO } from "./githubCommands.js";

/** Every email address in a draft's To or Cc, as it's sent to. */
const addresses = (value) => String(value || "").match(new RegExp(EMAIL_ADDRESS.source, "giu")) || [];
/** A draft card answered already, or claimed by a press on another page or server. */
const draftClosed = () => new BotsError(409, "That draft has already been dealt with.", { code: "bots_draft_closed" });

/**
 * A person's answers on the cards a bot posts in a chat (D-46, R4): a question or approval, a hand-over, a secure
 * form, a draft and a share (D13), and a request cancelled from its card. A card is answered only by the person its
 * bot worked for (`body.for`): anyone else is refused (403), whatever chat it's in. The card's bot acts for that person
 * in that chat, on the chat's computer. Every method takes the call's options last: the person and the home are its
 * context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/account/server/types").Account} dependencies.account mercbot.account, where saved logins go
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("./types.js").BotRequests} dependencies.requests
 * @param {import("@local/files/server/types").Files} dependencies.files the chat's files, which an approved action or a
 *   Sedna draft's Send attaches
 * @param {import("./chatSeats.js").ChatSeats} dependencies.seats
 * @param {{ get: (chatId: string, options: object) => Promise<{ chat: object }> }} dependencies.chats chatMembers, for the chat's row
 * @param {{ choiceAnswered: (chat: object, choice: object, picks: string[], txOptions: object) => Promise<object> }} dependencies.onboarding
 *   the welcome chat's steps (B), told of an answer in a chat with an onboarding step
 * @param {(chatId: string, brief: { botId: string, by: string, userId: string }, options: object) => void} dependencies.answerBrief
 *   the bot a room's brief is for answers it there (botReplies.js), once start_room made the room (D-122)
 * @param {import("@local/apps/server/types").Apps} dependencies.apps the home's tables, which table_extend and
 *   table_field_add change once approved (D-130)
 */
export function createBotCards({
  records, account, env, computer, integrations, requests, files, seats, chats, onboarding, answerBrief, apps
}) {
  const { messages, work } = records;
  const chatOf = async (chatId, options) => (await chats.get(String(chatId), options)).chat;
  const placeOf = (seat) => files.store.placeFor({
    homeId: seat.workspace_id,
    chatId: seat.chat_id,
    chatKind: seat.chat.kind,
    botId: seat.id
  });

  /** The caller, who answers a card only when it's for them (R4). */
  function answerer(card, options) {
    // The person's own request (a card's button), or the bot's turn for the person it works for, who said it in words
    // (send_draft): that turn's model reader names them (records.readers.of), never an id a client sent.
    const me = String(resolveActorId(options.context) ?? records.readers.of(options.context)?.askerId ?? "");
    if (card.body.for && String(card.body.for.id) !== me) {
      const { name } = card.body.for;
      throw new BotsError(403, `This is waiting for ${name}'s OK.`, { code: "bots_waiting_for_other", params: { name } });
    }
    return me;
  }

  /** The card's bot in its chat, working for the person answering. */
  async function seatFor(chatId, card, me, options) {
    const seat = card.author_bot_id ? await seats.seatIn(chatId, card.author_bot_id, me, options) : null;
    if (!seat) throw new BotsError(409, "That card's bot isn't here any more.", { code: "bots_card_closed" });
    return seat;
  }

  /** What the card's bot posts after an answer, and the chat's people hear of it. */
  async function posted(seat, lines, options) {
    const appended = lines.length ? await seats.say(seat, lines, options) : [];
    await seats.tell(seat.chat_id, { type: "messages" }, options);
    return appended;
  }

  /**
   * The repository a GitHub card's yes is for (D-128): the one the bot asked for, or another of the person's that they
   * chose on the card, as their own GitHub sees it now (never as the page says), or 409 when it doesn't reach it.
   */
  async function chosenRepository(chatId, messageId, wanted, options) {
    if (!wanted) return null;
    const card = await messages.messageIn(String(chatId), String(messageId), options);
    if (!card || card.kind !== "choice" || card.body.purpose !== GITHUB_CARD || wanted === card.body.repository?.fullName) return null;
    answerer(card, options);
    const found = await integrations.connections.github.repository(options, String(wanted));
    if (!found) {
      throw new BotsError(409, `Mercbot's GitHub App doesn't reach ${wanted} with your GitHub.`, { code: "bots_github_repository_unreached", params: { repository: String(wanted) } });
    }
    const { id, fullName, write } = found.repository;
    return { id, fullName, write, private: Boolean(found.repository.private) };
  }

  /**
   * Answering a question card: one pick, or several for multi-select. No message bubble. The card is claimed in a short
   * transaction; an approved action then runs outside it, because it may take a while on the chat's computer and must
   * never hold the chat's rows locked. The welcome chat's cards (B's onboarding) move its steps on, and may answer
   * `addBots`. A GitHub card's yes (D-128) is kept in the same transaction: the bot may use that repository in its
   * commands, for this task or always, for the person answering, who is the one it's for; `answer` may name another of
   * their repositories they chose on the card (`{ selected, repository }`).
   */
  async function answerChoice(chatId, messageId, answer, options) {
    const { selected, repository: wanted = null } = Array.isArray(answer) || answer == null ? { selected: answer } : answer;
    const answering = (work) => retryLostInsertRace(options, () => records.chats.withTransaction(options, work));
    // Another repository chosen on the card is checked with the person's own GitHub before anything is locked.
    const other = await chosenRepository(chatId, messageId, wanted, options);
    const { chat, choice, picks, updated, extra } = await answering(async (txOptions) => {
      const chat = await records.chats.lock(String(chatId), txOptions, { writing: true });
      const choice = await messages.lockMessageIn(chat.id, String(messageId), txOptions, { kind: "choice" });
      if (!choice || choice.body.chosen || choice.body.inactive || choice.body.purpose === "bot-name") {
        throw new BotsError(409, "That question isn't open any more.", { code: "bots_question_closed" });
      }
      answerer(choice, txOptions);
      const picks = [...new Set((Array.isArray(selected) ? selected : []).map(String))].filter((pick) =>
        choice.body.options.includes(pick));
      if (!picks.length || (!choice.body.multi && picks.length !== 1)) {
        throw new BotsError(400, "Choose an option first.", { code: "bots_choice_missing" });
      }
      const repository = choice.body.purpose === GITHUB_CARD ? other || choice.body.repository : null;
      const updated = await messages.setBody(choice.id, {
        ...choice.body,
        chosen: choice.body.multi ? picks : picks[0],
        ...(repository ? { repository, question: choice.body.question.replace(choice.body.repository.fullName, repository.fullName) } : {})
      }, txOptions);
      if (repository && picks[0] !== GITHUB_NO) {
        const seat = await seatFor(chat.id, choice, answerer(choice, txOptions), txOptions);
        const always = picks[0] === GITHUB_ALWAYS;
        // Just this task is the bot's seat in this chat: one that left it has none.
        if (!always && !seat.chat_bot_id) throw new BotsError(409, "That card's bot isn't here any more.", { code: "bots_card_closed" });
        await records.githubRepos.allow({ botId: seat.id, chatBotId: seat.chat_bot_id, repository, always }, txOptions);
      }
      const extra = chat.onboarding_step && choice.body.purpose
        ? await onboarding.choiceAnswered(chat, choice, picks, txOptions)
        : {};
      return { chat, choice, picks, updated, extra: extra || {} };
    });
    const results = [];
    let answered = updated;
    const approved = choice.body.purpose === "approval" && picks[0] === APPROVAL_OPTIONS[0] && ACTIONS[choice.body.action?.id];
    const shared = choice.body.purpose === "share-file" && picks[0] === SHARE_YES && choice.body.share;
    if (approved || shared) {
      const me = answerer(choice, options);
      const seat = await seatFor(chat.id, choice, me, options);
      const place = placeOf(seat);
      let outcome;
      try {
        outcome = approved
          ? await ACTIONS[choice.body.action.id].run(
            {
              call: options,
              env,
              work,
              bots: records.bots,
              // The home's common knowledge (D-113): share_common_knowledge writes its entry from this card.
              commonKnowledge: records.commonKnowledge,
              cardId: String(choice.id),
              computer,
              integrations,
              userId: me,
              botId: seat.id,
              chatId: seat.chat_id,
              chatBotId: seat.chat_bot_id,
              computerId: seat.chat_bot_id,
              files,
              place,
              // Rooms (chatMembers.js): start_room makes one as the person who said yes (D-122), and the bot its brief is
              // for answers it there.
              chats,
              answerBrief,
              // The home's tables (D-130): table_extend and table_field_add change them from this card.
              apps
            },
            choice.body.action.args
          )
          : await shareFile(files, place, choice.body.share).then((path) => ({
            kind: "event",
            role: "bot",
            body: { text: "Shared", name: path.split("/").pop(), detail: `${choice.body.for?.name || "The person"} agreed: ${choice.body.share.from} is now also at ${path}.` }
          }));
      } catch (error) {
        // A person holding the chat's computer (D16) is named, so whoever said yes knows to wait for them.
        const held = error?.code === "computer_person_in_control" ? { detail: error.message } : {};
        outcome = { kind: "event", role: "system", body: { text: "That didn't work", ...held } };
      }
      // What the card itself shows once done (start_room's room, to open from it, D-122) goes on the card.
      const { result: _result, card: done = null, ...message } = outcome;
      if (done) answered = await messages.setBody(choice.id, { ...updated.body, done }, options);
      results.push(...await seats.say(seat, [message], options));
    }
    // An approval asked during a request (D-46): the bot carries on with it either way.
    if (choice.body.purpose === "approval" && choice.body.requestId) await requests.approvalAnswered(choice.body.requestId, options);
    await seats.tell(chat.id, { type: "messages" }, options);
    return { messages: [answered, ...results], chat: await chatOf(chat.id, options), ...extra };
  }

  /** The person finishes or skips a handover on the chat's computer. */
  async function settleHandover(chatId, messageId, outcome, options) {
    const status = outcome === "skipped" ? "skipped" : "done";
    // The card, the waiting state and any acknowledgement change together (D-14).
    const { seat, changed } = await records.chats.withTransaction(options, async (txOptions) => {
      const chat = await records.chats.lock(String(chatId), txOptions, { writing: true });
      const message = await messages.lockMessageIn(chat.id, String(messageId), txOptions);
      if (!message || message.kind !== "handover" || message.body.status !== "pending") {
        throw new BotsError(409, "That's already been dealt with.", { code: "bots_card_closed" });
      }
      const me = answerer(message, txOptions);
      const seat = await seatFor(chat.id, message, me, txOptions);
      const updated = await messages.setBody(message.id, { ...message.body, status }, txOptions);
      // A skip gets a set acknowledgement; "done" goes back to the bot to check the page.
      const acknowledged = status === "skipped"
        ? await seats.say(seat, [{
          kind: "text",
          role: "bot",
          body: {
            text:
              `No problem, I've left that: "${message.body.task}" isn't done. The page is still ` +
              `open on my computer, so just ask whenever you want to pick it up again.`
          }
        }], txOptions)
        : [];
      if (seat.chat_bot_id) await records.chats.updateChatBot(seat.chat_bot_id, { waiting_task: null }, txOptions);
      return { seat, changed: [updated, ...acknowledged] };
    });
    if (seat.chat_bot_id) {
      computer
        .hold(String(seat.chat_bot_id), false)
        .catch((error) => console.warn("Letting the bot's computer sleep again failed; it sleeps when idle.", error));
    }
    await seats.tell(seat.chat_id, { type: "messages" }, options);
    return { messages: changed, chat: await chatOf(seat.chat_id, options) };
  }

  /**
   * The person's answer on a secure form: their login or code is typed straight into the bot's page on the chat's
   * computer and, if they ticked the box, saved to the home's vault; the bot never sees it. What it signs in to is the
   * chat's (D14), which the chat is told in one line. Closing the form means no. Either way the card is settled, and the
   * page asks the bot to carry on.
   */
  async function settleSecureForm(chatId, messageId, input = {}, options) {
    const message = await messages.messageIn(String(chatId), String(messageId), options);
    if (!message || message.kind !== "secure_form" || message.body.status !== "pending") {
      throw new BotsError(409, "That form has already been dealt with.", { code: "bots_form_closed" });
    }
    const me = answerer(message, options);
    const seat = await seatFor(String(chatId), message, me, options);
    let body = { ...message.body, status: "closed" };
    const lines = [];
    if (input.action === "submit") {
      const values = message.body.form === "code"
        ? { code: String(input.code || "").slice(0, 64) }
        : { username: String(input.username || "").slice(0, 200), password: String(input.password || "").slice(0, 500) };
      if (!values.code && !values.password) throw new BotsError(400, "Fill in the form first.", { code: "bots_form_empty" });
      let result;
      try {
        result = await computer.fill(String(seat.chat_bot_id), { site: message.body.site, url: message.body.url, ...values });
      } catch (error) {
        throw new BotsError(409, `It couldn't be filled in: ${error.message}`, {
          code: "bots_form_fill_failed",
          params: { reason: error.message }
        });
      }
      if (!result.filled.length) {
        throw new BotsError(409, "The bot's page has no form to fill in right now.", { code: "bots_form_missing" });
      }
      const saved = input.save && message.body.form === "login"
        ? await saveLogin(account, env, message.body.site, values.username, values.password, options).catch(() => null)
        : null;
      body = { ...message.body, status: "submitted", filled: result.filled, ...(saved ? { vaultItem: saved.label } : {}) };
      lines.push({ kind: "event", role: "bot", body: { text: SIGN_IN_LINE, detail: `Signed in to ${message.body.site} on this chat's computer. ${SIGN_IN_LINE}` } });
    }
    const settled = await messages.setBody(message.id, body, options);
    return { messages: [settled, ...await posted(seat, lines, options)], chat: await chatOf(seat.chat_id, options) };
  }

  /**
   * The person's answer on a draft card: Send (with any edits) or Discard. After Send, the page asks the bot to send
   * exactly the card's text; Discard sends nothing. A mail goes from what the home connected, for the person the draft
   * was written for (R4).
   */
  async function settleDraft(chatId, messageId, input = {}, options) {
    const message = await messages.messageIn(String(chatId), String(messageId), options, { kind: "draft" });
    if (!message || message.body.status !== "pending") throw draftClosed();
    const me = answerer(message, options);
    const seat = await seatFor(String(chatId), message, me, options);
    const send = input.action === "send";
    const text = send ? String(input.text ?? message.body.text).trim().slice(0, 8000) : message.body.text;
    if (send && !text) throw new BotsError(400, "The draft is empty.", { code: "bots_draft_empty" });
    const subject = send && input.subject !== undefined ? String(input.subject).trim().slice(0, 200) : message.body.subject;
    /** To and Cc can be edited on the card too. */
    const edited = (field) => (send && input[field] !== undefined ? String(input[field]).trim().slice(0, 400) : message.body[field]);
    const body = {
      ...message.body,
      text,
      ...(subject ? { subject } : {}),
      to: edited("to"),
      ...(edited("cc") ? { cc: edited("cc") } : {})
    };
    const done = async (changed) => {
      await posted(seat, [], options);
      return { messages: changed, chat: await chatOf(seat.chat_id, options) };
    };
    // A Sedna message goes out as the person's own Sedna user from their team (D-94), in a live copy; a test copy logs it.
    if (send && message.body.sedna) return done(await sendSednaCard(seat, message, body, options));
    // An email from a connected mailbox goes straight out from it (D-31), in a live copy; a test
    // copy logs it instead and marks the card sent (D-69). Anything else is sent by the bot on its
    // computer once it hears about the Send.
    if (send && message.body.from) {
      const to = addresses(body.to);
      if (!to.length) {
        throw new BotsError(400, "This draft has no email address to send to. Ask the bot to add one.", {
          code: "bots_draft_recipient_missing"
        });
      }
      // Claimed first, so a second press (or another server) can't send it twice.
      if (!(await messages.claimBody(message.id, "pending", { ...body, status: "sending" }, options))) throw draftClosed();
      try {
        const entry = await connectedKey(
          { integrations, call: options },
          Object.keys(MAIL),
          "email",
          message.body.from
        );
        const cc = addresses(body.cc);
        await sendOrSimulate(
          { env },
          {
            kind: "email",
            summary: `the email "${subject || "(no subject)"}" from ${entry.account} to ${to.join(", ")}`,
            details: { from: entry.account, to, cc }
          },
          () => MAIL[entry.pluginId].sendEmail(entry.key, { to, cc, subject: subject || "", text, inReplyTo: message.body.inReplyTo })
        );
      } catch (error) {
        await messages.setBody(message.id, { ...body, status: "pending" }, options);
        if (error instanceof ConnectedAppError || appBusy(error)) {
          throw new BotsError(502, `It wasn't sent: ${error.message}`, {
            code: "bots_draft_send_failed",
            params: { reason: error.message }
          });
        }
        throw error;
      }
      return done([await messages.setBody(message.id, { ...body, status: "sent", sentAt: new Date().toISOString() }, options)]);
    }
    return done([await messages.setBody(message.id, { ...body, status: send ? "send" : "discarded" }, options)]);
  }

  /**
   * Send on a Sedna draft card (D-94): the press is the person's approval. Claimed first, so a second press (or another
   * server) can't send it twice, then sent as the person's own Sedna user from the card's team, in any chat (D14); a
   * reply quotes the answered message, read again in their teams. A failure puts the card back with what happened; one
   * where it isn't known whether it went says to check Sedna first, and nothing tries again by itself.
   */
  async function sendSednaCard(seat, message, body, options) {
    if (!addresses(body.to).length) {
      throw new BotsError(400, "This draft has no email address to send to. Ask the bot to add one.", { code: "bots_draft_recipient_missing" });
    }
    if (!(await messages.claimBody(message.id, "pending", { ...body, status: "sending" }, options))) throw draftClosed();
    let sent;
    try {
      sent = await sendSednaMessage(
        { call: options, env, integrations, files, place: placeOf(seat) },
        {
          team: body.sedna.team?.id,
          to: body.to,
          cc: body.cc,
          subject: body.subject ?? "",
          text: body.text,
          replyTo: body.sedna.replyTo,
          files: body.sedna.files
        }
      );
    } catch (error) {
      const unsure = error instanceof SednaUncertainError;
      await messages.setBody(message.id, { ...body, status: "pending", ...(unsure ? { unsure: true } : {}) }, options);
      if (error instanceof ConnectedAppError || appBusy(error)) {
        throw new BotsError(502, `It wasn't sent: ${error.message}`, { code: "bots_draft_send_failed", params: { reason: error.message } });
      }
      throw error;
    }
    const done = await messages.setBody(message.id, {
      ...body,
      status: "sent",
      sentAt: new Date().toISOString(),
      ...(sent.result?.simulated ? { simulated: true } : {})
    }, options);
    // The event line says what went where, as an approved action's does.
    const { result: _result, ...line } = sent;
    return [done, ...await seats.say(seat, [line], options)];
  }

  /** The person cancels a request from its card (D-46). */
  async function cancelRequest(requestId, options) {
    const request = await requests.cancel(requestId, options);
    if (!request) throw new BotsError(404, "That request isn't yours.", { code: "bots_request_not_found" });
    return { status: request.status };
  }

  return Object.freeze({
    answerChoice,
    settleHandover,
    settleSecureForm,
    settleDraft,
    cancelRequest
  });
}
