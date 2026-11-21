/**
 * The composer's placeholder while the chat's latest question card is open and waits for the person looking: it
 * invites an answer. Otherwise "", so the shell's own line shows (who can read what's written, chatView.js readersLine).
 * @param {{
 *   messages: Array<import("../../types.js").ChatMessage>,
 *   me?: string
 * }} state the open chat's messages, and the person looking
 */
export function composerPlaceholder({ messages, me = "" }) {
  const open = [...messages].reverse().find((message) => message.kind === "choice");
  if (!open || open.body.chosen || open.body.inactive) return "";
  // A card waiting for someone else is theirs to answer (D-46).
  if (open.body.for && String(open.body.for.id) !== String(me)) return "";
  return open.body.purpose === "bot-name"
    ? "Pick a name above, or say whatever's on your mind"
    : "Pick from the card, or tell me in your own words";
}
