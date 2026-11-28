import { homePath } from "@/components/mercbot/homeApi.js";

// An app's chat with its bot (D-147): when the app offers it, what the chat suggests asking, what goes with a message,
// and the news its button shows.

/**
 * The chats whose messages change, as the home's event stream tells this page (useChatEvents' "messages"): `onNews(chatId)`
 * hears each. Answers the stop.
 * @param {(chatId: string) => void} onNews
 */
export function followChatNews(onNews) {
  const events = new EventSource(homePath("/bot-events"));
  events.addEventListener("messages", (event) => onNews(String(JSON.parse(event.data).chatId)));
  return () => events.close();
}

/**
 * Whether the app's frame offers its chat: a live app (published, not a draft's preview, which has the Builder's chat)
 * with a bot to talk to, never a view, which only shows.
 * @param {{ app?: { kind?: string }, definition?: object | null, bot?: object | null } | null} loaded what the frame read
 * @param {"live" | "draft"} version
 */
export const offersChat = (loaded, version) =>
  Boolean(loaded?.bot && loaded.definition && loaded.app?.kind !== "view" && version === "live");

const size = (value) => {
  const lines = value.split("\n").length;
  if (lines > 1) return `${lines} lines`;
  return `${value.length} ${value.length === 1 ? "character" : "characters"}`;
};
// The most fields the note names; the rest are counted.
const NAMED_FIELDS = 3;

/**
 * What goes with the next message, in one quiet line over the message box (the person, 28 Nov): the screen, the record
 * open and each field with something typed in it, by label and size, never its text: "Sees: Lesson · Doubles · Your
 * answer (12 lines)". "" with nothing to see.
 * @param {ReturnType<typeof import("@local/bots/shared/onScreen").cleanSnapshot>} snapshot
 */
export function seesLine(snapshot) {
  if (!snapshot) return "";
  const record = snapshot.record ? snapshot.record.title || `${snapshot.record.table} #${snapshot.record.id}` : "";
  const typed = snapshot.forms.flatMap((form) => form.fields).filter((field) => field.value !== "").map((field) => `${field.label} (${size(field.value)})`);
  const more = typed.length > NAMED_FIELDS ? ` and ${typed.length - NAMED_FIELDS} more` : "";
  const parts = [snapshot.screen.title, record, ...typed.slice(0, NAMED_FIELDS)].filter(Boolean);
  return `Sees: ${parts.join(" · ")}${more}`;
}

/** The questions shown as chips under the chat: the screen's, while the message box is empty. */
export const chipsFor = (draft, suggestions) => (String(draft || "").trim() ? [] : [...(suggestions || [])]);
