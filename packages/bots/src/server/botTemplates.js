import { firstNameOf } from "./onboarding.js";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "./botsError.js";
import { changeRefusal, mayChangeBot } from "./botAdditions.js";
import { templateOf } from "./botTemplate.js";
import { behaviourFingerprint, lastCheck, readResults, resultsFileFor, testedOn } from "./templateResults.js";
import { CATEGORIES, GALLERY, LIBRARY, LIBRARY_TAGS, TAG, TEAM, details, freeTag, oneLine, setupNeeds, summary } from "./templates.js";
import { cleanName, toBot } from "./botRows.js";

/** The templates links open when the copy adds none (`mercbot.template-links` absent): no code opens one. */
export const NO_TEMPLATE_LINKS = Object.freeze({ find: async () => null });

/**
 * Bot templates (D-43, D-98): the gallery, a bot added from a template or from one a link opens, the template a bot
 * points at and its change, and the home's own templates. Every method takes the call's options last: the person and
 * the home are the call's.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {{ findById: (userId: string, options: object) => Promise<object | null> }} dependencies.profiles users.profiles
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env where its end-to-end results are
 * @param {import("./types.js").TemplateLinks} dependencies.templateLinks the templates links open, beside Mercbot's own
 *   (`mercbot.template-links`; NO_TEMPLATE_LINKS when the copy adds none)
 */
