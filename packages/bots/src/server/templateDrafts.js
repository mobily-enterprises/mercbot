import { generateOnce } from "@jskit-ai/agent/server";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { BotsError } from "./botsError.js";
import { changeRefusal, mayChangeBot } from "./botAdditions.js";
import { templateOf } from "./botTemplate.js";
import { LIBRARY, LIBRARY_TAGS } from "./templates.js";
import { templateBody, templateProblems } from "../shared/templateBody.js";

// A home's templates made and changed by drafting (D-98, amended 20 November): the bot writes a whole template in one
// billed call, from a sentence ("new"), from a bot ("from-bot") or from the draft on the page and what to change
// ("change"). Nothing is kept: the draft on the page is the only state, and it is saved as a home template only by
// Save and use or Save, which check it whole again (checkedDraft).

/** The most each thing sent to the drafting call may hold. */
export const DRAFT_INPUT_LIMITS = Object.freeze({ describe: 600, request: 2000, summary: 1500, draft: 60000 });

/** The library template the system prompt shows as an example of how Mercbot's own are written. */
const EXAMPLE = "blog-article-desk";

/** A template's five parts as one line of JSON, as the drafting call reads and writes them. */
const asJson = (template) => JSON.stringify({
  tag: template.tag,
  description: template.description,
  greeting: template.greeting || "",
  instructions: template.instructions,
  skills: (template.skills || []).map(({ name, description, instructions }) => ({ name, description, instructions }))
});

/** The first line of the drafting call's instructions, which the stand-in model knows it by. */
export const TEMPLATE_WRITER = "You write bot templates for Mercbot.";

/**
 * The drafting call's system prompt: the same for every call in a home while its tags stay the same, so the provider
 * caches it between calls.
 * @param {Iterable<string>} taken the tags a new template may not take, the library's and the home's
 */
export function draftSystem(taken) {
  return [
    `${TEMPLATE_WRITER} A template is the job a bot does: every bot that uses it follows it, and each bot may add its own ` +
      "additions after it. Answer with one JSON object and nothing else, with exactly these fields:",
    "- \"tag\": one lowercase word naming the job, 2 to 10 letters or digits, starting with a letter (like meals, capt, " +
      `travel). Not one of: ${[...taken].sort().join(", ")}.`,
    "- \"description\": one line of at most 120 characters: what a bot with this template does.",
    "- \"greeting\": the bot's first message to a new person, at most 600 characters, containing {firstName}.",
    "- \"instructions\": at most 8,000 characters, written to the bot (\"You ...\"): what the job is, what to do and what " +
      "not to do, what to report and when, and what to ask before doing. Leave out safety, approvals, accounts and tools: " +
      "Mercbot adds those.",
    "- \"skills\": 1 to 6 skills, each {\"name\" (at most 60 characters), \"description\" (at most 160), \"instructions\" " +
      "(at most 6,000)}. The first is named \"Setup interview\": the questions the bot asks a new person, one at a time, to " +
      "set itself up (which accounts to connect, their preferences, and which routines to offer; routines start paused " +
      "until they say yes).",
    "Keep it general enough for every bot that will use it: nothing about one person, place or account unless the " +
      "request asks for it. Write plainly, as Mercbot's own templates are written. Here is one of them:",
    asJson(LIBRARY.get(EXAMPLE))
  ].join("\n");
}

/** The user message for a new template, from what bots with it will do. @param {string} describe */
export const newDraftPrompt = (describe) => `Write a template for bots that will: ${describe}`;

/**
 * The user message for a template made from a bot: its template now, how its person has used it (the newest summary of
 * their own chat, never anyone else's), its routines' names and schedules, and, folded in, its additions.
 * @param {{
 *   name: string,
 *   template: object | null,
 *   summary: string,
 *   routines: Array<{ name: string, schedule: string }>,
 *   additions?: string
 * }} bot
 */
export function fromBotPrompt({ name, template, summary, routines, additions = "" }) {
  return [
    `Write a template from this bot, ${name}, for every bot that does the same job.`,
    `Its template now: ${template ? asJson(template) : "none yet"}`,
    `How it has been used: ${summary || "nothing yet: its chat has no summary."}`,
    `Its routines: ${routines.map((routine) => `${routine.name} (${routine.schedule})`).join("; ") || "none"}`,
    ...(additions ? [`Its additions, to fold into the template: ${additions}`] : [])
  ].join("\n");
}

