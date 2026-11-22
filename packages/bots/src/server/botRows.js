// Bots, sections and messages as the page sees them, and the person's input cleaned on the way in.
import { plainMentions } from "./mentions.js";
import { BotsError } from "./botsError.js";
import { templateChipOf } from "./botTemplate.js";

/**
 * A bot as the Team page lists it (D-112: a member of the home, as a person is), from a row of records.bots: its look,
 * whether it's the main bot, who made it, its template's chip and whether it has additions of its own (D-98), and since
 * when it's archived (D-108). botList.js adds what depends on who's looking and on the home (isBuilder, madeByName,
 * archivedBy, canArchive).
 * @param {Record<string, any>} row
 */
export function toBot(row) {
  return {
    id: String(row.id),
    name: row.name,
    color: row.color,
    shape: cloudShape(row.shape),
    isMain: Boolean(row.is_main),
    madeBy: row.made_by == null ? null : String(row.made_by),
    // Its template's chip and whether it has additions of its own, with their first line (D-98).
    template: templateChipOf(row),
    ...additionsOf(row),
    // Archived for everyone in the home (D-108): since when, null while it isn't.
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null
  };
}

/** Whether a bot has additions (D-98), and their first line, for its chip's tooltip. */
function additionsOf(row) {
  const text = String(row.additions || "").trim();
  if (!text) return { hasAdditions: false, additionsLine: "" };
  const line = text.split("\n").find((entry) => entry.trim()).trim();
  return { hasAdditions: true, additionsLine: line.length > 120 ? `${line.slice(0, 119)}…` : line };
}

export function toSection(row) {
  return { id: String(row.id), name: row.name, position: row.position, collapsed: Boolean(row.collapsed) };
}

const NAME_LIMIT = 80;

export function cleanName(value) {
  const name = String(value || "").trim().slice(0, NAME_LIMIT);
  if (!name) throw new BotsError(400, "Give it a name first.", { code: "bots_name_missing" });
  return name;
}

/** Whether a value is a record id as an address names one: anything else is no bot, chat or message. */
export const isId = (value) => /^[1-9]\d{0,18}$/u.test(String(value ?? ""));

/**
 * A discussion card's body as it stands now (D-115): a round whose lease has lapsed, because the server running it
 * stopped, reads as interrupted, whatever the card last said.
 * @param {{ status?: string, leaseUntil?: string } & Record<string, unknown>} body
 * @param {number} [now]
 */
export function discussionNow(body, now = Date.now()) {
  return body?.status === "running" && Date.parse(String(body.leaseUntil)) <= now ? { ...body, status: "interrupted" } : body;
}

export function toMessage(row) {
  // The model transcript and a routine run's prompt stay on the server; the page only needs what's shown.
  const { transcript, trigger, recording, ...kept } = row.body || {};
  const body = row.kind === "discussion" ? discussionNow(kept) : kept;
  return {
    id: String(row.id),
    kind: row.kind,
    role: row.role,
    // Who said it (D-112): a person (role "user") or a bot ("bot"); neither for Mercbot's own lines, or once they're gone.
    authorUserId: row.author_user_id == null ? null : String(row.author_user_id),
    authorBotId: row.author_bot_id == null ? null : String(row.author_bot_id),
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
/** The clouds any bot may have: all but Mercbot's own. */
export const CLOUD_SHAPES = Object.freeze([...SHAPES].filter((shape) => shape !== "mercbot"));

function cleanAttachments(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map((file) => ({
    name: String(file?.name || "file").slice(0, 200),
    size: Math.max(0, Number(file?.size) || 0),
    type: String(file?.type || "").slice(0, 100),
    ...(typeof file?.text === "string" ? { text: file.text.slice(0, 200000) } : {}),
    // Where an uploaded file was kept, so the bot can read it now and later: the chat's folder (R6) or the home's.
    ...(/^\/files\/(chat|shared)\/[^\0]{1,400}$/u.test(String(file?.path || "")) ? { path: String(file.path) } : {})
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
  if (row.kind === "discussion") return `Discussion: ${body.question}`;
  return plainText(body.text || body.heading, body.mentions, body.mentionedPeople).slice(0, 200);
}

/** A message as one plain line: mentions of bots and people as names, Markdown symbols and link targets removed. */
export function plainText(text, mentions, mentionedPeople) {
  return plainMentions(String(text || ""), mentions || [], mentionedPeople || [])
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
