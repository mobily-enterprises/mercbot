import { isStagingOrProduction } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { FilesError } from "./fileStore.js";

// A home's files kept in a Google Drive (D-26, D-80), through one of the home's Google Drive accounts connected in Connect
// apps (D-111) with the access D-42 already asks for. Mercbot makes one folder there for the home and keeps the files in it,
// and nowhere else; rclone's Drive backend mounts that folder like WebDAV storage (remoteMounts.js), asking this
// server for each key (driveKey), so the account's long-lived permission never leaves Mercbot and is renewed under the
// account's row lock (connections.js). Here: the accounts the home may choose, the folder, and the key for a mount.
// Mercbot's own requests to Drive go through the account's own fetch, in its Request pace (D-96); rclone's mount keeps
// to rclone's Drive pacer (a request every 100 ms at most, backing off when Drive says it's busy).

const DRIVE_PLUGIN = "google-drive";
const FOLDER = "application/vnd.google-apps.folder";
const DRIVE = "https://www.googleapis.com";

/**
 * Outside staging and production only (APP_ENV, D-87): a stand-in for Google Drive (tests/support/fakeDrive.mjs), which
 * Mercbot calls at MERCBOT_TEST_GOOGLE_DRIVE_URL and rclone reaches through the proxy MERCBOT_TEST_GOOGLE_DRIVE_PROXY,
 * trusting the test authority MERCBOT_TEST_GOOGLE_DRIVE_CA. Null in staging and production, or when unset.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function driveStandIn(env) {
  const url = String(env.MERCBOT_TEST_GOOGLE_DRIVE_URL || "").trim();
  if (!url || isStagingOrProduction(env)) return null;
  return { url, proxy: String(env.MERCBOT_TEST_GOOGLE_DRIVE_PROXY || "").trim(), ca: String(env.MERCBOT_TEST_GOOGLE_DRIVE_CA || "").trim() };
}

/** A read that found nothing (the account was removed) is null; any other failure stays one. */
function noneIfMissing(error) {
  if (error?.code === "integrations_account_not_found") return null;
  throw error;
}

const unreachable = (message) => new FilesError(400, `${message} Try again in a few minutes.`, { code: "files_storage_drive_unreachable" });

const signInAgain = (label) =>
  new FilesError(409, "This home's files are in Google Drive, which needs signing in again.", {
    code: "files_storage_sign_in_again",
    params: { account: label || "" }
  });

