import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { WebsiteError } from "./websiteError.js";

/**
 * The home's website and its pages' places on it (D-84), for people in the home. A page published there reaches
 * outside the home, so only the home's owners and admins set the website up and publish
 * to it (D-66); anyone in the home unpublishes, since narrowing is instant. A member is refused before anything else
 * is looked at, and each answer says whether the person may publish, for the Share screen.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./websites.js").createWebsites>} dependencies.websites
 * @param {{ isPagePath: (path: string) => boolean }} dependencies.pages files.pages
 * @param {object} dependencies.directory records.directory: the bots the request's home holds
 * @param {(options: object) => Promise<boolean>} dependencies.runsThisCopy whether the person runs this copy, and so may
 *   choose a folder on its computer
 */
export function registerWebsiteRoutes(http, { websites, pages, directory, runsThisCopy }) {
  const router = http.router;
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
  const site = "/api/w/:workspaceSlug/website";
  const pageSite = "/api/w/:workspaceSlug/bots/:botId/pages/website";
  const manages = (request) => hasPermission(request.permissions, "workspace.settings.update");

  function managing(request, doing) {
    if (!manages(request)) throw new WebsiteError(403, `Only the home's owners and admins can ${doing}.`, { code: "websites_manage_forbidden" });
  }

  /** The page a person names: in a bot of the request's home, at a page's path. */
  async function pageOf(request, given) {
    const options = await request.callOptions();
    const botId = String(request.params.botId);
    const bot = /^\d+$/u.test(botId) ? await directory.findBot(botId, options, { kind: "bot" }) : null;
    if (!bot) throw new WebsiteError(404, "Bot not found.", { code: "websites_bot_not_found" });
    const pagePath = String(given || "");
    if (!pages.isPagePath(pagePath)) throw new WebsiteError(404, "This page isn't here.", { code: "websites_page_not_found" });
    return { page: { homeId: String(request.workspace.id), botId: String(bot.id), path: pagePath }, options };
  }

  /** The route's answer, or its refusal: the website's own, or a page's (from files.pages). */
  function answered(work) {
    return async (request, reply) => {
      try {
        reply.send(await work(request, reply));
      } catch (error) {
        if (!(error instanceof AppError) || !error.code) throw error;
        reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
      }
    };
  }

  // The website's answers say whether the person may change it, and may choose a folder on this computer.
  async function siteAnswer(request, work) {
    const options = await request.callOptions();
    return { ...(await work(options)), canManage: manages(request), canUseFolder: await runsThisCopy(options) };
  }

  router.register("GET", site, home, answered((request) => siteAnswer(request, (options) => websites.describe(options))));

  router.register("PUT", site, home, answered((request) => {
    managing(request, "set up the home's website");
    return siteAnswer(request, (options) => websites.save(request.body || {}, options));
  }));

  router.register("DELETE", site, home, answered((request) => {
    managing(request, "remove the home's website");
    return siteAnswer(request, (options) => websites.remove(request.workspace.id, options));
  }));

  router.register("GET", pageSite, home, answered(async (request) => {
    const { page, options } = await pageOf(request, request.query?.path);
    return { ...(await websites.state(page, options)), canPublish: manages(request) };
  }));

  router.register("POST", pageSite, home, answered(async (request) => {
    managing(request, "publish pages to the home's website");
    const { page, options } = await pageOf(request, request.body?.path);
    return { ...(await websites.publish({ ...page, confirmed: request.body?.confirmed === true }, options)), canPublish: true };
  }));

  router.register("DELETE", pageSite, home, answered(async (request) => {
    const { page, options } = await pageOf(request, request.query?.path);
    return { ...(await websites.unpublish(page, options)), canPublish: manages(request) };
  }));
}
