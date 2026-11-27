import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { ConnectionError } from "./oauth.js";
import { mayUnlink, unlinkedEntry } from "./unlinking.js";

/** What this copy is called on the hub, e.g. "Pat's laptop". */
const copyName = (name) => String(name || "").trim().slice(0, 80) || "My Mercbot";

function hubUrl(env) {
  return String(env.MERCBOT_HUB_URL || "").replace(/\/+$/u, "");
}

/**
 * The hub's bridge, over HTTPS. A copy only ever sends its install token and its own references.
 * @param {string} base
 * @param {string | null} [installToken]
 */
export function createHttpHub(base, installToken = null) {
  async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(installToken ? { authorization: `Bearer ${installToken}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000)
    }).catch(() => {
      const host = base.replace(/^https?:\/\//u, "");
      throw new ConnectionError(502, `Couldn't reach ${host}. Check this server's internet connection and try again.`, {
        code: "integrations_hub_unreachable",
        params: { host }
      });
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    const answered = response.status === 401 ? 401 : 502;
    if (!result.error) throw new ConnectionError(answered, "Mercbot's hub didn't answer.", { code: "integrations_hub_silent" });
    // The hub's own refusal, passed on with its code.
    throw new ConnectionError(answered, result.error, { code: result.code || "integrations_hub_refused", params: result.params });
  }

  function createLinkRequest(name) {
    return call("POST", "/api/bridge/link-requests", { name });
  }

  function claim(id, pollSecret) {
    return call("POST", `/api/bridge/link-requests/${encodeURIComponent(id)}/claim`, { pollSecret });
  }

  function start(body) {
    return call("POST", "/api/bridge/connections", body);
  }

  function status(ref) {
    return call("GET", `/api/bridge/connections/${ref}`);
  }

  function connectionToken(ref) {
    return call("POST", `/api/bridge/connections/${ref}/token`, {});
  }

  function disconnect(ref) {
    return call("DELETE", `/api/bridge/connections/${ref}`);
  }

  function unlink() {
    return call("DELETE", "/api/bridge/install");
  }

  return Object.freeze({
    createLinkRequest,
    claim,
    start,
    status,
    token: connectionToken,
    disconnect,
    unlink
  });
}

/**
 * This copy's one link to a hub (D-31), deployment-wide (bridge_link is `public`): asking the hub for it, picking up
 * the install token once the person approved it there, the hub it reaches with that token (`linkedHub`), and unlinking.
 * Every method takes the call's options last.
 * @param {object} dependencies
 * @param {object} dependencies.bridgeLink the bridge_link handle
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {typeof createHttpHub} dependencies.hubFor
 * @param {(value: unknown) => object} dependencies.sealed
 * @param {(value: object) => any} dependencies.opened
 * @param {import("./types.js").Accounts} dependencies.accounts
 * @param {(homeId: string, userId: string, options: object) => Promise<boolean>} dependencies.isMember
 * @param {(entry: object, options: object) => Promise<unknown>} dependencies.recordActivity
 */
export function createHubLink({ bridgeLink, env, hubFor, sealed, opened, accounts, isMember, recordActivity }) {
  /** This copy's one link to a hub, deployment-wide (bridge_link is `public`), or null. */
  async function linkRow(options) {
    const { records } = await bridgeLink.query({ sort: ["id"], page: { size: 1 } }, passedOn(options));
    return records[0] || null;
  }

  async function linkedHub(options) {
    const row = await linkRow(options);
    return row?.token ? hubFor(row.hubUrl, opened(row.token)) : null;
  }

  const unlinkRules = { managesHome: accounts.managesHome, isMember };

  async function linkStatus(options) {
    const row = await linkRow(options);
    return {
      hubUrl: row?.hubUrl || hubUrl(env),
      linked: Boolean(row?.token),
      pending: Boolean(row?.pending && !row?.token),
      name: row?.name || null,
      canUnlink: Boolean(row?.token) && (await mayUnlink(row, options, unlinkRules))
    };
  }

  /** Asks the hub for a link; the person approves it there, signed in to their account. */
  async function startLink(name, options) {
    const row = await linkRow(options);
    if (row?.token) throw new ConnectionError(409, "This copy is already linked.", { code: "integrations_link_already_linked" });
    const clean = copyName(name);
    const base = hubUrl(env);
    if (!base) {
      throw new ConnectionError(409, "No Mercbot to link to is set up for this copy (MERCBOT_HUB_URL).", {
        code: "integrations_link_hub_unset"
      });
    }
    const request = await hubFor(base).createLinkRequest(clean);
    await bridgeLink.deleteWhere({}, { ...passedOn(options), all: true });
    await bridgeLink.create({
      hubUrl: base,
      name: clean,
      linkedBy: resolveActorId(options.context),
      pending: sealed({ id: request.id, pollSecret: request.pollSecret })
    }, { ...passedOn(options), returning: "none" });
    return { approveUrl: request.approveUrl, code: request.code };
  }

  /** Picks up the install token once the person has approved the link. */
  async function checkLink(options) {
    const row = await linkRow(options);
    if (row?.pending && !row.token) {
      const { id, pollSecret } = opened(row.pending);
      const result = await hubFor(row.hubUrl).claim(id, pollSecret);
      if (result.token) {
        await bridgeLink.patch(row.id, { token: sealed(result.token), pending: null }, { ...passedOn(options), returning: "none", missing: "skip" });
      }
    }
    return linkStatus(options);
  }

  /**
   * Unlinks this copy from its hub: every account that borrowed the hub's sign-in is signed out, in
   * every home, and the call's home's Activity trail records who did it. A link still waiting for
   * approval is simply withdrawn.
   */
  async function unlink(options) {
    const row = await linkRow(options);
    if (!row) return linkStatus(options);
    if (row.token && !(await mayUnlink(row, options, unlinkRules))) {
      throw new ConnectionError(403, "Only the person who linked this copy, or an owner or admin of a home they're in, can unlink it.", {
        code: "integrations_unlink_forbidden"
      });
    }
    if (row.token) {
      await hubFor(row.hubUrl, opened(row.token))
        .unlink()
        .catch((error) => console.warn("Telling the hub about an unlink failed; this copy is unlinked anyway.", error));
    }
    await bridgeLink.deleteWhere({}, { ...passedOn(options), all: true });
    await accounts.signOutBridged(options);
    if (row.token && options.context?.workspace?.id) await recordActivity(unlinkedEntry(row, options.context), options);
    return linkStatus(options);
  }

  return Object.freeze({
    linkedHub,
    linkStatus,
    startLink,
    checkLink,
    unlink
  });
}
