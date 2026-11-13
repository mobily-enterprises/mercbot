import { startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { WorkspaceRecordsFeature } from "@jskit-ai/workspaces-core/test/WorkspaceRecordsFeature";
import { AppsFeature } from "../../packages/apps/src/server/AppsFeature.js";
import { requestContextOptions } from "./requestContextOptions.mjs";
import { NoticesFeature } from "../../packages/notices/src/server/NoticesFeature.js";

// The apps feature as the server starts it (AppsFeature, with mercbot.notices and the workspaces records it
// requires), on the test's own Knex and without HTTP, for the apps' integration tests. The tests call the
// `mercbot.apps` capability as other features do, and the routes the features registered as a browser does:
// `browser()` keeps its cookies and answers each call as the route did. A copy built on Mercbot starts its own
// features on mercbot.apps beside it (`extras`).

const NO_BOTS = Object.freeze({
  directory: Object.freeze({ listHomeBots: async () => [], findBot: async () => null })
});

/**
 * `feature` as defined, keeping the handles the resource runtime gives it for the tables it owns in `kept.handles`, so
 * a test can check what its paths reach (expectScoped) through the same handles.
 */
export function keepingHandles(feature, kept) {
  return Object.freeze({
    ...feature,
    setup(dependencies, context) {
      const runtime = dependencies.resourceRuntime;
      const resourceRuntime = new Proxy({}, {
        get: (_target, name) => (name === "own" ? async (featureId, owns) => (kept.handles = await runtime.own(featureId, owns)) : runtime[name])
      });
      return feature.setup({ ...dependencies, resourceRuntime }, context);
    }
  });
}

/** "GET /api/w/:workspaceSlug/apps/:slug" → a matcher of a request's path that answers its params, or null. */
function routeMatcher(path) {
  const names = [];
  const pattern = path.replace(/:([A-Za-z]+)/gu, (_whole, name) => {
    names.push(name);
    return "([^/]+)";
  });
  const expression = new RegExp(`^${pattern}$`, "u");
  return (url) => {
    const found = expression.exec(url);
    return found ? Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1])])) : null;
  };
}

/**
 * Starts the apps features on `knex`.
 * @param {object} options
 * @param {import("knex").Knex} options.knex
 * @param {Record<string, unknown>} [options.env] The runtime env, kept as given, so a test may change it as it runs
 *   (a key, say).
 * @param {object} [options.records] `mercbot.bots.records`: by default a home without bots.
 * @param {{ features?: object[], requires?: Record<string, string>, inputs?: Record<string, unknown> }} [options.extras]
 *   Features started after AppsFeature, the capabilities the test asks for besides apps, workspaces and notices
 *   (`capabilities`), and inputs those features require.
 * @returns {Promise<{
 *   apps: import("../../packages/apps/src/server/types.js").Apps,
 *   workspaces: { findBySlug: Function },
 *   notices: import("../../packages/notices/src/server/types.js").Notices,
 *   capabilities: Record<string, any>,
 *   handles: Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>,
 *   systemContext: import("@jskit-ai/resource-runtime/server/types").SystemContext,
 *   memberOptions: (userId: string | number, workspace: { id: string | number, slug?: string }, membership?: { role?: string, permissions?: string[] }) => { context: object },
 *   jobOptions: (workspaceId: string | number) => { context: object },
 *   browser: (from?: { ip?: string, https?: boolean, cookies?: Map<string, string>, member?: { userId: string | number, workspace: { id: string | number, slug?: string }, role?: string, permissions?: string[] } }) => (method: string, url: string, body?: object) => Promise<{ status: number, body: any, location: string | null }>,
 *   stop: () => Promise<void>
 * }>}
 */
