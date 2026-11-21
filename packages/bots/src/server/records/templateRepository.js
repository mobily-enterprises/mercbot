// A bot added from a template (D-43) opening a chat. Every method takes the call's options last.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createTemplateRepository({ messages }) {
  /**
   * A new bot's first messages in a chat, its own (author_bot_id): unlike messages.append, they neither mark the chat
   * unread nor move its activity, as a bot made from a template always opened.
   * @param {{ chatId: string, botId: string }} where
   * @param {Array<{ kind: string, body: object }>} list
   * @param {CallOptions} options
   */
  async function openWith({ chatId, botId }, list, options) {
    if (!list.length) return;
    await messages.createMany(
      list.map(({ kind, body }) => ({ conversationId: String(chatId), authorBotId: String(botId), role: "bot", kind, body })),
      { ...passedOn(options), returning: "none" }
    );
  }

  return Object.freeze({
    openWith
  });
}
