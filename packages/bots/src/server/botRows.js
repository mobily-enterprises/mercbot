// Bots, rooms, sections and messages as the page sees them, and the person's input cleaned on the way in.
import { plainMentions } from "./mentions.js";
import { BotsError } from "./botsError.js";

export function toBot(row) {
  return {
    id: String(row.id),
    kind: row.kind || "bot",
    name: row.name,
    color: row.color,
    shape: cloudShape(row.shape),
    onboardingStep: row.onboarding_step || null,
    waitingTask: row.waiting_task || "",
    label: row.label || "",
    isMain: Boolean(row.is_main),
    pinPosition: row.pin_position ?? null,
    sectionId: row.section_id ? String(row.section_id) : null,
    hidden: Boolean(row.hidden),
    unread: Boolean(row.unread),
    readUpTo: row.read_up_to ? String(row.read_up_to) : null,
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    sharing: row.sharing || "mixed",
    keepOutOfNotebook: Boolean(row.keep_out_of_notebook),
    // Where it came from, when it was added from a template or a shared link (D-43).
    origin: row.origin || null,
    // A shared bot's open tab (D-36); its tabs come with the list of bots.
    roomId: row.room ? String(row.room.id) : null
  };
}

/** A shared bot's public conversation, as a tab (D-36). */
export function toRoom(row) {
  return {
    id: String(row.id),
    title: row.title,
    parentId: row.parent_id ? String(row.parent_id) : null,
    lastActivityAt: new Date(row.last_activity_at).toISOString()
  };
}

export function toSection(row) {
  return { id: String(row.id), name: row.name, position: row.position, collapsed: Boolean(row.collapsed) };
}

const NAME_LIMIT = 80;

/** A shared bot's tab name (D-36): required, short enough to read in a row of tabs. */
export function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/gu, " ").trim().slice(0, 40);
  if (!title) throw new BotsError(400, "Give the conversation a name.", { code: "bots_conversation_name_missing" });
  return title;
}

export function cleanName(value) {
  const name = String(value || "").trim().slice(0, NAME_LIMIT);
  if (!name) throw new BotsError(400, "Give it a name first.", { code: "bots_name_missing" });
  return name;
}

export function toMessage(row) {
  // The model transcript and a routine run's prompt stay on the server; the page only needs what's shown.
  const { transcript, trigger, recording, ...body } = row.body || {};
  return {
    id: String(row.id),
    kind: row.kind,
    role: row.role,
    body,
    createdAt: new Date(row.created_at).toISOString()
  };
}

/**
 * A message as the bot reads it: like toMessage, but a reply keeps its transcript (its tool calls
 * and results) and a routine run the prompt that started it.
 */
export function toHistoryMessage(row) {
  const { recording, ...body } = row.body || {};
  return { ...toMessage(row), body };
}

// Every bot is a cloud (D-44); "cloud" is the plain cumulus every fallback uses, and "mercbot" is
// Mercbot's own cloud, always in its orange.
const SHAPES = new Set([
  "cloud", "clover", "stratus", "tower", "wisp", "storm", "heart", "rain",
  "tuft", "cluster", "lopsided", "trefoil", "thought", "billow",
  "thunderstorm", "doublebolt", "downpour", "drizzle", "windy", "blower", "snow",
  "hail", "sleet", "fog", "rainbow", "sunny", "night", "tornado", "mercbot"
]);
export const cloudShape = (shape) => (SHAPES.has(shape) ? shape : "cloud");

function cleanAttachments(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map((file) => ({
    name: String(file?.name || "file").slice(0, 200),
    size: Math.max(0, Number(file?.size) || 0),
    type: String(file?.type || "").slice(0, 100),
    ...(typeof file?.text === "string" ? { text: file.text.slice(0, 200000) } : {}),
    // Where an uploaded file was kept, so the bot can read it now and later.
    ...(/^\/files\/(mine|shared)\/[^\0]{1,400}$/u.test(String(file?.path || "")) ? { path: String(file.path) } : {})
  }));
}

export function previewOf(row) {
  const body = row.body || {};
  if (row.kind === "choice") return body.question || "";
  if (row.kind === "connect") return `Connect ${body.app}`;
  if (row.kind === "handover") return body.task;
  if (row.kind === "files") return body.files.map((file) => file.name).join(", ");
  if (row.kind === "page") return body.title;
  if (row.kind === "view") return `View: ${body.title}`;
  if (row.kind === "chart") return `Chart: ${body.title}`;
  if (row.kind === "pictures") return `Picture: ${body.images[0]?.title || ""}`;
  if (row.kind === "voice") return "Voice memo";
  if (row.kind === "draft") return `Draft to ${body.to}`;
  if (row.kind === "todos") {
    return `To-do: ${(body.items || []).filter((item) => item.status === "done").length} of ${(body.items || []).length} done`;
  }
  if (row.kind === "bot_request") {
    return body.side === "asker" ? `Asked ${body.other?.name}: ${body.brief}` : `From ${body.other?.name}: ${body.brief}`;
  }
  return plainText(body.text || body.heading, body.mentions).slice(0, 200);
}

/** A message as one plain line: mentions as names, Markdown symbols and link targets removed. */
export function plainText(text, mentions) {
  return plainMentions(String(text || ""), mentions || [])
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[*_`#>]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Sending stores the user's message straight away; the reply is a separate step. */
export function messageBody(input) {
  const trimmed = String(input.text || "").trim();
  const quotes = (Array.isArray(input.quotes) ? input.quotes : []).map((quote) => String(quote).slice(0, 4000)).slice(0, 5);
  const attachments = cleanAttachments(input.attachments);
  if (!trimmed && !quotes.length && !attachments.length) throw new BotsError(400, "Write a message first.", { code: "bots_message_empty" });
  if (trimmed.length > 8000) throw new BotsError(400, "That message is too long.", { code: "bots_message_too_long" });
  const body = { text: trimmed };
  if (quotes.length) body.quotes = quotes;
  if (attachments.length) body.attachments = attachments;
  return body;
}
