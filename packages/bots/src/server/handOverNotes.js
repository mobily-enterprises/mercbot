import { generateOnce } from "@jskit-ai/agent/server";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { BotsError, archivedBotRefusal } from "./botsError.js";
import { plainText, previewOf } from "./botRows.js";

// "Continue with others…" (D-114, B3): a direct chat goes on in a new chat with more people and bots. The direct chat's
// bot writes a hand-over note from what was said there, the person reads and changes it in New chat's composer, and
// sends it as their own first message in the new chat. Nothing is kept here: the note is only an answer, and the new
// chat is made by New chat's own route. The note is written from the chat's messages as people see them (their text,
// and a card's one line), never from what the bot's tools read: a reply's transcript, a routine's prompt and the chat's
// summary (which, for a chat with one bot, keeps what its tools did) stay out of it. That is an R12 path with its row
// in modelInputs.js, read through the model's reader for the bot in the direct chat.

/** The first line of the note writer's instructions, which the stand-in model knows it by. */
export const NOTE_WRITER = "You write a short hand-over note that carries a chat on into a new chat with more people.";

/** The most a note's input and answer hold: each line of the chat, and the note itself. */
export const NOTE_LIMITS = Object.freeze({ line: 1500, note: 4000 });

/** The note writer's instructions, for the direct chat's bot. @param {string} botName */
export function noteSystem(botName) {
  return [
    NOTE_WRITER,
    `The chat so far is between the person and ${botName}, a bot. The person is taking it on into a new chat with other ` +
      "people and bots, who haven't seen it. Write the person's first message there, in the first person, as the person: " +
      `start with "Continuing from my chat with ${botName}:", then say in a few short lines what it's about, what was ` +
      "decided and what is still open. Under 150 words, plain text, no greeting or sign-off.",
    "Use only what the chat below says. The person reads and changes the note before sending it."
  ].join("\n");
}

/** The user message: the chat, one line per message, oldest first. @param {string[]} lines */
export const notePrompt = (lines) => `The chat:\n${lines.join("\n")}`;

/**
 * One message as the note reads it: its author's name and what people see of it, or "" for Mercbot's own lines. A
 * person's or bot's text (its mentions as names, its attachments by name) or a card's one line; never the body's other
 * fields, so no tool result, prompt or hidden detail is read.
 * @param {{ role: string, kind: string, body: Record<string, any> }} message as toMessage gives it
 * @param {string} botName
 */
export function noteLine(message, botName) {
  if (message.role !== "user" && message.role !== "bot") return "";
  const body = message.body || {};
  const who = body.authorName || (message.role === "bot" ? botName : "Someone");
  let said = "";
  if (message.kind === "text") {
    const files = (body.attachments || []).map((file) => String(file?.name || "")).filter(Boolean);
    said = [plainText(body.text || [body.heading, ...(body.bullets || [])].filter(Boolean).join("\n"), body.mentions, body.mentionedPeople),
      files.length ? `(attached ${files.join(", ")})` : ""].filter(Boolean).join(" ");
  } else {
    try {
      said = previewOf({ kind: message.kind, body: { ...body, transcript: undefined } });
    } catch {
      said = "";
    }
  }
  said = String(said || "").trim().slice(0, NOTE_LIMITS.line);
  return said ? `${who}: ${said}` : "";
}

/**
 * The hand-over notes (`bots.handOverNote`).
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {(system: string, messages: Array<{ role: string, content: string }>) => Promise<string>} dependencies.write the
 *   model's answer to the one call (writeNoteWith)
 */
export function createHandOverNotes({ records, meter, write }) {
  /**
   * The note for continuing a direct chat with others: `{ note }`, "" when nothing was said there yet (and no model call
   * is made). Only the direct chat's own person asks for it (403 `bots_chat_not_yours`); any other chat is 409
   * `bots_chat_not_direct`, and one the caller can't open a 404. A bot that's archived writes none (409, D-108). One
   * billed call, as the bot's own (the chat kind of work: someone is waiting on it).
   * @param {string} chatId
   * @param {object} options the call's options: the person and the home
   */
  async function handOverNote(chatId, options) {
    const me = String(resolveActorId(options.context) ?? "");
    const chat = await records.chats.get(String(chatId), options);
    if (!chat.direct_bot_id) {
      throw new BotsError(409, "Only a direct chat with a bot is continued with others. Add people to this chat instead.", {
        code: "bots_chat_not_direct"
      });
    }
    if (String(chat.direct_user_id) !== me) {
      throw new BotsError(403, "Only the person whose chat this is can continue it with others.", { code: "bots_chat_not_yours" });
    }
    const bot = await records.bots.get(String(chat.direct_bot_id), options);
    if (bot.archived_at) throw archivedBotRefusal(bot);
    // What the bot reads is the direct chat as its reader there may read it (R1), the newest page of it.
    const reader = { context: records.readers.forBot({ homeId: chat.workspace_id, botId: bot.id, chatId: chat.id, askerId: me }) };
    const { messages } = await records.messages.timeline(String(chat.id), {}, reader);
    const lines = messages.map((message) => noteLine(message, bot.name)).filter(Boolean);
    if (!lines.length) return { note: "" };
    const text = await meter.track({ botId: String(bot.id), work: "chat" }, () =>
      write(noteSystem(bot.name), [{ role: "user", content: notePrompt(lines) }]));
    return { note: String(text || "").trim().slice(0, NOTE_LIMITS.note) };
  }

  return Object.freeze({ handOverNote });
}

/** The model's answer to the note's one call, through the chat model. */
export const writeNoteWith = (model) => async (system, messages) => String(await generateOnce({ model, system, messages }) || "");
