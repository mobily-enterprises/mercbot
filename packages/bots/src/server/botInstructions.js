import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { BotsError } from "./botsError.js";

// A bot's own instructions (D-95): the always-on rules instructionsFor puts in every reply, written in the Details
// panel or by the bot when the person in its chat asks and approves the change on a card.

/**
 * The most a bot's instructions may hold: as much as one of the person's skills (memoryTools.js save_skill), about ten
 * pages or 5,000 tokens. They're read with every message, so reference material longer than that belongs in a skill
 * or a file the bot reads only when a job needs it.
 */
export const INSTRUCTIONS_LIMIT = 20000;

/**
 * Whether a person may change a bot's instructions: the person who made the bot, or the home's owners and admins (the
 * call's own permissions, as a request has them). Renaming and labels are open to everyone in the home; these aren't.
 * @param {string | number} creatorId the bot's maker, `bots.user_id`
 * @param {string | null} personId the call's person
 * @param {{ context?: { permissions?: string[] } }} options the call's options
 */
export function mayChangeInstructions(creatorId, personId, options) {
  return (Boolean(personId) && String(creatorId) === String(personId)) ||
    hasPermission(options?.context?.permissions || [], "workspace.settings.update");
}

/** The sentence a person who may not change a bot's instructions is given. */
export const changeRefusal = (botName) =>
  `Only the person who made ${botName} and the home's owners and admins can change its instructions.`;

/**
 * The columns a change of a bot's instructions writes: the text, or null for none (as a bot made from scratch has), and
 * for a bot added from a template, in its origin, that its instructions are no longer the template's. Refused, before
 * anything is written, when the text is past INSTRUCTIONS_LIMIT.
 * @param {{ instructions?: string | null, origin?: object | null }} bot the bot as stored
 * @param {unknown} value the new text
 */
export function instructionsChange(bot, value) {
  const text = String(value ?? "").trim();
  if (text.length > INSTRUCTIONS_LIMIT) {
    const limit = INSTRUCTIONS_LIMIT.toLocaleString("en");
    const length = text.length.toLocaleString("en");
    throw new BotsError(
      400,
      `Instructions can be up to ${limit} characters, and these are ${length}. Keep the rules it follows every time here, ` +
        "and put long reference material in a skill or a file it reads when it needs it.",
      { code: "bots_instructions_too_long", params: { limit: INSTRUCTIONS_LIMIT, length: text.length } }
    );
  }
  const changed = text !== String(bot.instructions || "");
  return {
    instructions: text || null,
    ...(changed && bot.origin && !bot.origin.instructionsChanged ? { origin: { ...bot.origin, instructionsChanged: true } } : {})
  };
}
