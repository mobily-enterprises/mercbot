import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { IntegrationsError } from "./accounts.js";
import { logoSvg, tileLogoSvg } from "./catalogue.js";
import { ConnectionError, isLocal } from "./oauth.js";
import { cookieName, cookieOptions } from "./signInBinding.js";
import { SIGN_IN_PAGE_SCRIPT, signInPage } from "./signInPage.js";

const SIGNED_IN = Object.freeze({ auth: "required", visibility: checkRouteVisibility("user") });
// Connect apps belongs to a home (D-37): JSKIT checks the person is in it and fills their rights.
const IN_HOME = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
const PUBLIC = Object.freeze({ auth: "public" });

/**
 * A route handler that answers what `work` returns for the request and its call options, or a
 * Connect apps error with its status code and message.
 * @param {(request: import("fastify").FastifyRequest, options: { context: object }, reply: import("fastify").FastifyReply) => Promise<unknown>} work
 */
function handle(work) {
  return async function answer(request, reply) {
    try {
      reply.code(200).send(await work(request, await request.callOptions(), reply));
    } catch (error) {
      if (error instanceof IntegrationsError || error instanceof ConnectionError) {
        reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
        return;
      }
      throw error;
    }
  };
}

/**
 * Connect apps, signing accounts in, and this copy's link to a hub (D-31, D-33, D-111). A request reaches its home's
 * accounts; the person and the home come from its options.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Integrations} capabilities.integrations
 * @param {import("./catalogue.js").Catalogue} capabilities.catalogue
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
 */
