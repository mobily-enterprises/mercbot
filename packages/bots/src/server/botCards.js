import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { ACTIONS, APPROVAL_OPTIONS, EMAIL_ADDRESS } from "./botActions.js";
import { MAIL } from "./mailTools.js";
import { saveLogin } from "./vaultLogins.js";
import { ConnectedAppError, connectedKey, sendOrSimulate } from "./connectedApps.js";
import { BotsError } from "./botsError.js";
import { toBot } from "./botRows.js";

/**
 * The person's answers on the cards a bot posts (D-46): a question or approval, a hand-over, a secure
 * form and a draft, and a request cancelled from its card. Every method takes the call's options last: the person and
 * the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/account/server/types").Account} dependencies.account mercbot.account, where saved logins go
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@local/computer/server/types").Computer} dependencies.computer
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("./types.js").BotRequests} dependencies.requests
 */
export function createBotCards({ records, account, env, computer, integrations, conversations, requests }) {
  const { conversations: store, messages, work } = records;

  /**
   * Answering a question card: one pick, or several for multi-select. No user bubble.
   * The card is claimed in a short transaction; an approved action then runs outside it, because
   * it may take a while on the bot's computer and must never hold the bot's rows locked.
   */
  async function answerChoice(botId, messageId, selected, options) {
    const userId = conversations.personOf(options);
    const { row, choice, picks, updated } = await retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      const row = await conversations.ownedBot(botId, txOptions, { lock: true });
      const choice = await messages.lockMessageIn(row.conversation_id, String(messageId), txOptions, { kind: "choice" });
      if (!choice || choice.body.chosen || choice.body.inactive || choice.body.purpose === "bot-name") {
        throw new BotsError(409, "That question isn't open any more.", { code: "bots_question_closed" });
      }
      if (choice.body.for && String(choice.body.for.id) !== userId) {
        const { name } = choice.body.for;
        throw new BotsError(403, `This is waiting for ${name}'s OK.`, { code: "bots_waiting_for_other", params: { name } });
      }
      const picks = [...new Set((Array.isArray(selected) ? selected : []).map(String))].filter((pick) =>
        choice.body.options.includes(pick));
      if (!picks.length || (!choice.body.multi && picks.length !== 1)) {
        throw new BotsError(400, "Choose an option first.", { code: "bots_choice_missing" });
      }
      const updated = await messages.setBody(choice.id, { ...choice.body, chosen: choice.body.multi ? picks : picks[0] }, txOptions);
      const update = { last_activity_at: new Date().toISOString() };
      if (choice.body.purpose === "first-task") update.onboarding_step = null;
      await store.updateConversation(row.conversation_id, update, txOptions);
      return { row, choice, picks, updated };
    }));
    const results = [];
    // In a group the card's bot acts for the person it asked (D-46).
    const { actor, computerId } =
      row.kind === "group" ? await conversations.groupActor(row, choice, options) : { actor: row, computerId: row.conversation_id };
    // An approved action runs exactly as it was proposed on the card.
    if (choice.body.purpose === "approval" && picks[0] === APPROVAL_OPTIONS[0] && ACTIONS[choice.body.action?.id]) {
      let outcome;
      try {
        outcome = await ACTIONS[choice.body.action.id].run(
          {
            call: options,
            env,
            work,
            computer,
            integrations,
            reach: conversations.reachOf(actor),
            userId: actor.user_id,
            botId: actor.id,
            conversationId: actor.conversation_id,
            computerId
          },
          choice.body.action.args
        );
      } catch {
        outcome = { kind: "event", role: "system", body: { text: "That didn't work" } };
      }
      const { result: _result, ...message } = outcome;
      results.push(
        ...(await conversations.append(row, [
          row.kind === "group" ? { ...message, body: { ...message.body, speaker: choice.body.speaker } } : message
        ], options))
      );
    }
    // An approval asked during a request (D-46): the bot carries on with it either way.
    if (choice.body.purpose === "approval" && choice.body.requestId) await requests.approvalAnswered(choice.body.requestId, options);
    return { bot: toBot(await conversations.refresh(row, options)), messages: [updated, ...results] };
  }

  /** The person finishes or skips a handover on the bot's computer. */
  async function settleHandover(botId, messageId, outcome, options) {
    const row = await conversations.ownedBot(botId, options);
    // In a group, only the person it was handed to settles it, on the bot's computer for the group (D-46).
    let computerId = row.conversation_id;
    if (row.kind === "group") {
      const card = await messages.messageIn(row.conversation_id, String(messageId), options);
      if (card) ({ computerId } = await conversations.groupActor(row, card, options));
    }
    const status = outcome === "skipped" ? "skipped" : "done";
    // The card, the waiting state and any acknowledgement change together (D-14).
    const result = await store.withTransaction(options, async (txOptions) => {
      const message = await messages.lockMessageIn(row.conversation_id, String(messageId), txOptions);
      if (!message || message.kind !== "handover" || message.body.status !== "pending") {
        throw new BotsError(409, "That's already been dealt with.", { code: "bots_card_closed" });
      }
      const updated = await messages.setBody(message.id, { ...message.body, status }, txOptions);
      // A skip gets a set acknowledgement; "done" goes back to the bot to check the page.
      const acknowledged =
        status === "skipped"
          ? await conversations.append(row, [
            {
              kind: "text",
              role: "bot",
              body: {
                text:
                    `No problem, I've left that: "${message.body.task}" isn't done. The page is still ` +
                    `open on my computer, so just ask whenever you want to pick it up again.`
              }
            }
          ], txOptions)
          : [];
      await store.updateConversation(row.conversation_id, { waiting_task: null, last_activity_at: new Date().toISOString() }, txOptions);
      return { bot: toBot(await conversations.refresh(row, txOptions)), messages: [updated, ...acknowledged] };
    });
    computer
      .hold(String(computerId), false)
      .catch((error) => console.warn("Letting the bot's computer sleep again failed; it sleeps when idle.", error));
    return result;
  }

  /**
   * The person's answer on a secure form: their login or code is typed straight into
   * the bot's page and, if they ticked the box, saved to the vault; the bot never sees it. Closing
   * the form means no. Either way the card is settled, and the page asks the bot to carry on.
   */
  async function settleSecureForm(botId, messageId, input = {}, options) {
    const row = await conversations.ownedBot(botId, options);
    const message = await messages.messageIn(row.conversation_id, String(messageId), options);
    if (!message || message.kind !== "secure_form" || message.body.status !== "pending") {
      throw new BotsError(409, "That form has already been dealt with.", { code: "bots_form_closed" });
    }
    // In a group only the person it asked fills it in, into the bot's page for this group (D-46).
    const { computerId } =
      row.kind === "group" ? await conversations.groupActor(row, message, options) : { computerId: row.conversation_id };
    let body = { ...message.body, status: "closed" };
    if (input.action === "submit") {
      const values = message.body.form === "code"
        ? { code: String(input.code || "").slice(0, 64) }
        : { username: String(input.username || "").slice(0, 200), password: String(input.password || "").slice(0, 500) };
      if (!values.code && !values.password) throw new BotsError(400, "Fill in the form first.", { code: "bots_form_empty" });
      let result;
      try {
        result = await computer.fill(String(computerId), { site: message.body.site, url: message.body.url, ...values });
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
    }
    return { bot: toBot(row), messages: [await messages.setBody(message.id, body, options)] };
  }

  /**
   * The person's answer on a draft card: Send (with any edits) or Discard. After Send, the page asks
   * the bot to send exactly the card's text; Discard sends nothing.
   */
  async function settleDraft(botId, messageId, input = {}, options) {
    const row = await conversations.ownedBot(botId, options);
    if (row.kind === "group" && !row.room) throw new BotsError(400, "That's a group chat, not a bot.", { code: "bots_group_not_bot" });
    const message = await messages.messageIn(row.conversation_id, String(messageId), options, { kind: "draft" });
    if (!message || message.body.status !== "pending") {
      throw new BotsError(409, "That draft has already been dealt with.", { code: "bots_draft_closed" });
    }
    // In a group, the person the draft was written for sends it, from what their bot may reach (D-46).
    const { actor } = row.kind === "group" ? await conversations.groupActor(row, message, options) : { actor: row };
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
    // An email from a connected mailbox goes straight out from it (D-31), in a live copy; a test
    // copy logs it instead and marks the card sent (D-69). Anything else is sent by the bot on its
    // computer once it hears about the Send.
    if (send && message.body.from) {
      const addresses = (value) => String(value || "").match(new RegExp(EMAIL_ADDRESS.source, "giu")) || [];
      const to = addresses(body.to);
      if (!to.length) {
        throw new BotsError(400, "This draft has no email address to send to. Ask the bot to add one.", {
          code: "bots_draft_recipient_missing"
        });
      }
      // Claimed first, so a second press (or another server) can't send it twice.
      if (!(await messages.claimBody(message.id, "pending", { ...body, status: "sending" }, options))) throw new BotsError(409, "That draft has already been dealt with.", { code: "bots_draft_closed" });
      try {
        const entry = await connectedKey(
          { integrations, reach: conversations.reachOf(actor), call: options },
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
        if (error instanceof ConnectedAppError) {
          throw new BotsError(502, `It wasn't sent: ${error.message}`, {
            code: "bots_draft_send_failed",
            params: { reason: error.message }
          });
        }
        throw error;
      }
      const sent = await messages.setBody(message.id, { ...body, status: "sent", sentAt: new Date().toISOString() }, options);
      return { bot: toBot(row), messages: [sent] };
    }
    return { bot: toBot(row), messages: [await messages.setBody(message.id, { ...body, status: send ? "send" : "discarded" }, options)] };
  }

  /** The person cancels a request from either card (D-46). */
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
