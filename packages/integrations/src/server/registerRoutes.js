import { readFile } from "node:fs/promises";
import path from "node:path";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { IntegrationsError } from "./accounts.js";
import { logoSvg, tileLogoSvg } from "./catalogue.js";
import { ConnectionError, isLocal } from "./oauth.js";
import { signInPage } from "./signInPage.js";

const SIGNED_IN = Object.freeze({ auth: "required", visibility: checkRouteVisibility("user") });
// Connect apps belongs to a home (D-37): JSKIT checks the person is in it and fills their rights.
const IN_HOME = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
const PUBLIC = Object.freeze({ auth: "public" });

/**
 * A route handler that answers what `work` returns for the request and its call options, or a
 * Connect apps error with its status code and message.
 * @param {(request: import("fastify").FastifyRequest, options: { context: object }) => Promise<unknown>} work
 */
function handle(work) {
  return async function answer(request, reply) {
    try {
      reply.code(200).send(await work(request, await request.callOptions()));
    } catch (error) {
      if (error instanceof IntegrationsError || error instanceof ConnectionError) {
        reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
        return;
      }
      throw error;
    }
  };
}

// A Connect apps request reaches the person's own accounts and the home's (D-37); the person and
// the home come from its options.
const REACH = Object.freeze({ personal: true });

/**
 * Connect apps, signing accounts in, and this copy's link to a hub (D-31, D-33, D-37).
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
      ...await integrations.list(REACH, options),
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
    return integrations.accountStatus(REACH, accountId, options);
  }

  function installPlugin(request, options) {
    return integrations.install(REACH, request.params.pluginId, options);
  }

  function uninstallPlugin(request, options) {
    return integrations.uninstall(REACH, request.params.pluginId, options);
  }

  function addAccount(request, options) {
    return integrations.addAccount(REACH, request.params.pluginId, request.body?.name, { forHome: request.body?.home === true }, options);
  }

  function renameAccount(request, options) {
    return integrations.renameAccount(REACH, request.params.accountId, request.body?.name, options);
  }

  function switchAction(request, options) {
    return integrations.switchAction(REACH, request.params.pluginId, request.params.actionId, request.body?.enabled !== false, options);
  }

  function removeAccount(request, options) {
    return integrations.removeAccount(REACH, request.params.accountId, options);
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

  function connectAccount(request, options) {
    return connections.connect(REACH, request.params.accountId, options);
  }

  async function disconnectAccount(request, options) {
    await connections.disconnect(REACH, request.params.accountId, options);
    return integrations.list(REACH, options);
  }

  async function finishPasted(request, options) {
    const result = await connections.finishPasted(request.body?.address, options);
    return { ...result, ...await integrations.list(REACH, options) };
  }

  /** Where every provider sends people back: a small page saying how it went. */
  async function signInCallback(request, reply) {
    let page;
    try {
      const { provider, label } = await connections.callback(request.query || {}, await request.callOptions());
      const signedInAs = label ? `Signed in as ${label}. ` : "";
      page = signInPage(`Connected to ${provider}`, `${signedInAs}It's all set: you can close this tab.`, { back: "/" });
    } catch (error) {
      if (!(error instanceof ConnectionError)) console.error(`Sign-in callback failed: ${error?.message || error}`);
      const didNotConnect = error instanceof ConnectionError
        ? error.message
        : "The sign-in didn't go through. Try again from Connect apps.";
      page = error?.approval
        ? signInPage("Your organisation needs to approve Mercbot", error.message, { approval: error.approval, back: "/" })
        : signInPage("Nothing was connected", didNotConnect, { back: "/" });
    }
    reply.code(200).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store").send(page);
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
  // An action's switch on an app's page.
  router.register("PUT", "/api/w/:workspaceSlug/plugins/:pluginId/actions/:actionId", IN_HOME, handle(switchAction));
  router.register("DELETE", "/api/w/:workspaceSlug/plugin-accounts/:accountId", IN_HOME, handle(removeAccount));
  router.register("PATCH", "/api/skills/:skillId", SIGNED_IN, handle(updateSkill));
  router.register("DELETE", "/api/skills/:skillId", SIGNED_IN, handle(deleteSkill));
  router.register("GET", "/api/plugins/:pluginId/source", PUBLIC, pluginSource);
  router.register("GET", "/api/plugins/:pluginId/logo.svg", PUBLIC, pluginLogo);
  router.register("GET", "/api/plugins/:pluginId/logo.png", PUBLIC, pluginLogoImage);
  // Signing an account in (D-31): the consent screen's address, and disconnecting.
  router.register("POST", "/api/w/:workspaceSlug/plugin-accounts/:accountId/connect", IN_HOME, handle(connectAccount));
  router.register("DELETE", "/api/w/:workspaceSlug/plugin-accounts/:accountId/connection", IN_HOME, handle(disconnectAccount));
  router.register("POST", "/api/w/:workspaceSlug/connections/finish", IN_HOME, handle(finishPasted));
  router.register("GET", "/api/connections/callback", PUBLIC, signInCallback);
  // This copy's link to a hub (Settings → Mercbot account). Its status and unlinking are asked from a
  // home: its owners and admins may unlink too (D-31), and its Activity trail records who did.
  router.register("GET", "/api/w/:workspaceSlug/bridge/link", IN_HOME, handle(linkStatus));
  router.register("POST", "/api/bridge/link", SIGNED_IN, handle(startLink));
  router.register("POST", "/api/bridge/link/check", SIGNED_IN, handle(checkLink));
  router.register("DELETE", "/api/w/:workspaceSlug/bridge/link", IN_HOME, handle(unlink));
}
