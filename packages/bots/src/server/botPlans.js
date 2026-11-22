import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "./botsError.js";
import { BOT_PALETTE } from "./botPalette.js";
import { CLOUD_SHAPES } from "./botRows.js";
import { CATEGORIES, GALLERY, GENERAL, LIBRARY, LIBRARY_TAGS, TAG, freeTag, oneLine } from "./templates.js";
import { TEAMS } from "./teams.js";
import { createCallerReaders } from "./records/recordRows.js";

// Suggested bots (D-109): Add bots' "Describe what you need". One billed call to the chat model reads what the person
// wants, the home's bots and its own templates, and answers a plan: Mercbot's library bots first, the home's own
// templates, and new bots only for a job nothing there does, each with why. The server checks the plan and mends what it
// can without asking again (a taken tag gets a free one, a new bot named as a library one becomes it, a look is picked
// fresh); what it can't mend is asked for once more, then refused. Nothing is kept: the plan lives on the screen, the
// new bots' templates are written one call each (templateDrafts.js, plan-bot) and everything is made only when the
// person presses Add (botTeams.js addBots). propose() takes what a chat tool or a first conversation would give it too.

/** The most a plan holds and each thing sent to the planning call may hold. */
export const PLAN_LIMITS = Object.freeze({
  bots: 8,
  new: 4,
  describe: 600,
  change: 600,
  name: 40,
  description: 120,
  why: 200,
  summary: 200,
  question: 300,
  // The home's bots the call is told about, newest first (one page of the bots' resource); past this many it's told
  // there are more.
  homeBots: 100,
  // Past this many, the home's bots are listed by name and tag only.
  homeBotsInFull: 60,
  // The home's own templates the call is told about, by tag; past this many it's told there are more.
  homeTemplates: 40
});

/** The first line of the planning call's instructions, which the stand-in model knows it by. */
export const PLANNER = "You plan which bots a Mercbot home should have.";

const areaName = new Map(CATEGORIES.map((category) => [category.id, category.name]));

/** One line of the catalogue: a library bot as the planner chooses from it. */
function catalogueLine(template) {
  const skills = template.skills.map((skill) => skill.name).filter((name) => name !== "Setup interview").join(", ") || "none";
  const routines = (template.routines || []).map((routine) => routine.name).join(", ") || "none";
  const apps = (template.apps || []).join(", ") || "none";
  return [
    template.slug, template.tag, template.name, areaName.get(template.category) || "", template.description,
    `skills: ${skills}`, `routines: ${routines}`, `apps: ${apps}`, ...(template.appTemplate ? [`its own app: ${template.appTemplate}`] : [])
  ].join(" | ");
}

/**
 * The planning call's system prompt: the same for every home in a release (the library, the teams and the rules), so
 * the provider caches it between calls.
 */
