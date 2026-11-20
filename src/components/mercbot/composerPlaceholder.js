import { ownTabOpen } from "./openTabs.js";

/** "A and B", or "A, B, and C". */
function joinNames(names) {
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * The composer's placeholder. In the group picker it names the chosen bots; while a question card is
 * open it invites an answer; in a shared bot's room it says the whole home sees
 * the chat (D-36), and in its "You only" tab that only the person does (D-99). Empty for the default text.
 * @param {{
 *   pickerNames: string[] | null,
 *   messages: Array<import("../../types.js").ChatMessage>,
 *   bot: import("../../types.js").Bot,
 *   homeName: string
 * }} state `pickerNames` is null outside the group picker.
 */
export function composerPlaceholder({ pickerNames, messages, bot, homeName }) {
  if (pickerNames) {
    return pickerNames.length ? `Message ${joinNames(pickerNames)}` : "Write a message";
  }
  const open = [...messages].reverse().find((message) => message.kind === "choice");
  const settled = !open || open.body.chosen || open.body.inactive;
  if (bot.roomId && settled) {
    return ownTabOpen(bot) ? `Message ${bot.name} · only you see this` : `Message ${bot.name} · everyone in ${homeName} sees this`;
  }
  if (settled) return "";
  return open.body.purpose === "bot-name"
    ? "Pick a name above, or say whatever's on your mind"
    : "Pick from the card, or tell me in your own words";
}
