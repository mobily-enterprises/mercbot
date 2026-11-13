import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { FilesError } from "./fileStore.js";
import { pageHeaders } from "./pageHeaders.js";

const MAX_TICKS = 500;

/**
 * Pages' routes (D-74). For people in the page's home, under the bot whose folder holds it: the
 * address a viewer frames it from, ticks, versions and Restore, and a standalone copy. Then the
 * page-only address, which carries its own token and no session: the framed page with its scripts
 * (/api/pages/<frame token>/…).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./pages.js").createPages>} dependencies.pages
 * @param {object} dependencies.directory records.directory: the bots the request's home holds
 */
export function registerPageRoutes(http, { pages, directory }) {
  const router = http.router;
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
  const base = "/api/w/:workspaceSlug/bots/:botId/pages";

  /** The page a person names: in a bot of the request's home, at a page's path. */
  async function pageOf(request, given) {
    const options = await request.callOptions();
    const botId = String(request.params.botId);
    const bot = /^\d+$/u.test(botId) ? await directory.findBot(botId, options, { kind: "bot" }) : null;
    if (!bot) throw new FilesError(404, "Bot not found.", { code: "files_bot_not_found" });
    const pagePath = String(given || "");
    if (!pages.isPagePath(pagePath)) throw new FilesError(404, "This page isn't here.", { code: "files_page_not_found" });
    return { page: { homeId: String(request.workspace.id), botId: bot.id, path: pagePath, userId: String(request.user.id) }, options };
  }

  function answered(work) {
    return async (request, reply) => {
      try {
        reply.send(await work(request, reply));
      } catch (error) {
        if (!(error instanceof FilesError)) throw error;
        reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
      }
    };
  }

  router.register("GET", `${base}/frame`, home, answered(async (request) => {
    const { page } = await pageOf(request, request.query?.path);
    return pages.frame(page);
  }));

  router.register("POST", `${base}/ticks`, home, answered(async (request) => {
    const { page } = await pageOf(request, request.body?.path);
    const items = request.body?.items;
    const valid = Array.isArray(items) && items.length > 0 && items.length <= MAX_TICKS &&
      items.every((item) => Number.isInteger(item?.tick) && item.tick >= 0 && item.tick < 10000 && typeof item.done === "boolean");
    if (!valid) throw new FilesError(400, "Those ticks aren't right.", { code: "files_page_ticks_invalid" });
    return pages.tick({ ...page, items: items.map(({ tick, done }) => ({ tick, done })) });
  }));

  router.register("GET", `${base}/versions`, home, answered(async (request) => {
    const { page, options } = await pageOf(request, request.query?.path);
    return pages.versions(page, options);
  }));

  router.register("POST", `${base}/restore`, home, answered(async (request) => {
    const { page, options } = await pageOf(request, request.body?.path);
    const versionId = String(request.body?.versionId || "");
    if (!/^\d+$/u.test(versionId)) throw new FilesError(404, "That version isn't there.", { code: "files_page_version_not_found" });
    return pages.restore({ ...page, versionId }, options);
  }));

  // A standalone copy to keep, downloaded: never shown on Mercbot's own address.
  router.register("GET", `${base}/copy`, home, answered(async (request, reply) => {
    const { page } = await pageOf(request, request.query?.path);
    const { name, html } = await pages.standalone(page);
    reply.headers({
      ...pageHeaders({ scripts: false }),
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
    });
    return html;
  }));

  /**
   * The framed page's address: the page or one of its files, else the same 404 for everything. The
   * token is the address's first part, read from the wildcard: it names the page's path, longer than
   * the router allows a :parameter (100 characters, a 414).
   */
  router.register("GET", "/api/pages/*", { auth: "public" }, async (request, reply) => {
    let answer;
    try {
      const [token, ...rest] = String(request.params["*"] || "").split("/");
      answer = await pages.serve({ frameToken: token, rest: rest.join("/") });
    } catch (error) {
      if (!(error instanceof FilesError)) throw error;
      reply.code(error.statusCode).headers({ ...pageHeaders({ scripts: false }), "content-type": "text/plain; charset=utf-8" }).send(error.message);
      return;
    }
    reply.headers({ ...answer.headers, "content-type": answer.type }).send(answer.body);
  });
}