export function planSystem() {
  return [
    `${PLANNER} A home is a family's or a business's shared space; each bot in it does one job for its people, from ` +
      "a template (its instructions and skills). Choose the bots for what the person asks, from Mercbot's library first.",
    "Mercbot's library, one bot per line (slug | tag | name | area | what it does | skills | routines | apps it can use):",
    ...GALLERY.map(catalogueLine),
    `Every home already has a ${GENERAL.name} (${GENERAL.description}); never suggest it.`,
    "Mercbot's ready-made sets, combinations known to work well (name: slugs):",
    ...TEAMS.map((team) => `${team.name}: ${team.templates.join(", ")}`),
    "Rules:",
    "- Prefer a library bot, even when it fits only roughly: each bot can be given its own additions later.",
    "- Use one of the home's own templates (by its id) when it does the job.",
    `- Suggest a new bot only for a job no library bot or home template does. Give it a short friendly name (one or two ` +
      "words, not a library bot's name or one of the home's bots' names), a tag (one lowercase word, 2 to 10 letters or " +
      "digits, starting with a letter, not a library tag or one of the home's) and one line of at most " +
      `${PLAN_LIMITS.description} characters saying what it does.`,
    `- One job per bot. Between 1 and ${PLAN_LIMITS.bots} bots, at most ${PLAN_LIMITS.new} of them new.`,
    "- Never suggest a job one of the home's bots already does: list those bots under \"covered\", with why.",
    "- When the request is too vague to choose well, answer with no bots and one short \"question\" to ask the person.",
    "- Never suggest bots for anything illegal, deceptive or harassing, or for collecting people's data without their " +
      "knowledge: answer with no bots and a \"question\" that says what you can't help with.",
    "Answer with one JSON object and nothing else, like this:",
    JSON.stringify({
      name: "Salon",
      summary: "Bookings, enquiries and supplies for a grooming salon",
      question: null,
      bots: [
        { library: "appointment-bookings", why: "You take appointments." },
        { home: "12", name: "Coat Notes", why: "Your own template keeps each dog's notes." },
        { new: { name: "Rota", tag: "rota", description: "Plans the staff rota each week around holidays and opening hours." }, why: "No library bot plans shifts." }
      ],
      covered: [{ bot: "Kindly", why: "It already answers your reviews." }]
    }),
    `"name" says what the bots are for, as a short title: one to three words, at most ${PLAN_LIMITS.name} characters. ` +
      `"summary" is one line of at most ${PLAN_LIMITS.summary} characters; each "why" one short line, said to the person.`
  ].join("\n");
}

/**
 * The planning call's user message: the home, its bots and own templates, and what the person asked; for a change, the
 * plan before and what to change.
 * @param {{
 *   homeName: string,
 *   shared: boolean,
 *   bots: Array<{ name: string, tag: string, description: string }>,
 *   moreBots: boolean,
 *   homeTemplates: Array<{ id: string, tag: string, description: string }>,
 *   moreTemplates?: boolean,
 *   describe: string,
 *   before?: string,
 *   change?: string
 * }} input
 */
export function planPrompt({ homeName, shared, bots, moreBots, homeTemplates, moreTemplates = false, describe, before = "", change = "" }) {
  const full = bots.length <= PLAN_LIMITS.homeBotsInFull;
  return [
    `The home: ${homeName}, ${shared ? "used by several people" : "used by one person"}.`,
    bots.length
      ? `Its bots now (${full ? "name | tag | what it does" : "name | tag"}):\n${bots.map((bot) => (full ? `- ${bot.name} | ${bot.tag} | ${bot.description}` : `- ${bot.name} | ${bot.tag}`)).join("\n")}${moreBots ? "\n- and more, not listed" : ""}`
      : "It has no bots yet but its main one.",
    homeTemplates.length
      ? `Its own templates (id | tag | what it does):\n${homeTemplates.map((template) => `- ${template.id} | ${template.tag} | ${template.description}`).join("\n")}${moreTemplates ? "\n- and more, not listed" : ""}`
      : "It has no templates of its own.",
    `What the person asked: ${describe}`,
    ...(change ? [`The bots suggested before: ${before || "none"}`, `What to change: ${change}`] : [])
  ].join("\n");
}

/** One line of text, of 1 to `max` characters, or null. */
const lineOf = (value, max) => {
  const line = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  return line && line.length <= max ? line : null;
};
const plain = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/gu, "");
const LIBRARY_BY_NAME = new Map(GALLERY.map((template) => [plain(template.name), template]));

/**
 * The model's answer as a plan, and what's wrong with it: an answer that isn't one JSON object is all wrong. What can be
 * mended is: a new bot named as a library bot becomes it, a bad or taken tag is replaced by a free one made from its
 * name, a library bot named twice is kept once, and a "covered" naming no bot of the home is left out.
 * @param {unknown} text
 * @param {{
 *   homeTemplates: Map<string, { tag: string, description: string }>,
 *   botsByName: Map<string, { id: string, name: string }>,
 *   taken: Set<string>
 * }} home
 */
