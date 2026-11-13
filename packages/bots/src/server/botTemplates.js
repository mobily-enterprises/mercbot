import { firstNameOf } from "./onboarding.js";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { BotsError } from "./botsError.js";
import { behaviourFingerprint, lastCheck, readResults, resultsFileFor, testedOn } from "./templateResults.js";
import { CATEGORIES, GALLERY, TEAM, details, setupNeeds, summary } from "./templates.js";
import { cleanName, toBot } from "./botRows.js";

/** The templates links open when the copy adds none (`mercbot.template-links` absent): no code opens one. */
export const NO_TEMPLATE_LINKS = Object.freeze({ find: async () => null });

/**
 * Bot templates (D-43): the gallery, and a bot added from a template or from one a link opens. Every method takes
 * the call's options last: the person and the home are the call's.
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
   * Adding a bot from a template or a shared link: it takes the template's name, look, job
   * and skills, remembers where it came from, and opens with the template's own greeting. Its
   * routines aren't copied: its setup interview creates them, paused, once the person agrees.
   */
  async function addFromTemplate(slug, displayName, options) {
    const template = await findTemplate(slug, options);
    const name = cleanName(template.name);
    const origin = {
      slug: template.slug,
      name: template.name,
      creator: template.creator,
      kind: template.linked ? "link" : "gallery",
      addedAt: new Date().toISOString()
    };
    // The person's first name, never an account handle ("Samrivera" from samrivera@…): with no
    // real name, the greeting simply has none.
    const person = await profiles.findById(conversations.personOf(options), passedOn(options));
    const first = firstNameOf(person?.displayName || displayName || "");
    const handle = String(person?.email || "").split("@")[0].replace(/[^a-z]/giu, "").toLowerCase();
    const real = first && first.toLowerCase().replace(/[^a-z]/giu, "") !== handle ? first : "";
    const words = template.greeting || `Hi {firstName}, I'm ${template.name}. ${template.description}`;
    const greeting = real ? words.replaceAll("{firstName}", real) : words.replace(/\s*\{firstName\}/gu, "");
    // The person's seat is read, then made: a lost race runs the whole transaction again.
    return retryLostInsertRace(passedOn(options), () => records.conversations.withTransaction(passedOn(options), async (txOptions) => {
      const bot = await records.conversations.createBot({
        user_id: conversations.personOf(txOptions),
        name,
        shape: template.shape,
        color: template.color,
        instructions: template.instructions,
        skills: template.skills,
        origin
      }, txOptions);
      const row = conversations.asSeen(bot, await conversations.conversationOf(bot, txOptions, { onboarding_step: null }));
      await records.templates.openWith(row, [
        { kind: "timestamp", role: "system", body: { at: new Date().toISOString() } },
        { kind: "text", role: "bot", body: { text: greeting } }
      ], txOptions);
      return { ...toBot(row), preview: greeting };
    }));
  }

  return Object.freeze({
    templateGallery,
    templateChecks,
    templateDetails,
    addFromTemplate
  });
}
