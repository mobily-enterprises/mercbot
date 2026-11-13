// A bot added from a template (D-43) opening its conversation. Every method takes the call's options last.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */

/**
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createTemplateRepository({ botMessages }) {
  /**
   * A new bot's first messages, as its conversation opens: unlike conversations.append, they
   * neither mark the conversation unread nor move its activity, as a bot made from a template
   * always opened.
   * @param {{ id: string, conversation_id: string }} row the bot as its person sees it
   * @param {Array<{ kind: string, role: string, body: object }>} list
   * @param {CallOptions} options
   */
  async function openWith(row, list, options) {
    await botMessages.createMany(
      list.map(({ kind, role, body }) => ({ botId: String(row.id), conversationId: String(row.conversation_id), kind, role, body })),
      { ...passedOn(options), returning: "none" }
    );
  }

  return Object.freeze({
    openWith
  });
}