export function createBotTemplates({ records, profiles, integrations, conversations, env, templateLinks }) {
  // How bots behave, and the day each of Mercbot's templates last passed its end-to-end check for that and for the
  // template as it is now, worked out once at start (D-79).
  const behaviour = behaviourFingerprint();
  const results = readResults(resultsFileFor(env));
  const tested = new Map(GALLERY.map((template) => [template.slug, testedOn(template, results, behaviour)]));
  /** One of Mercbot's templates with its honest tested day, or null; a template a link opens is never tested. */
  const withTested = (template) => (template.linked ? template : { ...template, tested: tested.get(template.slug) ?? null });
  const noTemplate = () => new BotsError(404, "There's no bot template at that link.", { code: "bots_template_not_found" });
  const store = records.conversations;

  /** The bot template gallery (D-43): curated, Mercbot's own templates only. */
  function templateGallery() {
    return { categories: CATEGORIES, team: TEAM, templates: GALLERY.map((template) => summary(withTested(template))) };
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
   * A template's greeting for the person, from the bot it now runs as: their first name, never an account handle
   * ("Samrivera" from samrivera@…), or with no real name none; and the bot's own name where the template says its own.
   * A template without one has none.
   */
  async function greetingFor(template, botName, displayName, options) {
    if (!template.greeting) return "";
    const person = await profiles.findById(conversations.personOf(options), passedOn(options));
    const first = firstNameOf(person?.displayName || displayName || "");
    const handle = String(person?.email || "").split("@")[0].replace(/[^a-z]/giu, "").toLowerCase();
    const real = first && first.toLowerCase().replace(/[^a-z]/giu, "") !== handle ? first : "";
    const named = template.greeting.replaceAll(`I'm ${template.name}`, `I'm ${botName}`);
    return real ? named.replaceAll("{firstName}", real) : named.replace(/\s*\{firstName\}/gu, "");
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
      created_by: conversations.personOf(txOptions)
    }, txOptions);
  }

  /**
   * Adding a bot from a template or a shared link (D-98): it takes the template's name and look and points at it, one of
   * Mercbot's library, or for a link a new template of the person's home made from it, and opens with the template's
   * own greeting. Its routines aren't copied: its setup interview creates them, paused, once the person agrees.
   */
  async function addFromTemplate(slug, displayName, options) {
    const template = await findTemplate(slug, options);
    const name = cleanName(template.name);
    const words = template.greeting || `Hi {firstName}, I'm ${template.name}. ${template.description}`;
    const greeting = await greetingFor({ ...template, greeting: words }, name, displayName, options);
    // The person's seat is read, then made: a lost race (the seat, or a link's tag) runs the whole transaction again.
    return retryLostInsertRace(passedOn(options), () => records.conversations.withTransaction(passedOn(options), async (txOptions) => {
      const pointer = template.linked
        ? { home_template_id: (await homeTemplateFrom(template, txOptions)).id }
        : { library_template: template.slug };
      const bot = await records.conversations.createBot({
        user_id: conversations.personOf(txOptions),
        name,
        shape: template.shape,
        color: template.color,
        ...pointer,
        template_since: new Date().toISOString()
      }, txOptions);
      const row = conversations.asSeen(bot, await conversations.conversationOf(bot, txOptions, { onboarding_step: null }));
      await records.templates.openWith(row, [
        { kind: "timestamp", role: "system", body: { at: new Date().toISOString() } },
        { kind: "text", role: "bot", body: { text: greeting } }
      ], txOptions);
      return { ...toBot(row), preview: greeting };
    }));
  }

  /**
   * The template columns a choice points a bot at: `{ library: slug }`, one of Mercbot's library, or `{ home: id }`, one
   * of the caller's home's own (another home's is none). A template's body is never taken from the caller.
   */
  async function pointerTo(choice, options) {
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
   * Change template (D-98): the bot points at another template and keeps its additions, which now sit under it. Its
   * maker and the home's owners and admins change it. The bot says so in its chat and greets with the new template's
   * greeting, which asks its setup questions; its routines stay as they are.
   */
  async function changeTemplate(botId, choice, displayName, options) {
    const { row, changed } = await store.withTransaction(passedOn(options), async (txOptions) => {
      const before = await conversations.ownedBot(botId, txOptions, { lock: true });
      if (before.kind === "group") throw new BotsError(400, "A group chat has no template.", { code: "bots_group_template" });
      if (!mayChangeBot(before.created_by, conversations.personOf(txOptions), txOptions)) {
        throw new BotsError(403, changeRefusal(before.name), { code: "bots_template_forbidden" });
      }
      const pointer = await pointerTo(choice, txOptions);
      const same = pointer.library_template
        ? pointer.library_template === before.library_template
        : String(pointer.home_template_id) === String(before.home_template_id || "");
      if (same) return { row: before, changed: false };
      await store.updateBot(before.id, { ...pointer, template_since: new Date().toISOString() }, txOptions);
      const after = await conversations.refresh(before, txOptions);
      const template = await templateOf(after, records.homeTemplates, txOptions);
      const where = template.source === "library" ? "Mercbot's" : "your home's";
      const greeting = await greetingFor(template, after.name, displayName, txOptions);
      await conversations.append(after, [
        {
          kind: "event",
          role: "system",
          body: {
            text: `Now a ${template.tag} bot`,
            detail: `${after.name} now follows ${where} ${template.tag} template${after.additions ? ", with its own additions on top" : ""}.`
          }
        },
        ...(greeting ? [{ kind: "text", role: "bot", body: { text: greeting } }] : [])
      ], txOptions);
      return { row: after, changed: true };
    });
    if (changed) await conversations.tell(row, { type: "messages" }, options);
    return toBot(row);
  }

  /**
   * A bot's Instructions in its Details panel (D-98): its template in full and read-only, where it's from, its Tested
   * day for one of Mercbot's, and the newest change since the bot started to use it; its additions; and whether the
   * person may change either.
   */
  async function instructionsOf(botId, options) {
    const row = await conversations.ownedSingleBot(botId, options);
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
      canChange: mayChangeBot(row.created_by, conversations.personOf(options), options)
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

  /** The home's own templates (D-98), by tag: each one's description and how many of the home's bots use it. */
  async function homeTemplates(options) {
    const list = await records.homeTemplates.list(options);
    const used = await records.homeTemplates.usedBy(list.map((template) => template.id), options);
    return {
      templates: list.map((template) => ({
        id: String(template.id),
        tag: template.tag,
        description: template.description,
        usedBy: used.get(String(template.id)) || 0,
        updatedAt: new Date(template.updated_at).toISOString()
      }))
    };
  }

  /** One of the home's templates in full, for everyone in it: what a bot pointing at it follows. Another home's is none. */
  async function homeTemplate(templateId, options) {
    const template = /^\d+$/u.test(String(templateId)) ? await records.homeTemplates.find(String(templateId), options) : null;
    if (!template) throw noTemplate();
    const used = await records.homeTemplates.usedBy([template.id], options);
    return {
      id: String(template.id),
      tag: template.tag,
      description: template.description,
      instructions: template.instructions,
      skills: (template.skills || []).map(({ name, description }) => ({ name, description })),
      usedBy: used.get(String(template.id)) || 0,
      updatedAt: new Date(template.updated_at).toISOString()
    };
  }

  return Object.freeze({
    templateGallery,
    templateChecks,
    templateDetails,
    addFromTemplate,
    changeTemplate,
    instructionsOf,
    homeTemplates,
    homeTemplate
  });
}