/** The user message for a change: the whole draft on the page and what to change in it. */
export const changeDraftPrompt = (draft, request) =>
  `Here is a template: ${asJson(draft)}\nChange it as asked, keeping everything else exactly as it is, and answer with the whole template:\n${request}`;

/** What the second call is told when the first answer couldn't be used. @param {Array<{ field: string, text: string }>} problems */
const retryPrompt = (problems) =>
  `That template can't be used: ${problems.map(({ field, text }) => `${field}: ${text}`).join(" ")} ` +
  "Answer again with the whole template as one JSON object, with these put right.";

/**
 * The model's answer as a draft, and what's wrong with it: an answer that isn't one JSON object is all wrong.
 * @param {unknown} text
 * @param {Set<string>} taken
 */
export function readDraft(text, taken) {
  const words = String(text || "");
  const json = words.slice(words.indexOf("{"), words.lastIndexOf("}") + 1);
  let parsed = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Not JSON: no draft.
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { draft: null, problems: [{ field: "answer", text: "It isn't one JSON object." }] };
  }
  const draft = templateBody(parsed);
  return { draft, problems: templateProblems(draft, { taken }) };
}

/**
 * The tags a home's new or changed template may not take: Mercbot's library's and the home's own, but `except` (the
 * tag of the template being changed).
 * @param {{ tagsOf: (options: object) => Promise<Set<string>> }} homeTemplates records.homeTemplates
 * @param {object} options
 * @param {string | null} [except]
 */
export async function takenTags(homeTemplates, options, except = null) {
  const home = await homeTemplates.tagsOf(options);
  if (except) home.delete(except);
  return new Set([...LIBRARY_TAGS, ...home]);
}

/**
 * A draft a person sends to be kept, checked whole: its five parts and nothing else, whatever else it carries, so a
 * template body from a client is only ever a home template. Refused (422) with its problems at their parts.
 * @param {unknown} value
 * @param {Set<string>} taken
 */
export function checkedDraft(value, taken) {
  const draft = templateBody(value);
  const problems = templateProblems(draft, { taken });
  if (problems.length) {
    throw new BotsError(422, `The template isn't ready to save: ${problems.map(({ field, text }) => `${field}: ${text}`).join(" ")}`, {
      code: "bots_template_draft_invalid",
      params: { problems }
    });
  }
  return draft;
}

/** Whether the call's person is one of the home's owners and admins, who edit and delete its templates. */
export const managesTemplates = (options) => hasPermission(options?.context?.permissions || [], "workspace.settings.update");

/** The refusal for anyone else. */
export const manageRefusal = () =>
  new BotsError(403, "Only the home's owners and admins can change or delete its templates.", { code: "bots_template_manage_forbidden" });

/** What a person typed for the drafting call: refused (400) when empty, saying `missing`, or longer than `max`. */
function typed(value, max, field, missing) {
  const words = String(value ?? "").trim();
  if (!words) throw new BotsError(400, missing, { code: `bots_template_draft_${field}_missing` });
  if (words.length > max) {
    throw new BotsError(400, `That's longer than ${max.toLocaleString("en")} characters. Say it more briefly.`, { code: `bots_template_draft_${field}_too_long` });
  }
  return words;
}

/**
 * Drafting a template (POST …/bots/templates/draft): one call to the chat model, metered and charged like a reply to
 * the home and the person, and to the bot for one made from a bot. An answer that isn't a whole, valid template is asked
 * for once more with its problems (a second billed call); a second such answer is refused.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {(conversationId: string) => Promise<string>} dependencies.summaryOf a conversation's newest summary, "" for none
 * @param {(system: string, messages: Array<{ role: string, content: string }>) => Promise<string>} dependencies.write
 *   the model's answer to one call
 */
