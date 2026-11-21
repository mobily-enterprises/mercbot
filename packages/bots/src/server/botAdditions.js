import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { BotsError } from "./botsError.js";

// A bot's additions (D-98, D-95 before them): its own rules on top of its template, for it alone, which instructionsFor
// puts in every reply after the template's, written in the Details panel or by the bot when the person in its chat asks
// and approves the change on a card. The template wins where they differ.

/**
 * The most a bot's additions may hold: as much as one of the person's skills (memoryTools.js save_skill), about ten
 * pages or 5,000 tokens. They're read with every message, so reference material longer than that belongs in the bot's
 * Knowledge (D-107), which searches a long piece when a turn needs it.
 */
export const ADDITIONS_LIMIT = 20000;

/**
 * Whether a person may change a bot's template or additions: the person who made the bot, or the home's owners and
 * admins (the call's own permissions, as a request has them). Renaming is open to everyone in the home; these aren't.
 * @param {string | number} creatorId the bot's maker, `bots.user_id`
 * @param {string | null} personId the call's person
 * @param {{ context?: { permissions?: string[] } }} options the call's options
 */
export function mayChangeBot(creatorId, personId, options) {
  return (Boolean(personId) && String(creatorId) === String(personId)) ||
    hasPermission(options?.context?.permissions || [], "workspace.settings.update");
}

/** The sentence a person who may not change a bot's template or additions is given. */
export const changeRefusal = (botName) =>
  `Only the person who made ${botName} and the home's owners and admins can change its template or additions.`;

/**
 * The column a change of a bot's additions writes: the text, "" for none. Refused, before anything is written, when the
 * text is past ADDITIONS_LIMIT.
 * @param {unknown} value the new text
 */
export function additionsChange(value) {
  const text = String(value ?? "").trim();
  if (text.length > ADDITIONS_LIMIT) {
    const limit = ADDITIONS_LIMIT.toLocaleString("en");
    const length = text.length.toLocaleString("en");
    throw new BotsError(
      400,
      `Additions can be up to ${limit} characters, and these are ${length}. Keep the rules it follows every time here, ` +
        "and put long reference material in its Knowledge, where a long piece is searched when it's needed.",
      { code: "bots_additions_too_long", params: { limit: ADDITIONS_LIMIT, length: text.length } }
    );
  }
  return { additions: text };
}
