import { firstNameOf } from "./onboarding.js";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "./botsError.js";
import { changeRefusal, mayChangeBot } from "./botAdditions.js";
import { greetingWith, templateOf } from "./botTemplate.js";
import { behaviourFingerprint, lastCheck, readResults, resultsFileFor, testedOn } from "./templateResults.js";
import { CATEGORIES, GALLERY, GENERAL, LIBRARY, LIBRARY_TAGS, TAG, TEAM, details, freeTag, oneLine, setupNeeds, setupSkillOf, summary } from "./templates.js";
import { checkedDraft, manageRefusal, managesTemplates, takenTags } from "./templateDrafts.js";
import { templateBody } from "../shared/templateBody.js";
import { TEAMS, teamSummary } from "./teams.js";
import { cleanName } from "./botRows.js";
import { lookOf } from "./botList.js";
import { createCallerReaders } from "./records/recordRows.js";

/** The templates links open when the copy adds none (`mercbot.template-links` absent): no code opens one. */
export const NO_TEMPLATE_LINKS = Object.freeze({ find: async () => null });

/**
 * Bot templates (D-43, D-98): the gallery, a bot made on a template (New bot) or added from one or from one a link
 * opens, the template a bot points at and its change, and the home's own templates. A new bot is a member of the home
 * (D-112) that greets its maker in their direct chat with it. Every method takes the call's options last: the person
 * and the home are the call's.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {{ findById: (userId: string, options: object) => Promise<object | null> }} dependencies.profiles users.profiles
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env where its end-to-end results are
 * @param {import("./types.js").TemplateLinks} dependencies.templateLinks the templates links open, beside Mercbot's own
 *   (`mercbot.template-links`; NO_TEMPLATE_LINKS when the copy adds none)
 * @param {import("./botList.js").BotList} dependencies.botList new bots made and opened, the
 *   bot as Team lists it, and the home told
 */