export function createTemplateDrafts({ records, conversations, meter, summaryOf, write }) {
  /** The user message and tags for a template made from a sentence. */
  async function fromWords(input, options) {
    const describe = typed(input.describe, DRAFT_INPUT_LIMITS.describe, "describe", "Say in a sentence what bots with this template will do.");
    return { user: newDraftPrompt(describe), taken: await takenTags(records.homeTemplates, options), botId: null };
  }

  /**
   * The user message for a template made from a bot the person may change: its template, its additions only when
   * they're folded in, the newest summary of the person's own chat with it and its routines' names and schedules.
   */
  async function fromBot(input, options) {
    const botId = String(input.botId ?? "");
    if (!/^[1-9]\d{0,18}$/u.test(botId)) throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    const row = await conversations.ownedSingleBot(botId, options);
    if (!mayChangeBot(row.created_by, conversations.personOf(options), options)) {
      throw new BotsError(403, changeRefusal(row.name), { code: "bots_template_forbidden" });
    }
    const template = await templateOf(row, records.homeTemplates, options);
    const routines = await records.work.routinesOf(row.conversation_id, options);
    const user = fromBotPrompt({
      name: row.name,
      template,
      summary: String(await summaryOf(String(row.seat_id)) || "").slice(0, DRAFT_INPUT_LIMITS.summary),
      routines: routines.map((routine) => ({ name: routine.name, schedule: routine.schedule })),
      additions: input.foldAdditions === true ? row.additions || "" : ""
    });
    return { user, taken: await takenTags(records.homeTemplates, options), botId: String(row.id) };
  }

  /** The user message for a change to the draft on the page; for one of the home's templates, its own tag is free. */
  async function fromDraft(input, options) {
    let own = null;
    if (input.templateId !== undefined && input.templateId !== null) {
      if (!managesTemplates(options)) throw manageRefusal();
      own = /^\d+$/u.test(String(input.templateId)) ? await records.homeTemplates.find(String(input.templateId), options) : null;
      if (!own) throw new BotsError(404, "There's no bot template at that link.", { code: "bots_template_not_found" });
    }
    const draft = templateBody(input.draft);
    if (JSON.stringify(draft).length > DRAFT_INPUT_LIMITS.draft) {
      throw new BotsError(400, "That draft is too long to change. Shorten it first.", { code: "bots_template_draft_too_long" });
    }
    const request = typed(input.request, DRAFT_INPUT_LIMITS.request, "request", "Say what to change.");
    return { user: changeDraftPrompt(draft, request), taken: await takenTags(records.homeTemplates, options, own?.tag), botId: null };
  }

  const PURPOSES = Object.freeze({ new: fromWords, "from-bot": fromBot, change: fromDraft });

  /** The model's draft, asked again once with its problems. */
  async function written(system, user, taken) {
    const asked = [{ role: "user", content: user }];
    const first = await write(system, asked);
    const read = readDraft(first, taken);
    if (!read.problems.length) return read;
    const second = readDraft(await write(system, [...asked, { role: "assistant", content: String(first || "") }, { role: "user", content: retryPrompt(read.problems) }]), taken);
    if (!second.problems.length) return second;
    throw new BotsError(422, "Couldn't write a template from that. Try different words.", { code: "bots_template_draft_failed" });
  }

  /**
   * A whole draft, { draft, problems }, for `{ purpose, botId?, describe?, draft?, request?, foldAdditions?, templateId? }`.
   * Nothing is kept.
   * @param {Record<string, unknown>} input
   * @param {object} options the call's options
   */
  async function draftTemplate(input = {}, options) {
    const purpose = PURPOSES[String(input.purpose || "")];
    if (!purpose) throw new BotsError(400, "Say whether this is a new template, one from a bot or a change.", { code: "bots_template_draft_purpose" });
    const { user, taken, botId } = await purpose(input, options);
    // Someone is waiting on it, so it's the chat kind of work, as a reply is (D-59).
    const { draft, problems } = await meter.track({ ...(botId ? { botId } : {}), work: "chat" }, () => written(draftSystem(taken), user, taken));
    return { draft, problems };
  }

  return Object.freeze({ draftTemplate });
}

/** The model's answer to one drafting call, through the chat model. */
export const writeWith = (model) => async (system, messages) => String(await generateOnce({ model, system, messages }) || "");