export async function startApps({ knex, env = {}, records = NO_BOTS, extras = {} }) {
  const routes = [];
  const closing = [];
  const kept = {};
  const started = await startTestFeatures({
    knex,
    // The users' providers own the profiles a workspace's owner links to (a home is read by its slug).
    features: [NoticesFeature, WorkspaceRecordsFeature, UsersIdentityProvider, UsersExtensionsProvider, keepingHandles(AppsFeature, kept), ...(extras.features || [])],
    requires: { apps: "mercbot.apps", workspaces: "workspaces", notices: "mercbot.notices", ...extras.requires },
    inputs: {
      "runtime.http": { router: { register: (method, path, _options, handler) => routes.push({ method, match: routeMatcher(path), handler }) } },
      "runtime.database": { knex },
      // Never listening ("onListen" never runs), so the watch loop doesn't run behind the test's back; "preClose" runs on
      // stop().
      "runtime.fastify": { addHook: (name, hook) => name === "preClose" && closing.push(hook) },
      "runtime.env": env,
      "mercbot.bots.records": records,
      ...extras.inputs
    }
  });
  const testContext = started.resources.declareSystemScope("tests.apps", "set up and check the apps tests' homes");

  /**
   * A browser on the features' routes, coming from `ip`: its own cookies, sent and kept as a browser does. With
   * `member`, it is that person's, signed in, in the home their route names, as JSKIT fills a member route's request
   * once it has checked the membership. `cookies` shares one browser's cookies with its browser on another server
   * (another startApps on the same database).
   */
  function browser({ ip = "203.0.113.10", https = true, member = null, cookies = new Map() } = {}) {
    return async function call(method, url, body) {
      const [path, search = ""] = url.split("?");
      const route = routes.map((entry) => ({ entry, params: entry.method === method && entry.match(path) })).find(({ params }) => params);
      if (!route) return { status: 404, body: null, location: null };
      const request = {
        method,
        url,
        params: route.params,
        query: Object.fromEntries(new URLSearchParams(search)),
        body: body ?? null,
        ip,
        protocol: https ? "https" : "http",
        headers: { cookie: [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") },
        ...(member ? memberRequest(member) : {})
      };
      request.callOptions = async () => requestContextOptions(request);
      const reply = {
        statusCode: 200,
        payload: null,
        location: null,
        code(status) {
          this.statusCode = status;
          return this;
        },
        type() {
          return this;
        },
        send(payload) {
          this.payload = payload ?? null;
          return this;
        },
        header(name, value) {
          if (String(name).toLowerCase() === "set-cookie") {
            const [pair] = String(value).split(";");
            const at = pair.indexOf("=");
            cookies.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
          }
          return this;
        },
        redirect(location, status = 302) {
          this.location = location;
          this.statusCode = status;
          return this;
        }
      };
      await route.entry.handler(request, reply);
      return { status: reply.statusCode, body: reply.payload, location: reply.location };
    };
  }

  /** What JSKIT puts on a member route's request: the person, their home, their role and its permissions. */
  function memberRequest({ userId, workspace, role = "owner", permissions = ["workspace.settings.update"] }) {
    return {
      user: { id: String(userId) },
      workspace: { id: String(workspace.id), slug: workspace.slug },
      membership: { roleSid: role },
      permissions
    };
  }

  return Object.freeze({
    apps: started.capabilities.apps,
    workspaces: started.capabilities.workspaces,
    /** mercbot.notices, as the features got it: a test's own listeners. */
    notices: started.capabilities.notices,
    /** Every capability the test asked for, `extras.requires`' too. */
    capabilities: started.capabilities,
    /** AppsFeature's handles of the tables it owns. */
    handles: kept.handles,
    /** A system context that reads every home, for expectScoped. */
    systemContext: testContext("set up and check the apps tests' homes"),
    /** A member's call options, as a route's request.callOptions() gives them for a request of `userId` in `workspace` (synchronously). */
    memberOptions: (userId, workspace, { role, permissions } = {}) => requestContextOptions(memberRequest({ userId, workspace, role, permissions })),
    /** A job's call options in one home, for a test's own setup and checks. */
    jobOptions: (workspaceId) => ({ context: testContext("set up and check the apps tests' homes").forWorkspace(String(workspaceId)) }),
    browser,
    async stop() {
      for (const hook of closing) await hook();
      await started.stop();
    }
  });
}
