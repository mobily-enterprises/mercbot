import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { EMAIL_ADDRESS } from "./botActions.js";
import { ConnectedAppError, connectedKey } from "./connectedApps.js";
import { MAIL } from "./mailTools.js";

/**
 * Mail drafts: an editable card; nothing goes out until the person
 * presses Send or tells the bot in words to send it. A reply is filled from the email it answers:
 * From is the mailbox that received it, To its reply-to address, and it stays in its thread.
 * @param {object} shared
 * @param {import("./types.js").TurnRepository} shared.turns records.turns
 * @param {import("./types.js").CallOptions} shared.call the turn's call options
 * @param {string} shared.conversationId
 * @param {boolean} shared.viaBot
 * @param {import("./types.js").SettleDraft} shared.settleDraft
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {object[]} shared.after
 */
export function buildDraftTools({ turns, call, conversationId, viaBot, settleDraft, appFor, after }) {
  const tools = {};
  async function showDraft({ replyTo, to, cc, via, from, subject, text }) {
    if (after.some((message) => message.kind === "draft")) return { status: "already shown" };
    const body = { ...(cc ? { cc: cc.trim() } : {}), text: text.trim(), status: "pending" };
    let doubt;
    try {
      if (replyTo) {
        const entry = await connectedKey(appFor("show_draft"), Object.keys(MAIL), "email", replyTo.account);
        const original = await MAIL[entry.pluginId].readEmail(entry.key, replyTo.emailId);
        const senderAddress = (original.from.match(EMAIL_ADDRESS) || [""])[0];
        const replyAddress = (String(original.replyTo || "").match(EMAIL_ADDRESS) || [senderAddress])[0];
        Object.assign(body, {
          from: entry.address,
          to: (to || replyAddress).trim(),
          subject: (subject || (/^re:/iu.test(original.subject) ? original.subject : `Re: ${original.subject}`)).trim(),
          inReplyTo: {
            id: original.id,
            messageId: original.messageId,
            threadId: original.threadId,
            subject: original.subject,
            from: original.from
          }
        });
        if (replyAddress && senderAddress && replyAddress.toLowerCase() !== senderAddress.toLowerCase()) {
          doubt =
            `The email came from ${senderAddress} but asks for replies to go to ${replyAddress}; the draft goes to ${body.to}. Say ` +
            `so, and say why.`;
        }
      } else {
        if (!to) return { error: "Say who it's for in to." };
        if (from) {
          await connectedKey(appFor("show_draft"), Object.keys(MAIL), "email", from);
          if (!EMAIL_ADDRESS.test(to)) {
            return {
              error: "Put the recipients' email addresses in to, so it can be sent from the mailbox (find_contact can look them up)."
            };
          }
        }
        Object.assign(body, { to: to.trim(), ...(from ? { from: from.trim() } : {}), ...(subject ? { subject: subject.trim() } : {}) });
      }
    } catch (error) {
      if (error instanceof ConnectedAppError) return { error: error.message };
      throw error;
    }
    if (!body.from) body.via = String(via || "your account").trim();
    after.push({ kind: "draft", role: "bot", body });
    return {
      status: "waiting_for_send",
      from: body.from,
      to: body.to,
      ...(doubt ? { doubt } : {}),
      note:
        "The draft card is below. In a short message say what it replies to (if a reply), who it goes to and why that address, that nothing has been sent, and any doubt you have about the recipient; then say they can press Send or tell you to send it."
    };
  }
  tools.showDraft = createTool(
    Object.freeze({
      id: "show_draft",
      description:
        "Show a message, email or post you wrote for the person to send as themselves, on an editable card with Send and Discard. " +
        "Nothing goes out until they press Send or tell you to send it. To reply to an email you read, give replyTo (its id and mailbox): From, To, subject and threading are filled from it. For a new email from a connected mailbox, set from to that mailbox's address (the person's own unless they say otherwise) and put the recipients' email addresses in to. For anything else, say in via where it would be sent from.",
      inputSchema: z.object({
        replyTo: z
          .object({
            emailId: z.string().min(1).max(500).describe("The id of the email being answered, from search_email"),
            account: z.string().max(200).optional().describe("The mailbox it's in, by address or label")
          })
          .optional(),
        to: z
          .string()
          .max(400)
          .optional()
          .describe(
            "Who it's for; email addresses when sending from a connected mailbox. For a reply, leave out to use the email's reply-to address"
          ),
        cc: z.string().max(400).optional().describe("Email addresses to copy in, only when the person asked"),
        via: z
          .string()
          .max(100)
          .optional()
          .describe("Where it would be sent from when no mailbox is connected, e.g. a messaging site on your computer"),
        from: z.string().max(200).optional().describe("The connected mailbox's address, to send the email straight from it"),
        subject: z.string().max(200).optional(),
        text: z.string().min(1).max(8000).describe("The message, starting with a greeting by first name and ending with a sign-off")
      }),
      execute: (input, options) => showDraft(input, options)
    })
  );
  /** "Send it" or "throw it away" said in words settles the latest draft card, as its buttons would. */
  const latestDraft = () => turns.latestMessage(conversationId, { kind: "draft", bodyStatus: "pending" }, call);
  async function sendDraft() {
    // Only the person can say "send" (D-46): another bot's request never does.
    if (viaBot) return { error: "Only the person can send this: they press Send on the card, or tell you in their own chat." };
    const draft = await latestDraft();
    if (!draft) return { error: "There's no draft waiting to be sent." };
    try {
      const { messages } = await settleDraft(draft.id, { action: "send" });
      return messages[0]?.body.status === "sent"
        ? { status: "sent", from: draft.body.from, to: draft.body.to }
        : { status: "approved", note: "Send it now yourself where it was meant to go, then say it's done." };
    } catch (error) {
      return { error: error.message };
    }
  }
  tools.sendDraft = createTool(Object.freeze({
    id: "send_draft",
    description: "Send the draft card that's waiting, exactly as shown, only when the person has just told you in words to send it.",
    inputSchema: z.object({}),
    execute: (input, options) => sendDraft(input, options)
  }));
  async function discardDraft() {
    const draft = await latestDraft();
    if (!draft) return { error: "There's no draft waiting." };
    await settleDraft(draft.id, { action: "discard" });
    return {
      status: "discarded",
      note:
        "Nothing was sent. It was only a card in this chat, never saved in the mailbox's drafts, so there's nothing to clean up; say so in one line."
    };
  }
  tools.discardDraft = createTool(Object.freeze({
    id: "discard_draft",
    description: "Throw away the draft card that's waiting, when the person says they don't want it sent.",
    inputSchema: z.object({}),
    execute: (input, options) => discardDraft(input, options)
  }));
  return tools;
}