export function readPlan(text, home) {
  const words = String(text || "");
  let parsed = null;
  try {
    parsed = JSON.parse(words.slice(words.indexOf("{"), words.lastIndexOf("}") + 1));
  } catch {
    // Not JSON: no plan.
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { plan: null, problems: ["The answer isn't one JSON object."] };
  const problems = [];
  const rows = Array.isArray(parsed.bots) ? parsed.bots : [];
  const question = parsed.question == null || parsed.question === "" ? null : lineOf(parsed.question, PLAN_LIMITS.question);
  if (parsed.question && !question) problems.push(`"question": one line of at most ${PLAN_LIMITS.question} characters.`);
  if (!rows.length && !question) problems.push("No bots and no question: suggest at least one bot, or ask one question.");
  if (rows.length > PLAN_LIMITS.bots) problems.push(`${rows.length} bots: suggest at most ${PLAN_LIMITS.bots}.`);
  const taken = new Set(home.taken);
  const names = new Set([...home.botsByName.keys()]);
  const seen = new Set();
  const bots = [];
  for (const [index, row] of rows.entries()) {
    const label = `bots[${index}]`;
    const why = lineOf(row?.why, PLAN_LIMITS.why) || "";
    const newBot = row?.new && typeof row.new === "object" ? row.new : null;
    const same = newBot && LIBRARY_BY_NAME.get(plain(newBot.name || ""));
    const slug = row?.library !== undefined ? String(row.library) : same?.slug;
    if (slug !== undefined) {
      const template = LIBRARY.get(slug);
      if (!template || template === GENERAL) {
        problems.push(`${label}: there's no library bot ${JSON.stringify(slug)}.`);
      } else if (!seen.has(`library:${slug}`)) {
        seen.add(`library:${slug}`);
        bots.push({ library: slug, why });
      }
    } else if (row?.home !== undefined) {
      const id = String(row.home);
      const template = home.homeTemplates.get(id);
      const name = lineOf(row.name, PLAN_LIMITS.name) || (template ? template.tag[0].toUpperCase() + template.tag.slice(1) : "");
      if (!template) {
        problems.push(`${label}: the home has no template ${JSON.stringify(id)}.`);
      } else if (names.has(plain(name)) || LIBRARY_BY_NAME.has(plain(name))) {
        problems.push(`${label}: another bot is called ${name}.`);
      } else if (!seen.has(`home:${id}`)) {
        seen.add(`home:${id}`);
        names.add(plain(name));
        bots.push({ home: id, name, why });
      }
    } else if (newBot) {
      const name = lineOf(newBot.name, PLAN_LIMITS.name);
      const description = lineOf(newBot.description, PLAN_LIMITS.description);
      if (!name) problems.push(`${label}: a new bot's "name", one line of at most ${PLAN_LIMITS.name} characters.`);
      else if (names.has(plain(name))) problems.push(`${label}: another bot is called ${name}.`);
      if (!description) problems.push(`${label}: a new bot's "description", one line of at most ${PLAN_LIMITS.description} characters.`);
      if (!name || !description || names.has(plain(name))) continue;
      const asked = String(newBot.tag || "");
      const tag = TAG.test(asked) && !taken.has(asked) ? asked : freeTag(name, taken);
      taken.add(tag);
      names.add(plain(name));
      bots.push({ new: { name, tag, description }, why });
    } else {
      problems.push(`${label}: one of "library", "home" or "new".`);
    }
  }
  const newCount = bots.filter((bot) => bot.new).length;
  if (newCount > PLAN_LIMITS.new) problems.push(`${newCount} new bots: at most ${PLAN_LIMITS.new}; use library bots for the rest.`);
  const covered = (Array.isArray(parsed.covered) ? parsed.covered : []).flatMap((entry) => {
    const bot = home.botsByName.get(plain(entry?.bot || ""));
    return bot ? [{ botId: bot.id, name: bot.name, why: lineOf(entry.why, PLAN_LIMITS.why) || "" }] : [];
  });
  const plan = {
    name: lineOf(parsed.name, PLAN_LIMITS.name) || "New bots",
    summary: lineOf(parsed.summary, PLAN_LIMITS.summary) || "",
    question: bots.length ? null : question,
    bots,
    covered
  };
  return { plan, problems };
}

/** What the second call is told when the first answer couldn't be used. @param {string[]} problems */
const retryPrompt = (problems) => `That plan can't be used: ${problems.join(" ")} Answer again with the whole plan as one JSON object, with these put right.`;

/**
 * The plan before a change, as the planning call is told it: only what the server knows of each bot, whatever else the
 * screen sent, so a plan from a client is never more than names, tags and lines.
 * @param {unknown} plan
 */
export function planBefore(plan) {
  const rows = Array.isArray(plan?.bots) ? plan.bots.slice(0, PLAN_LIMITS.bots) : [];
  return rows.flatMap((row) => {
    if (row?.library !== undefined) return LIBRARY.has(String(row.library)) ? [`library ${row.library}`] : [];
    if (row?.home !== undefined) return [`home template ${oneLine(row.home, 20)}`];
    const name = oneLine(row?.name, PLAN_LIMITS.name);
    return name ? [`new ${name} (${oneLine(row?.tag, 10)}): ${oneLine(row?.description, PLAN_LIMITS.description)}`] : [];
  }).join("; ");
}

/** What a person typed: refused (400) when empty, saying `missing`, or longer than `max`. */
function typed(value, max, field, missing) {
  const words = String(value ?? "").trim();
  if (!words) throw new BotsError(400, missing, { code: `bots_plan_${field}_missing` });
  if (words.length > max) {
    throw new BotsError(400, `That's longer than ${max.toLocaleString("en")} characters. Say it more briefly.`, { code: `bots_plan_${field}_too_long` });
  }
  return words;
}

/** A random choice from `list`, from those not in `taken` while any are left. */
function pickFresh(list, taken) {
  const fresh = list.filter((entry) => !taken.has(entry));
  const from = fresh.length ? fresh : list;
  return from[Math.floor(Math.random() * from.length)];
}

/**
 * Suggesting bots (POST …/bots/plan): one call to the chat model, metered and charged like a reply to the home and the
 * person, asked once more with its problems when the answer can't be used, then refused (422).
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {{ findById: (workspaceId: string, options: object) => Promise<{ name?: string } | null> }} dependencies.workspaces
 * @param {import("@local/account/server/types").Meter} dependencies.meter
 * @param {(system: string, messages: Array<{ role: string, content: string }>) => Promise<string>} dependencies.write
 *   the model's answer to one call
 */
export function createBotPlans({ records, workspaces, meter, write }) {
  const { chats, newBots, homeTemplates } = records;
  const { homeOf: homeIdOf } = createCallerReaders();

  /** The home as the planner is told it, and what its plan is checked against: a few reads, whatever its size. */
  async function homeOf(options) {
    const [home, people, listed, own] = await Promise.all([
      workspaces.findById(homeIdOf(options), passedOn(options)),
      chats.everyoneIn(options),
      newBots.homeBots(PLAN_LIMITS.homeBots, options),
      homeTemplates.list(options)
    ]);
    const summary = (template) => ({ id: String(template.id), tag: template.tag, description: template.description });
    const every = new Map(own.map((template) => [String(template.id), summary(template)]));
    const templateOf = (bot) =>
      (bot.home_template_id ? every.get(String(bot.home_template_id)) : LIBRARY.get(bot.library_template)) || GENERAL;
    // The first PLAN_LIMITS.homeTemplates by tag are told, and are the ones a plan may use.
    const told = own.slice(0, PLAN_LIMITS.homeTemplates).map(summary);
    return {
      homeName: home?.name || "Home",
      shared: people.length > 1,
      bots: listed.bots.map((bot) => ({ ...bot, tag: templateOf(bot).tag, description: templateOf(bot).description })),
      moreBots: listed.more,
      homeTemplates: told,
      moreTemplates: own.length > told.length,
      templates: new Map(told.map((template) => [template.id, template])),
      botsByName: new Map(listed.bots.map((bot) => [plain(bot.name), { id: String(bot.id), name: bot.name }])),
      taken: new Set([...LIBRARY_TAGS, ...own.map((template) => template.tag)])
    };
  }

  /** The model's plan, asked again once with its problems. */
  async function planned(user, home) {
    const checks = { homeTemplates: home.templates, botsByName: home.botsByName, taken: home.taken };
    const asked = [{ role: "user", content: user }];
    const first = await write(planSystem(), asked);
    const read = readPlan(first, checks);
    if (!read.problems.length) return read.plan;
    const again = [...asked, { role: "assistant", content: String(first || "") }, { role: "user", content: retryPrompt(read.problems) }];
    const second = readPlan(await write(planSystem(), again), checks);
    if (!second.problems.length) return second.plan;
    throw new BotsError(422, "Mercbot couldn't suggest bots from that. Try saying it differently.", { code: "bots_plan_failed" });
  }

  /**
   * The plan as the screen shows it: each bot with its key, name, tag, line and look (a library bot's own; a fresh one,
   * unlike the home's bots' and each other's, for the rest), a library bot's paired app, and whether the home already
   * follows a library bot's template (`inHome`, and `archivedInHome` when all its bots are archived), which the screen
   * leaves unticked. One read.
   */
  async function shown(plan, home, options) {
    const slugs = plan.bots.filter((bot) => bot.library).map((bot) => bot.library);
    const followed = await newBots.followedOf(slugs, options);
    const shapes = new Set(home.bots.map((bot) => bot.shape));
    const colors = new Set(home.bots.map((bot) => String(bot.color || "").toUpperCase()));
    const look = () => {
      const shape = pickFresh(CLOUD_SHAPES, shapes);
      const color = pickFresh(BOT_PALETTE.filter((entry) => entry !== "#000000"), colors);
      shapes.add(shape);
      colors.add(color);
      return { shape, color };
    };
    const bots = plan.bots.map((bot) => {
      if (bot.library) {
        const { slug, name, tag, description, shape, color, appTemplate } = LIBRARY.get(bot.library);
        // As the team screen says it: one whose bots are all archived (D-108) is still in the home.
        const archivedInHome = followed.get(slug) ? { archivedInHome: true } : {};
        const app = appTemplate ? { appTemplate } : {};
        return { key: `library:${slug}`, library: slug, name, tag, description, shape, color, ...app, why: bot.why, inHome: followed.has(slug), ...archivedInHome };
      }
      if (bot.home) {
        const { tag, description } = home.templates.get(bot.home);
        return { key: `home:${bot.home}`, home: bot.home, name: bot.name, tag, description, ...look(), why: bot.why, inHome: false };
      }
      return { key: `new:${bot.new.tag}`, new: true, ...bot.new, ...look(), why: bot.why, inHome: false };
    });
    return { ...plan, bots };
  }

  /**
   * A plan for what the person asked (`describe`), or, with `change`, the plan before (`plan`, as the screen has it)
   * changed as asked: { plan }, with either bots or a question for the person. Nothing is kept.
   * @param {{ describe?: unknown, plan?: unknown, change?: unknown }} input
   * @param {object} options the call's options
   */
  async function propose(input = {}, options) {
    const describe = typed(input.describe, PLAN_LIMITS.describe, "describe", "Say what you need help with.");
    const change = input.change == null || input.change === "" ? "" : typed(input.change, PLAN_LIMITS.change, "change", "Say what to change.");
    const home = await homeOf(options);
    const user = planPrompt({ ...home, describe, before: change ? planBefore(input.plan) : "", change });
    // Someone is waiting on it, so it's the chat kind of work, as a reply is (D-59).
    const plan = await meter.track({ work: "chat" }, () => planned(user, home));
    return { plan: await shown(plan, home, options) };
  }

  return Object.freeze({ propose });
}