export function createBotTemplates({ records, profiles, integrations, env, templateLinks, botList }) {
  // How bots behave, and the day each of Mercbot's templates last passed its end-to-end check for that and for the
  // template as it is now, worked out once at start (D-79).
  const behaviour = behaviourFingerprint();
  const results = readResults(resultsFileFor(env));
  const tested = new Map(GALLERY.map((template) => [template.slug, testedOn(template, results, behaviour)]));
  /** One of Mercbot's templates with its honest tested day, or null; a template a link opens is never tested. */
  const withTested = (template) => (template.linked ? template : { ...template, tested: tested.get(template.slug) ?? null });
  const noTemplate = () => new BotsError(404, "There's no bot template at that link.", { code: "bots_template_not_found" });
  const { bots, chats, messages } = records;
  const { personOf } = createCallerReaders();

  /** The bot template gallery (D-43): curated, Mercbot's own templates only, and its teams of them (D-105). */
  function templateGallery() {
    return {
      categories: CATEGORIES,
      team: TEAM,
      templates: GALLERY.map((template) => summary(withTested(template))),
      teams: TEAMS.map(teamSummary)
    };
  }

  /**
   * Every one of Mercbot's templates with its newest end-to-end check (D-79): how many aren't tested yet for how bots
   * behave now, and for each why, with a failed check's reasons. No route answers it here: the gallery and a template's
   * page carry only the badge, and whoever shows the checks decides who sees them.
   */
  function templateChecks() {
    const templates = GALLERY.map((template) => ({
      slug: template.slug,
      name: template.name,
      tested: tested.get(template.slug) ?? null,
      needs: setupNeeds(template),
      check: lastCheck(template, results, behaviour)
    }));
    return { behaviour, total: templates.length, untested: templates.filter((template) => !template.tested).length, templates };
  }

  /**
   * One template, by its slug or its bot's name (/templates/rapport): one of Mercbot's, or one a link opens, which
   * `templateLinks` finds by the link's code (marked `linked`).
   */
  async function findTemplate(slug, options) {
    const named = String(slug || "").toLowerCase().replace(/[\s_]+/gu, "-");
    const own =
      GALLERY.find((entry) => entry.slug === slug) || GALLERY.find((entry) => entry.name.toLowerCase().replace(/\s+/gu, "-") === named);
    if (own) return own;
    const linked = await templateLinks.find(String(slug || ""), options);
    if (!linked) throw noTemplate();
    return { ...linked, linked: true };
  }

  /** A template's page: anyone may read it, signed in or not (its options may name no one). */
  async function templateDetails(slug, options) {
    return details(withTested(await findTemplate(slug, options)), integrations.app);
  }

  /**
   * The name a template's greeting greets the person by: their first name, never an account handle ("Samrivera" from
   * samrivera@…), or with no real name "". One read of the person, however many greetings it goes in.
   * @param {string} displayName
   * @param {object} options the call's options
   */
  async function firstNameFor(displayName, options) {
    const person = await profiles.findById(personOf(options), passedOn(options));
    const first = firstNameOf(person?.displayName || displayName || "");
    const handle = String(person?.email || "").split("@")[0].replace(/[^a-z]/giu, "").toLowerCase();
    return first && first.toLowerCase().replace(/[^a-z]/giu, "") !== handle ? first : "";
  }

  /** A template's greeting for the person (greetingWith), their name read (firstNameFor). */
  async function greetingFor(template, botName, displayName, options) {
    if (!template.greeting) return "";
    return greetingWith(template, botName, await firstNameFor(displayName, options));
  }

  /**
   * A home template made from a template a link opens (D-98): its job, skills and greeting, its description in a line,
   * and its tag, or one from its name, made free of Mercbot's library's and the home's.
   */
  async function homeTemplateFrom(linked, txOptions) {
    const taken = new Set([...LIBRARY_TAGS, ...(await records.homeTemplates.tagsOf(txOptions))]);
    return records.homeTemplates.create({
      tag: freeTag(TAG.test(String(linked.tag || "")) ? linked.tag : linked.name, taken),
      description: oneLine(linked.description || `${linked.name}, from a shared link.`, 120),
      instructions: String(linked.instructions || "").trim(),
      skills: Array.isArray(linked.skills) ? linked.skills : [],
      greeting: linked.greeting || null,
      created_by: personOf(txOptions)
    }, txOptions);
  }

  /**
   * Adding a bot from a template or a shared link (D-98): it takes the template's name and look and points at it, one of
   * Mercbot's library, or for a link a new template of the person's home made from it, and greets the person in their
   * direct chat with it. Its routines aren't copied: its setup interview creates them, paused, once the person agrees.
   * Answers the bot as Team lists it.
   */
  async function addFromTemplate(slug, displayName, options) {
    const template = await findTemplate(slug, options);
    const name = cleanName(template.name);
    const words = template.greeting || `Hi {firstName}, I'm ${template.name}. ${template.description}`;
    const greeting = await greetingFor({ ...template, greeting: words }, name, displayName, options);
    // A lost race (the direct chat, or a link's tag) runs the whole transaction again.
    const made = await retryLostInsertRace(passedOn(options), () => chats.withTransaction(passedOn(options), async (txOptions) => {
      const pointer = template.linked
        ? { home_template_id: (await homeTemplateFrom(template, txOptions)).id }
        : { library_template: template.slug };
      const start = { columns: { ...pointer, template_since: new Date().toISOString() }, greeting };
      const [bot] = await botList.makeBots([{ name, shape: template.shape, color: template.color, start }], txOptions);
      await botList.openWith(bot, greeting, txOptions);
      return bot;
    }));
    await botList.tellHome([made.id], "created", options);
    return botList.listedBot(String(made.id), options);
  }

  /**
   * New bot: one bot on the template chosen in New bot (`template`: `{ library: slug }`, `{ home: id }` or `{ draft }`,
   * a new one of the home's; D-98), or with none chosen on Mercbot's general one, greeting its maker in their direct
   * chat with it, which the page opens next (POST …/bots/:botId/direct). Answers the bot as Team lists it.
   */
  async function createBot(input = {}, options) {
    const look = lookOf(input);
    // A new template's tag lost to a race runs the whole transaction again.
    const made = await retryLostInsertRace(passedOn(options), () => chats.withTransaction(passedOn(options), async (txOptions) => {
      const start = await startOn({ choice: input.template ?? { library: GENERAL.slug }, botName: look.name }, txOptions);
      const [bot] = await botList.makeBots([{ ...look, start }], txOptions);
      await botList.openWith(bot, start.greeting, txOptions);
      return bot;
    }));
    await botList.tellHome([made.id], "created", options);
    return botList.listedBot(String(made.id), options);
  }

  /**
   * A draft kept as a new template of the caller's home (D-98): checked whole, its tag free of the library's and the
   * home's, and only its five parts taken, whatever else it was sent with.
   */
  async function saveDraft(draft, options) {
    const body = checkedDraft(draft, await takenTags(records.homeTemplates, options));
    return records.homeTemplates.create({ ...body, created_by: personOf(options) }, options);
  }

  /**
   * The template columns a choice points a bot at: `{ library: slug }`, one of Mercbot's library, `{ home: id }`, one
   * of the caller's home's own (another home's is none), or `{ draft }`, a new one of the home's, made from it. A
   * template body from the caller is only ever a home template, never one of Mercbot's library.
   */
  async function pointerTo(choice, options) {
    const given = ["library", "home", "draft"].filter((key) => choice?.[key] !== undefined);
    if (given.length > 1) throw new BotsError(400, "Choose one template.", { code: "bots_template_two_choices" });
    if (choice?.draft !== undefined) {
      const made = await saveDraft(choice.draft, options);
      return { library_template: null, home_template_id: String(made.id) };
    }
    if (choice?.library !== undefined) {
      const template = LIBRARY.get(String(choice.library));
      if (!template) throw noTemplate();
      return { library_template: template.slug, home_template_id: null };
    }
    if (choice?.home !== undefined) {
      const template = /^\d+$/u.test(String(choice.home)) ? await records.homeTemplates.find(String(choice.home), options) : null;
      if (!template) throw noTemplate();
      return { library_template: null, home_template_id: String(template.id) };
    }
    throw new BotsError(400, "Choose a template.", { code: "bots_template_missing_choice" });
  }

  /**
   * What a bot New bot makes on a chosen template starts with (D-98): the columns pointing it at the template, and the
   * greeting it opens with, which asks the template's setup questions; none for Mercbot's general template, whose bot
   * starts with its own short introduction (onboarding.js) when the person first opens it. `firstName`, when the caller
   * has read it (firstNameFor: a team's bots greet one person), saves reading the person again (D-105).
   * @param {{ choice: { library?: string, home?: string, draft?: object }, botName: string, firstName?: string }} start
   * @param {object} options the call's options, in the bot's transaction
   */
  async function startOn({ choice, botName, firstName }, options) {
    const pointer = await pointerTo(choice, options);
    const columns = { ...pointer, template_since: new Date().toISOString() };
    if (pointer.library_template === GENERAL.slug) return { columns, greeting: "" };
    const template = await templateOf({ name: botName, ...pointer }, records.homeTemplates, options);
    const words = template.greeting || `Hi {firstName}, I'm ${botName}. ${template.description}`;
    const first = firstName ?? (await firstNameFor("", options));
    return { columns, greeting: greetingWith({ ...template, greeting: words }, botName, first) };
  }

  /**
   * Change template (D-98): the bot points at another template and keeps its additions, which now sit under it, or for
   * a new template drafted from it with them folded in (`foldAdditions`), has them emptied. Its maker and the home's
   * owners and admins change it. The bot says so in the changer's direct chat with it, and greets there with the new
   * template's greeting, which asks its setup questions; its routines stay as they are. Everyone in the home hears the
   * bot changed. Answers the bot as Team lists it.
   */
  async function changeTemplate(botId, choice, displayName, options) {
    // A new template's lost race for its tag runs it again, when the tag is then taken.
    const run = (work) => retryLostInsertRace(passedOn(options), () => chats.withTransaction(passedOn(options), work));
    const changed = await run(async (txOptions) => {
      const before = await bots.get(botId, txOptions);
      if (!mayChangeBot(before.made_by, personOf(txOptions), txOptions)) {
        throw new BotsError(403, changeRefusal(before.name), { code: "bots_template_forbidden" });
      }
      const pointer = await pointerTo(choice, txOptions);
      const same = pointer.library_template
        ? pointer.library_template === before.library_template
        : String(pointer.home_template_id) === String(before.home_template_id || "");
      if (same) return false;
      const folded = choice.draft !== undefined && choice.foldAdditions === true ? { additions: "" } : {};
      await bots.update(before.id, { ...pointer, ...folded, template_since: new Date().toISOString() }, txOptions);
      const after = await bots.get(before.id, txOptions);
      const template = await templateOf(after, records.homeTemplates, txOptions);
      const where = template.source === "library" ? "Mercbot's" : "your home's";
      const greeting = await greetingFor(template, after.name, displayName, txOptions);
      const chat = await chats.direct(after.id, txOptions);
      await messages.append(chat.id, [
        {
          kind: "event",
          role: "system",
          body: {
            text: `Now a ${template.tag} bot`,
            detail: `${after.name} now follows ${where} ${template.tag} template${after.additions ? ", with its own additions on top" : ""}.`
          }
        },
        ...(greeting ? [{ kind: "text", role: "bot", authorBotId: String(after.id), body: { text: greeting } }] : [])
      ], txOptions);
      return true;
    });
    if (changed) await botList.tellHome([String(botId)], "changed", options);
    return botList.listedBot(String(botId), options);
  }

  /**
   * A bot's Instructions in its Details panel (D-98): its template in full and read-only, where it's from, its Tested
   * day for one of Mercbot's, and the newest change since the bot started to use it; its additions; and whether the
   * person may change either.
   */
  async function instructionsOf(botId, options) {
    const row = await bots.get(botId, options);
    const template = await templateOf(row, records.homeTemplates, options);
    return {
      template: template && {
        source: template.source,
        ...(template.source === "library" ? { slug: template.slug, name: template.name } : { id: template.id }),
        tag: template.tag,
        description: template.description,
        instructions: template.instructions,
        skills: template.skills.map(({ name, description }) => ({ name, description })),
        tested: template.source === "library" ? tested.get(template.slug) ?? null : null,
        changed: await changedSince(template, row.template_since, options)
      },
      additions: row.additions || "",
      canChange: mayChangeBot(row.made_by, personOf(options), options)
    };
  }

  /** A template's newest change after `since` (when the bot started to use it), as { date, text }, or null. */
  async function changedSince(template, since, options) {
    const after = since ? new Date(since) : null;
    if (template.source === "library") {
      const change = template.changes[0];
      return change && (!after || change.date >= after.toISOString().slice(0, 10)) ? { date: change.date, text: change.text } : null;
    }
    const change = await records.homeTemplates.newestChangeAfter(template.id, after, options);
    return change ? { date: new Date(change.changed_at).toISOString(), text: change.summary } : null;
  }

  /** One of the home's templates as its list shows it, used by `usedBy` of its bots. */
  const listed = (template, usedBy) => ({
    id: String(template.id),
    tag: template.tag,
    description: template.description,
    usedBy,
    updatedAt: new Date(template.updated_at).toISOString()
  });

  /**
   * The home's own templates (D-98), by tag, for everyone in it: each one's description and how many of the home's bots
   * use it (one aggregate however many there are), and whether the person may edit and delete them.
   */
  async function homeTemplates(options) {
    const list = await records.homeTemplates.list(options);
    const used = await records.homeTemplates.usedBy(list.map((template) => template.id), options);
    const templates = list.map((template) => listed(template, used.get(String(template.id)) || 0));
    return { templates, canManage: managesTemplates(options) };
  }

  /** One of the home's templates by its id from a request, or 404: another home's is none. */
  async function ownTemplate(templateId, options, { lock = false } = {}) {
    const id = String(templateId ?? "");
    const read = lock ? records.homeTemplates.lock : records.homeTemplates.find;
    const template = /^[1-9]\d{0,18}$/u.test(id) ? await read(id, options) : null;
    if (!template) throw noTemplate();
    return template;
  }

  /**
   * One of the home's templates in full, for everyone in it: what a bot pointing at it follows, all its parts, as
   * Settings → Templates → Edit starts from.
   */
  async function homeTemplate(templateId, options) {
    const template = await ownTemplate(templateId, options);
    const used = await records.homeTemplates.usedBy([template.id], options);
    return {
      ...listed(template, used.get(String(template.id)) || 0),
      greeting: template.greeting || "",
      instructions: template.instructions,
      skills: (template.skills || []).map(({ name, description, instructions }) => ({ name, description, instructions }))
    };
  }

  /**
   * What an edit changed, in the words of its "what changed" line: the tag, the description, the greeting, the
   * instructions, the setup questions and the other skills.
   */
  function changedParts(stored, after) {
    // Both as bodies, so a skill's parts compare in one order whatever order its stored JSON keeps them in.
    const before = templateBody(stored);
    const setup = (template) => JSON.stringify(setupSkillOf(template) ?? null);
    const others = (template) => JSON.stringify(template.skills.filter((skill) => skill !== setupSkillOf(template)));
    return [
      ["tag", before.tag !== after.tag],
      ["description", before.description !== after.description],
      ["greeting", before.greeting !== after.greeting],
      ["instructions", before.instructions !== after.instructions],
      ["setup questions", setup(before) !== setup(after)],
      ["other skills", others(before) !== others(after)]
    ].filter(([, changed]) => changed).map(([part]) => part);
  }

  /** "Instructions and setup questions changed by Ada", as each bot using the template shows it, dated. */
  function changeLine(parts, who) {
    const named = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    return `${named.charAt(0).toUpperCase()}${named.slice(1)} changed by ${who}`.slice(0, 200);
  }

  /**
   * Settings → Templates → Edit → Save (D-98): the home's owners and admins change one of its templates, checked whole,
   * while it is still as they opened it (`updatedAt`; 409 if someone saved since). Every bot using it follows the change
   * from its next reply, and a `home_template_changes` line says what changed and who changed it.
   * @param {string} templateId
   * @param {{ draft?: object, updatedAt?: string }} edit
   * @param {object} options
   */
  async function editHomeTemplate(templateId, { draft, updatedAt } = {}, options) {
    if (!managesTemplates(options)) throw manageRefusal();
    // A lost race for a tag (the home's unique tags) runs it again, when the tag is then taken.
    return retryLostInsertRace(passedOn(options), () => chats.withTransaction(passedOn(options), async (txOptions) => {
      const before = await ownTemplate(templateId, txOptions, { lock: true });
      if (new Date(before.updated_at).toISOString() !== String(updatedAt)) {
        throw new BotsError(409, `Someone saved ${before.tag} since you opened it. Open it again to see their changes.`, { code: "bots_template_stale" });
      }
      const body = checkedDraft(draft, await takenTags(records.homeTemplates, txOptions, before.tag));
      const parts = changedParts(before, body);
      let after = before;
      if (parts.length) {
        const now = new Date().toISOString();
        const person = personOf(txOptions);
        const name = (await profiles.findById(person, passedOn(txOptions)))?.displayName || "someone";
        after = await records.homeTemplates.update(before.id, { ...body, updated_at: now }, txOptions);
        const change = { summary: changeLine(parts, name), changed_by: person, changed_at: now };
        await records.homeTemplates.addChange(before.id, change, txOptions);
      }
      const used = await records.homeTemplates.usedBy([before.id], txOptions);
      return { template: listed(after, used.get(String(before.id)) || 0), changed: parts };
    }));
  }

  /**
   * Settings → Templates → Delete (D-98): the home's owners and admins delete one of its templates that no bot uses
   * (409 while one does, which the bots' foreign key, ON DELETE RESTRICT, backs), with what changed in it.
   */
  async function deleteHomeTemplate(templateId, options) {
    if (!managesTemplates(options)) throw manageRefusal();
    const inUse = (tag, count) =>
      new BotsError(409, `${count === 1 ? "A bot uses" : `${count} bots use`} ${tag}. Change their template first.`, {
        code: "bots_template_in_use",
        params: { usedBy: count }
      });
    return chats.withTransaction(passedOn(options), async (txOptions) => {
      const template = await ownTemplate(templateId, txOptions, { lock: true });
      const count = (await records.homeTemplates.usedBy([template.id], txOptions)).get(String(template.id)) || 0;
      if (count) throw inUse(template.tag, count);
      try {
        await records.homeTemplates.remove(template.id, txOptions);
      } catch (error) {
        // A bot pointed at it after the count (PostgreSQL's foreign key violation).
        if (error?.code === "23503" || error?.cause?.code === "23503") throw inUse(template.tag, 1);
        throw error;
      }
      return { deleted: String(template.id) };
    });
  }

  return Object.freeze({
    templateGallery,
    templateChecks,
    templateDetails,
    firstNameFor,
    addFromTemplate,
    createBot,
    changeTemplate,
    instructionsOf,
    startOn,
    homeTemplates,
    homeTemplate,
    editHomeTemplate,
    deleteHomeTemplate
  });
}