export function registerRoutes(http, { integrations, catalogue, env }) {
  const { connections } = integrations;
  const router = http.router;

  async function listPlugins(request, options) {
    await connections
      .syncPending(options)
      .catch((error) => console.warn("Finishing pending sign-ins failed; the list shows what is known.", error));
    return {
      ...await integrations.list(options),
      pasteSignIn: isLocal(env),
      managesHome: hasPermission(request.permissions, "workspace.settings.update")
    };
  }

  /** One account as Connect apps shows it, for the screen waiting for its sign-in to finish. */
  async function pluginAccount(request, options) {
    const { accountId } = request.params;
    await connections
      .syncPending(options, { accountId })
      .catch((error) => console.warn("Finishing a pending sign-in failed; the account shows what is known.", error));
    return integrations.accountStatus(accountId, options);
  }

  function installPlugin(request, options) {
    return integrations.install(request.params.pluginId, options);
  }

  function uninstallPlugin(request, options) {
    return integrations.uninstall(request.params.pluginId, options);
  }

  function addAccount(request, options) {
    return integrations.addAccount(request.params.pluginId, request.body?.name, options);
  }

  function renameAccount(request, options) {
    return integrations.renameAccount(request.params.accountId, request.body?.name, options);
  }

  function choosePace(request, options) {
    return integrations.choosePace(request.params.accountId, request.body?.pace, options);
  }

  function switchAction(request, options) {
    return integrations.switchAction(request.params.pluginId, request.params.actionId, request.body?.enabled !== false, options);
  }

  function removeAccount(request, options) {
    return integrations.removeAccount(request.params.accountId, options);
  }

  function updateSkill(request, options) {
    return integrations.updateSkill(request.params.skillId, request.body || {}, options);
  }

  function deleteSkill(request, options) {
    return integrations.deleteSkill(request.params.skillId, options);
  }

  /**
   * An app's own definition, for "View source" on its page: what it is, the access it asks for,
   * its skills and every action the bots can take with it.
   */
  async function pluginSource(request, reply) {
    const entry = catalogue.find((plugin) => plugin.id === request.params.pluginId);
    if (!entry) {
      reply.code(404).send({ error: "No such app." });
      return;
    }
    reply.header("content-type", "application/json; charset=utf-8").send(`${JSON.stringify(entry, null, 2)}\n`);
  }

  /** App logos (D-33): public marks, cached by the browser. */
  async function pluginLogo(request, reply) {
    const slug = catalogue.find((entry) => entry.id === request.params.pluginId)?.logo;
    const svg = await (request.query?.tile === "1" ? tileLogoSvg(slug) : logoSvg(slug));
    if (!svg) {
      reply.code(404).send({ error: "No logo." });
      return;
    }
    reply.header("content-type", "image/svg+xml").header("cache-control", "public, max-age=86400").send(svg);
  }

  /** A maker's own site icon (D-34), as a PNG the server made itself. */
  async function pluginLogoImage(request, reply) {
    const entry = catalogue.find((found) => found.id === request.params.pluginId);
    const file = entry?.logoImage ? path.resolve(process.cwd(), "plugins", "logos", `${entry.id}.png`) : "";
    const image = file ? await readFile(file).catch(() => null) : null;
    if (!image) {
      reply.code(404).send({ error: "No logo." });
      return;
    }
    reply.header("content-type", "image/png")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "public, max-age=86400")
      .send(image);
  }

  /** A sign-in's answer for the page, with its browser's cookie set rather than shown to the page (D-97). */
  function keptInBrowser(reply, { cookie, ...answer }) {
    if (cookie) reply.setCookie(cookie.name, cookie.value, cookieOptions(env));
    return answer;
  }

  async function connectAccount(request, options, reply) {
    return keptInBrowser(reply, await connections.connect(request.params.accountId, options));
  }

  /** A sign-in this copy lends a linked copy, begun by the account it's linked to, signed in (D-97). */
  async function beginLentSignIn(request, options, reply) {
    return keptInBrowser(reply, await connections.beginLentSignIn(request.body?.state, options));
  }

  /** API credentials entered for an account (D-93), checked with the app, saved sealed: who they matched, and the list. */
  async function enterCredentials(request, options) {
    const credentials = await connections.saveCredentials(request.params.accountId, request.body || {}, options);
    return { credentials, ...await integrations.list(options) };
  }

  // Who each of the home's people is at an app connected with the home's API credentials (D-93, appPeople.js).
  const appPerson = (request, options) => connections.appPerson(request.params.accountId, options);
  const appPeople = (request, options) => connections.appPeople(request.params.accountId, options);
  const appUsers = async (request, options) => ({
    users: await connections.appUsers(request.params.accountId, request.query?.q, options)
  });
  const pickAppUser = (request, options) => connections.pickAppUser(request.params.accountId, request.body?.appUserId, options);
  const confirmAppPerson = (request, options) =>
    connections.confirmAppPerson(request.params.accountId, request.params.userId, options);
  const forgetAppPerson = (request, options) =>
    connections.forgetAppPerson(request.params.accountId, request.params.userId, options);

  async function finishPasted(request, options) {
    const result = await connections.finishPasted(request.body?.address, options);
    return { ...result, ...await integrations.list(options) };
  }

  /**
   * Where every provider sends people back: a small page saying how it went. Only the browser a sign-in started in
   * finishes it, by the cookie it was given (D-97), which goes once it has come back.
   */
  async function signInCallback(request, reply) {
    const cookie = cookieName(String(request.query?.state || ""));
    if (request.cookies?.[cookie] !== undefined) reply.clearCookie(cookie, cookieOptions(env, 0));
    let page;
    try {
      const signedIn = await connections.callback(request.query || {}, request.cookies || {}, await request.callOptions());
      const { provider, label, install } = signedIn;
      const signedInAs = label ? `Signed in as ${label}. ` : "";
      // Signed in to GitHub with Mercbot's GitHub App installed nowhere yet (D-128): bots read, and the next step lets them work on
      // repositories.
      page = install
        ? signInPage(
          `Connected to ${provider}`,
          `${signedInAs}Next, install Mercbot's GitHub App on GitHub and choose the repositories your bots may work on. Each bot still asks you before it uses one.`,
          { connected: true, next: { href: install, label: "Install on GitHub" } }
        )
        : signInPage(`Connected to ${provider}`, `${signedInAs}It's all set.`, { connected: true });
    } catch (error) {
      if (!(error instanceof ConnectionError)) console.error(`Sign-in callback failed: ${error?.message || error}`);
      const didNotConnect = error instanceof ConnectionError
        ? error.message
        : "The sign-in didn't go through. Try again from Connect apps.";
      page = error?.approval
        ? signInPage("Your organisation needs to approve Mercbot", error.message, { approval: error.approval })
        : signInPage("Couldn't connect", didNotConnect);
    }
    reply.code(200).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").send(page);
  }

  /**
   * Where GitHub sends people after they install Mercbot's GitHub App or change its repositories (the GitHub App's Setup URL,
   * D-128). Its installation_id can be anyone's, so it is never used: a bot's card and its commands read the person's
   * repositories with their own sign-in, at the moment they need them.
   */
  function githubInstalled(request, reply) {
    const changed = request.query?.setup_action === "update";
    const page = signInPage(
      changed ? "The repositories Mercbot's GitHub App reaches are changed" : "Mercbot's GitHub App is installed on GitHub",
      "Your bots can ask to use the repositories you chose, and each one asks you first. You can change them on GitHub at any time.",
      { connected: true }
    );
    reply.code(200).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").send(page);
  }

  /**
   * A page of the person's own GitHub repositories that Mercbot's GitHub App reaches, whose name holds `q`, for a bot's card to
   * choose from (D-128), and where to go on (`after`).
   */
  const githubRepositories = (request, options) =>
    connections.github.repositories(options, { words: String(request.query?.q || ""), after: request.query?.after ? String(request.query.after) : null });

  /** The sign-in page's one script, its Copy button, kept out of the page so a Content Security Policy needs no inline script. */
  function signInPageScript(_request, reply) {
    reply.header("content-type", "text/javascript; charset=utf-8").header("cache-control", "public, max-age=3600").send(SIGN_IN_PAGE_SCRIPT);
  }

  function linkStatus(_request, options) {
    return connections.linkStatus(options);
  }

  function startLink(request, options) {
    return connections.startLink(request.body?.name, options);
  }

  function checkLink(_request, options) {
    return connections.checkLink(options);
  }

  function unlink(_request, options) {
    return connections.unlink(options);
  }

  router.register("GET", "/api/w/:workspaceSlug/plugins", IN_HOME, handle(listPlugins));
  router.register("POST", "/api/w/:workspaceSlug/plugins/:pluginId/install", IN_HOME, handle(installPlugin));
  router.register("DELETE", "/api/w/:workspaceSlug/plugins/:pluginId", IN_HOME, handle(uninstallPlugin));
  router.register("POST", "/api/w/:workspaceSlug/plugins/:pluginId/accounts", IN_HOME, handle(addAccount));
  router.register("GET", "/api/w/:workspaceSlug/plugin-accounts/:accountId", IN_HOME, handle(pluginAccount));
  router.register("PATCH", "/api/w/:workspaceSlug/plugin-accounts/:accountId", IN_HOME, handle(renameAccount));
  // An account's Request pace (D-96): Gentle, Normal or Fast.
  router.register("PUT", "/api/w/:workspaceSlug/plugin-accounts/:accountId/pace", IN_HOME, handle(choosePace));
  // An action's switch on an app's page.
  router.register("PUT", "/api/w/:workspaceSlug/plugins/:pluginId/actions/:actionId", IN_HOME, handle(switchAction));
  router.register("DELETE", "/api/w/:workspaceSlug/plugin-accounts/:accountId", IN_HOME, handle(removeAccount));
  router.register("PATCH", "/api/skills/:skillId", SIGNED_IN, handle(updateSkill));
  router.register("DELETE", "/api/skills/:skillId", SIGNED_IN, handle(deleteSkill));
  router.register("GET", "/api/plugins/:pluginId/source", PUBLIC, pluginSource);
  router.register("GET", "/api/plugins/:pluginId/logo.svg", PUBLIC, pluginLogo);
  router.register("GET", "/api/plugins/:pluginId/logo.png", PUBLIC, pluginLogoImage);
  // Signing an account in (D-31): the consent screen's address, and an app's API credentials (D-93). Removing an account
  // (DELETE above) withdraws its sign-in; there is no disconnecting that keeps it (D-110).
  router.register("POST", "/api/w/:workspaceSlug/plugin-accounts/:accountId/connect", IN_HOME, handle(connectAccount));
  router.register("POST", "/api/w/:workspaceSlug/plugin-accounts/:accountId/credentials", IN_HOME, handle(enterCredentials));
  // Who the home's people are at an app connected with its API credentials (D-93): a person's own, and picking it when
  // their address finds no one; everyone's, and confirming picks, for the home's owners and admins.
  router.register("GET", "/api/w/:workspaceSlug/plugin-accounts/:accountId/people/me", IN_HOME, handle(appPerson));
  router.register("PUT", "/api/w/:workspaceSlug/plugin-accounts/:accountId/people/me", IN_HOME, handle(pickAppUser));
  router.register("GET", "/api/w/:workspaceSlug/plugin-accounts/:accountId/people", IN_HOME, handle(appPeople));
  router.register("POST", "/api/w/:workspaceSlug/plugin-accounts/:accountId/people/:userId/confirm", IN_HOME, handle(confirmAppPerson));
  router.register("DELETE", "/api/w/:workspaceSlug/plugin-accounts/:accountId/people/:userId", IN_HOME, handle(forgetAppPerson));
  router.register("GET", "/api/w/:workspaceSlug/plugin-accounts/:accountId/app-users", IN_HOME, handle(appUsers));
  router.register("POST", "/api/w/:workspaceSlug/connections/finish", IN_HOME, handle(finishPasted));
  router.register("GET", "/api/connections/callback", PUBLIC, signInCallback);
  router.register("GET", "/api/connections/sign-in-page.js", PUBLIC, signInPageScript);
  // The GitHub App's Setup URL, and a person's repositories it reaches, for a bot's card (D-128).
  router.register("GET", "/api/connections/github/installed", PUBLIC, githubInstalled);
  router.register("GET", "/api/w/:workspaceSlug/github/repositories", IN_HOME, handle(githubRepositories));
  // A sign-in this copy lends a linked copy (D-31) is begun by the account that copy is linked to, signed in (D-97).
  router.register("POST", "/api/connections/lent/begin", SIGNED_IN, handle(beginLentSignIn));
  // This copy's link to a hub (Settings → Mercbot account). Its status and unlinking are asked from a
  // home: its owners and admins may unlink too (D-31), and its Activity trail records who did.
  router.register("GET", "/api/w/:workspaceSlug/bridge/link", IN_HOME, handle(linkStatus));
  router.register("POST", "/api/bridge/link", SIGNED_IN, handle(startLink));
  router.register("POST", "/api/bridge/link/check", SIGNED_IN, handle(checkLink));
  router.register("DELETE", "/api/w/:workspaceSlug/bridge/link", IN_HOME, handle(unlink));
}