/**
 * @param {object} dependencies
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
export function createDriveStorage({ integrations, systemContext, env }) {
  const api = driveStandIn(env)?.url || DRIVE;

  /** The person who added the account, as a job in the home, whose accounts are all reachable there (D-111). */
  const asOwner = (homeId, settings) => ({
    context: systemContext("reach the Google Drive account a home keeps its files in, as the person it belongs to")
      .forWorkspaceUser(String(homeId), String(settings.userId), { actorId: String(settings.userId) })
  });

  /**
   * One request to Drive with a key connections.accessToken gave: through the account's own fetch, in its pace (D-96).
   * @param {{ accessToken: string, fetch: typeof fetch }} key
   */
  async function call(key, path, init = {}) {
    const response = await key.fetch(`${api}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key.accessToken}`, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }

  /** The home's connected Google Drive accounts, which its files may be kept in. */
  async function accounts(options) {
    const found = await integrations.reachableAccounts(options, { status: "connected", pluginIds: [DRIVE_PLUGIN] });
    return found.map((account) => ({ id: account.id, label: account.label || account.name }));
  }

  /**
   * A key for one of the person's Google Drive accounts; a sign-in that ran out or was refused is "Sign in again".
   * `refused`: the key Drive just turned down, renewed at once (connections.accessToken).
   */
  async function keyFor(accountId, options, label, refused = "") {
    try {
      return await integrations.connections.accessToken(accountId, options, { refused });
    } catch (error) {
      if (["integrations_sign_in_ran_out", "integrations_account_signed_out"].includes(error?.code)) throw signInAgain(label);
      throw error;
    }
  }

  /**
   * The settings for keeping a home's files in a Google Drive account the request's person reaches: Mercbot's folder
   * there, the one it made before for the same account while it's there and not in the bin, or a new one.
   * @param {{ accountId?: string }} input
   * @param {Record<string, string>} made the folders Mercbot made for the home before, by account
   * @param {object} options the request's, in the home
   */
  async function prepare(input, made, options) {
    const account = await integrations.reachableAccount(String(input.accountId || ""), options).catch(noneIfMissing);
    if (!account || account.pluginId !== DRIVE_PLUGIN) {
      throw new FilesError(400, "Choose one of your connected Google Drive accounts.", { code: "files_storage_drive_account_unknown" });
    }
    const label = account.label || account.name;
    if (account.status !== "connected") throw signInAgain(label);
    const key = await keyFor(account.id, options, label);
    // Who added it: the home's mount reaches it as them (asOwner).
    const chosen = { accountId: account.id, userId: account.userId, label };
    const home = String(options?.context?.workspace?.name || "").trim();
    const name = home ? `Mercbot – ${home}`.slice(0, 200) : "Mercbot";
    const folderId = made[account.id];
    if (folderId) {
      const { status, body } = await call(key, `/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,trashed`);
      if (status === 401) throw signInAgain(label);
      if (status === 200 && !body.trashed) return { ...chosen, folderId, folderName: body.name || name };
      // Only a folder that's gone or in the bin is made again; Google not answering isn't a reason to.
      if (status !== 404 && status !== 200) throw unreachable("Google Drive didn't answer Mercbot.");
    }
    const { status, body } = await call(key, "/drive/v3/files?fields=id,name", {
      method: "POST",
      body: JSON.stringify({ name, mimeType: FOLDER })
    });
    if (status === 401) throw signInAgain(label);
    if (status !== 200 || !body.id) throw unreachable("Google Drive didn't let Mercbot make its folder there.");
    return { ...chosen, folderId: body.id, folderName: body.name || name };
  }

  /**
   * The home's Drive's account, reached as the person it belongs to, or null once it was removed.
   * @returns {Promise<object | null>}
   */
  async function account(homeId, settings) {
    const found = await integrations.reachableAccount(settings.accountId, asOwner(homeId, settings)).catch(noneIfMissing);
    return found && found.pluginId === DRIVE_PLUGIN ? found : null;
  }

  /** Throws "Sign in again" (or that the account was removed) unless the home's Drive can be used. */
  async function ready(homeId, settings) {
    const found = await account(homeId, settings);
    if (!found) {
      throw new FilesError(409, "The Google Drive account this home's files are kept in was removed. An owner or admin can choose again in Settings → Files.", {
        code: "files_storage_drive_gone"
      });
    }
    if (found.status !== "connected") throw signInAgain(settings.label);
  }

  /**
   * The key a home's mount asks for (remoteMounts.js), renewed under the account's row lock when it's about to run out,
   * or at once when Drive turned down `refused`, the key the mount had.
   * @param {{ refused?: string }} [why]
   * @returns {Promise<{ accessToken: string, expiresAt: number | null, renewed?: boolean, fetch: typeof fetch }>}
   */
  function key(homeId, settings, { refused = "" } = {}) {
    return keyFor(settings.accountId, asOwner(homeId, settings), settings.label, refused);
  }

  /**
   * How Mercbot's folder and the Drive look (D-80): the folder "here", in the "bin" or "missing" (deleted for good),
   * and the Drive's space in bytes (`limit` null for a Drive without one). Two calls to Drive, made only when Settings
   * → Files opens and when the home's key is renewed, never for a file. Null when Drive doesn't answer; a key Drive
   * turns down is renewed once (signing the account out if Google refuses that too).
   * @param {string} homeId
   * @param {{ accountId: string, userId: string, label: string, folderId: string }} settings
   * @param {{ accessToken: string, fetch: typeof fetch } | null} [given] a key already in hand
   * @returns {Promise<{ folder: "here" | "bin" | "missing", used: number, limit: number | null } | null>}
   */
  async function look(homeId, settings, given = null) {
    let access = given || await key(homeId, settings);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const folder = await call(access, `/drive/v3/files/${encodeURIComponent(settings.folderId)}?fields=trashed`);
      const about = await call(access, "/drive/v3/about?fields=storageQuota");
      if (folder.status === 401 || about.status === 401) {
        if (attempt) return null;
        // Drive turned the key down before it ran out: renewed once, or the account is signed out.
        access = await key(homeId, settings, { refused: access.accessToken });
        continue;
      }
      if (![200, 404].includes(folder.status) || about.status !== 200) return null;
      const quota = about.body.storageQuota || {};
      const limit = Number(quota.limit);
      return {
        folder: folder.status === 404 ? "missing" : folder.body.trashed ? "bin" : "here",
        used: Number(quota.usage) || 0,
        limit: limit > 0 ? limit : null
      };
    }
    return null;
  }

  /**
   * Puts Mercbot's folder in the Drive's bin, or takes it out (`trashed` false), as a move of the home's files does
   * (D-80): the old folder goes to the bin, recoverable for Google's 30 days, never deleted for good. A folder that's
   * gone already is left.
   */
  async function trash(homeId, settings, trashed) {
    const { status } = await call(await key(homeId, settings), `/drive/v3/files/${encodeURIComponent(settings.folderId)}?fields=id`, {
      method: "PATCH",
      body: JSON.stringify({ trashed })
    });
    if (status === 401) throw signInAgain(settings.label);
    if (status !== 200 && status !== 404) throw unreachable("Google Drive didn't answer Mercbot.");
  }

  return Object.freeze({
    accounts,
    prepare,
    account,
    ready,
    key,
    look,
    trash
  });
}
