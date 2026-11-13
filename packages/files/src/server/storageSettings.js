import { seal, unseal, vaultKey } from "@local/account/vault-crypto";
import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { GOING, alreadyMoving } from "./fileMoves.js";
import { FilesError } from "./fileStore.js";
import { checkStorage } from "./remoteMounts.js";

// While a move of the home's files runs, they're read-only (D-80).
const moving = () =>
  new FilesError(409, "Moving this home's files to the storage it chose: they're read-only until that's done, usually in a few minutes.", {
    code: "files_storage_moving"
  });

// Settings → Files warns that a home's Google Drive is nearly full once less than this is free (D-80): a fifteenth of
// Google's free 15 GB, and room for forty of the biggest files the bots keep (25 MB).
export const NEARLY_FULL_BYTES = 1024 ** 3;

/**
 * Each home's choice of where its files live (D-26, D-36, D-80): Mercbot's own storage, its own
 * WebDAV storage (Nextcloud and most file services speak it), or a Google Drive account connected
 * in Connect apps, both mounted with rclone. The settings are sealed with the vault key; a WebDAV
 * password never comes back out, and a Drive keeps only which account and Mercbot's folder there.
 * The settings screen reads and writes in its request's home; the bots' files open it in that
 * home's own context, as they run on no request.
 * @param {object} dependencies
 * @param {object} dependencies.fileStorage the file_storage handle
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("./types.js").RemoteMounts} dependencies.mounts
 * @param {import("./types.js").DriveStorage} dependencies.drive
 * @param {ReturnType<typeof import("./fileMoves.js").createFileMoves>} dependencies.moves moving the files when the
 *   home chooses other storage
 */
export function createStorageSettings({ fileStorage, systemContext, env, mounts, drive, moves }) {
  /** The bots' files run on no request, so they open the home's storage in that home's own context. */
  const inHome = (homeId) => ({ context: systemContext("open a home's own file storage for its bots' files and commands").forWorkspace(String(homeId)) });

  /** The home's row in the call's home, or null; `driveLook` is what Mercbot last saw of its Google Drive (D-80). */
  async function row(options, fields = ["kind", "settings"]) {
    const [found] = await fileStorage.queryAll({ fields }, passedOn(options));
    return found || null;
  }

  /** A row's settings, unsealed. */
  function opened(found) {
    const key = vaultKey(env);
    if (!key) {
      throw new FilesError(503, "This home's storage can't be opened: this server has no vault key.", {
        code: "files_storage_vault_key_missing"
      });
    }
    return { kind: found.kind, ...unseal(found.settings, key) };
  }

  /**
   * The home's settings, unsealed, in the call's home; null for Mercbot's storage, or kind "mercbot" when it only
   * remembers the folders Mercbot made in Google Drive accounts (`driveFolders`).
   */
  async function read(options) {
    const found = await row(options);
    return found ? opened(found) : null;
  }

  /**
   * Keeps what Mercbot saw of the home's Google Drive (driveStorage.look), for the Files page and for Settings → Files
   * when Drive doesn't answer. It names the folder it's about, so a look that lands after the home chose again is
   * never taken for the new choice's.
   */
  function remember(homeId, settings, look) {
    const driveLook = { folderId: settings.folderId, ...look, at: new Date().toISOString() };
    return fileStorage.patchWhere({ workspaceId: String(homeId) }, { driveLook }, { ...passedOn(inHome(homeId)), returning: "none" });
  }

  /** What was last seen of the home's Drive, if it's about the folder the home uses now. */
  const lookOf = (found, settings) => (found?.driveLook?.folderId === settings.folderId ? found.driveLook : null);

  /**
   * The home's own storage as a folder on this server, or null for Mercbot's storage. A Google
   * Drive whose account needs signing in again, or was removed, is refused with the reason: the
   * home's choice and its files stay, and nothing goes anywhere else meanwhile. While the home's
   * files are being moved (D-80) only `reading` gets it.
   * @param {string | number} homeId
   * @param {{ reading?: boolean }} [how]
   */
  async function folder(homeId, { reading = false } = {}) {
    const found = await row(inHome(homeId), ["kind", "settings", "moveStatus"]);
    if (found?.moveStatus === "running" && !reading) throw moving();
    const settings = found ? opened(found) : null;
    if (!settings || settings.kind === "mercbot") return null;
    if (settings.kind === "drive") await drive.ready(homeId, settings);
    return mounts.folder(homeId, settings);
  }

  /**
   * Why the home's own storage didn't answer, when Mercbot can tell: its Google Drive needs signing in again (Drive
   * turned the mount's key down and Google refused to renew it, remoteMounts.js) or was removed. Throws that reason;
   * returns when there's none to give.
   * @param {string} homeId
   */
  async function explain(homeId) {
    await mounts.refusal(homeId);
    const settings = await read(inHome(homeId));
    if (settings?.kind === "drive") await drive.ready(homeId, settings);
  }

  /**
   * The key a home's Google Drive mount asks for (remoteMounts.js), only while that Drive is still the home's choice:
   * a mount another server kept after the home chose elsewhere gets none (D-15). With `refused`, the key Drive turned
   * down, it's renewed at once. When this call renewed the key (about hourly, once across servers), Mercbot also looks
   * at the folder and the Drive's space (D-80), without holding the key back.
   * @param {string} homeId
   * @param {{ accountId: string, folderId: string }} mounted the settings the mount was made with
   * @param {{ refused?: string }} [why]
   */
  async function driveKey(homeId, mounted, why = {}) {
    const found = await row(inHome(homeId), ["kind", "settings", "moveStatus", "move"]);
    const settings = found ? opened(found) : null;
    // A move's destination gets keys too, while the home's files are copied there (fileMoves.js).
    const target = found?.moveStatus === "running" && found.move?.target ? unseal(found.move.target, vaultKey(env)) : null;
    const same = (chosen) => chosen?.kind === "drive" && chosen.accountId === mounted.accountId && chosen.folderId === mounted.folderId;
    const chosen = same(settings) ? settings : same(target) ? target : null;
    if (!chosen) {
      throw new FilesError(409, "This home's files are no longer kept in that Google Drive.", { code: "files_storage_drive_not_chosen" });
    }
    const key = await drive.key(homeId, chosen, why);
    if (key.renewed && chosen === settings) {
      drive.look(homeId, settings, key)
        .then((look) => look && remember(homeId, settings, look))
        .catch((error) => console.warn("Looking at a home's Google Drive after renewing its key failed; Settings → Files looks again.", error?.message));
    }
    return key;
  }

  /**
   * What Settings → Files and the Files page say of a home's Google Drive (D-80): Mercbot's folder `here`, in the
   * `bin` or `missing`, and the Drive's space, with `nearlyFull` under NEARLY_FULL_BYTES free. `fresh` (Settings →
   * Files) looks at Drive now and keeps what it saw; otherwise (the Files page) what was last seen is told, as the
   * renewals keep it.
   * @returns {Promise<{ folderState: string | null, space: object | null, signedIn: boolean }>}
   */
  async function driveState(homeId, settings, found, account, fresh) {
    let seen = lookOf(found, settings);
    let signedIn = account?.status === "connected";
    if (fresh && signedIn) {
      const look = await drive.look(homeId, settings).catch((error) => {
        // Drive turned the key down and Google refused to renew it: the account is signed out now.
        if (error?.code === "files_storage_sign_in_again") signedIn = false;
        return null;
      });
      if (look) {
        seen = { ...look, at: new Date().toISOString() };
        await remember(homeId, settings, look).catch((error) => console.warn("Keeping what Settings → Files saw of a home's Google Drive failed.", error?.message));
      }
    }
    const space = seen && {
      used: seen.used,
      limit: seen.limit,
      free: seen.limit === null ? null : Math.max(0, seen.limit - seen.used),
      nearlyFull: seen.limit !== null && seen.limit - seen.used < NEARLY_FULL_BYTES,
      at: seen.at
    };
    return { folderState: seen?.folder || null, space: space || null, signedIn };
  }

  /**
   * The home's latest move of its files (D-80), for everyone in it: where from and to, its stage and counts while it
   * runs, whether it's being cancelled, and why it stopped when it failed. Never the settings it keeps sealed.
   */
  function moveOf(found) {
    if (!found?.move) return null;
    const { from, to, stage, files, bytes, filesDone, bytesDone, startedAt } = found.move;
    const { error = null, sourceUnreadable = false, finishedAt = null } = found.move;
    const status = found.moveStatus;
    const cancelling = status === "running" && Boolean(found.moveCancel);
    return { status, cancelling, from, to, stage, files, bytes, filesDone, bytesDone, error, sourceUnreadable, startedAt, finishedAt };
  }

  /**
   * Where the home keeps its files, for Settings → Files and the Files page, with the Google Drive
   * accounts the request's person could choose, and its latest move (`moveOf`). A Drive says whose it is, Mercbot's
   * folder there, whether it's signed in, whether this person can sign it in again (their own account, or the home's
   * for its owners and admins), whether the folder is in Drive's bin, and the Drive's space (driveState).
   * @param {object} options the request's, in the home
   * @param {{ fresh?: boolean }} [how] `fresh`: look at Google Drive now (Settings → Files)
   */
  async function describe(options, { fresh = false } = {}) {
    const [found, driveAccounts] = await Promise.all([
      row(options, ["kind", "settings", "driveLook", "move", "moveStatus", "moveCancel"]),
      drive.accounts(options)
    ]);
    const settings = found ? opened(found) : null;
    const move = moveOf(found);
    if (settings?.kind === "drive") {
      const homeId = options.context.workspace.id;
      const account = await drive.account(homeId, settings);
      const person = String(resolveAuditActorId(options.context) ?? "");
      const { folderState, space, signedIn } = await driveState(homeId, settings, found, account, fresh);
      return {
        kind: "drive",
        accountId: settings.accountId,
        account: settings.label,
        folder: settings.folderName,
        folderState,
        space,
        signedIn,
        gone: !account,
        canSignIn: Boolean(account) && (account.home ? hasPermission(options.context.permissions || [], "workspace.settings.update") : account.userId === person),
        driveAccounts,
        move
      };
    }
    return settings?.kind === "webdav"
      ? { kind: "webdav", url: settings.url, user: settings.user, vendor: settings.vendor, driveAccounts, move }
      : { kind: "mercbot", driveAccounts, move };
  }

  /** Whether two choices are the same place: then saving changes settings only, and nothing moves. */
  function samePlace(current, next) {
    if (current.kind !== next.kind) return false;
    if (next.kind === "drive") return current.accountId === next.accountId && current.folderId === next.folderId;
    if (next.kind === "webdav") return current.url === next.url && current.user === next.user;
    return true;
  }

  /**
   * Why the home's files can't be read where they are now, or null: a Drive to sign in again, removed, or whose folder
   * was deleted for good, or WebDAV storage that doesn't answer.
   */
  async function unreadable(homeId, current) {
    try {
      if (current.kind === "webdav") await checkStorage(env, current);
      if (current.kind !== "drive") return null;
      await drive.ready(homeId, current);
      const look = await drive.look(homeId, current);
      if (look?.folder !== "missing") return null;
      return new FilesError(409, `Mercbot's folder “${current.folderName}” was deleted from ${current.label}'s Google Drive, with the files in it.`, {
        code: "files_storage_drive_folder_missing"
      });
    } catch (error) {
      return error;
    }
  }

  /**
   * @param {string | number} homeId the request's home, whose mount changes
   * @param {object} input the choice; `withoutFiles` switches without moving them, only when they can't be read
   * @param {object} options the request's, in that home
   */
  async function choose(homeId, input, options) {
    const found = await row(options, ["kind", "settings", "moveStatus"]);
    if (GOING.includes(found?.moveStatus)) throw alreadyMoving();
    const previous = found && vaultKey(env) ? opened(found) : null;
    // The folders Mercbot made in Google Drive accounts stay known whatever the home chooses, so choosing the same
    // account again finds its files there (D-80).
    const driveFolders = previous?.driveFolders || {};
    const remembered = Object.keys(driveFolders).length ? { driveFolders } : {};
    if (input.kind !== "mercbot" && input.kind !== "webdav" && input.kind !== "drive") {
      throw new FilesError(400, "Choose Mercbot's storage, Google Drive or your own.", { code: "files_storage_kind_unknown" });
    }
    const key = vaultKey(env);
    if (!key) {
      throw new FilesError(503, "This server can't keep your storage's settings safe: it has no vault key.", {
        code: "files_storage_password_unsafe"
      });
    }
    let next;
    if (input.kind === "mercbot") {
      next = { kind: "mercbot", ...remembered };
    } else if (input.kind === "drive") {
      const chosen = await drive.prepare(input, driveFolders, options);
      next = { kind: "drive", ...chosen, driveFolders: { ...driveFolders, [chosen.accountId]: chosen.folderId } };
    } else {
      const url = String(input.url || "").trim();
      if (!/^https?:\/\/\S+$/iu.test(url)) {
        throw new FilesError(400, "Enter the storage's address, starting with https://.", { code: "files_storage_url_invalid" });
      }
      const user = String(input.user || "").trim().slice(0, 200);
      // Leaving the password empty keeps the saved one for the same address and username.
      const password = input.password
        ? String(input.password)
        : previous?.url === url && previous?.user === user ? previous.password : "";
      const settings = { url, user, password, vendor: input.vendor === "nextcloud" ? "nextcloud" : "other" };
      await checkStorage(env, settings);
      next = { kind: "webdav", ...settings, ...remembered };
    }
    const current = previous?.kind ? previous : { kind: "mercbot" };
    if (samePlace(current, next) || input.withoutFiles) {
      // Switching without the files is only for files that can't be read where they are; they stay there (D-80).
      if (!samePlace(current, next) && !(await unreadable(homeId, current))) {
        throw new FilesError(409, "This home's files can be read where they are, so they move with it.", { code: "files_storage_move_needed" });
      }
      await save(homeId, next, key, options);
      await mounts.stop(homeId);
      return describe(options, { fresh: true });
    }
    // Every switch copies all the home's files to the new place first (D-80); one that can't be read says why.
    const reason = await unreadable(homeId, current);
    if (reason) {
      throw new FilesError(409, `Mercbot can't read this home's files where they are now, so it can't move them. ${reason.message} Fix that first, or switch without them: they stay where they are.`, {
        code: "files_storage_source_unreadable",
        params: { reason: reason.code || "" }
      });
    }
    await moves.start(homeId, next, options);
    return describe(options, { fresh: true });
  }

  /** An owner or admin cancels the home's move; it stops and the home stays where it was. */
  async function cancelMove(homeId, options) {
    await moves.cancel(homeId, options);
    return describe(options);
  }

  /**
   * Whose own Google Drive holds the home's files (D-80): the account of `userId`'s that the files are kept in, or are
   * being moved into or out of, as `{ account, moving, into }` (its label, whether a move runs, and whether it moves
   * the files into that account), or null when none of that person's accounts holds them. A home's own Drive account
   * isn't anyone's.
   * @param {string | number} homeId
   * @param {string | number} userId
   * @returns {Promise<{ account: string, moving: boolean, into: boolean } | null>}
   */
  async function heldInTheirDrive(homeId, userId) {
    const found = await row(inHome(homeId), ["kind", "settings", "moveStatus", "move"]);
    if (!found) return null;
    const settings = opened(found);
    const target = found.moveStatus === "running" && found.move?.target ? unseal(found.move.target, vaultKey(env)) : null;
    for (const place of [settings, target]) {
      if (place?.kind !== "drive" || String(place.userId) !== String(userId)) continue;
      const account = await drive.account(homeId, place);
      if (!account || account.home) continue;
      return { account: place.label, moving: found.moveStatus === "running", into: place === target };
    }
    return null;
  }

  /**
   * Saves a choice that moves no files, under the home's row lock (one row per home, keyed by it) unless a move
   * started meanwhile; the home's last move is then forgotten, as it's about a choice made before.
   */
  function save(homeId, { kind, ...settings }, key, options) {
    const home = { workspaceId: String(homeId) };
    return fileStorage.withTransaction({ ...passedOn(options), retry: false }, async (txOptions) => {
      await fileStorage.createMany([{ kind: "mercbot", settings: seal({}, key) }], {
        ...txOptions, onConflict: { keys: ["workspaceId"], action: "ignore" }, returning: "none"
      });
      const [found] = await fileStorage.lockWhere(home, { ...txOptions, fields: ["moveStatus"] });
      if (GOING.includes(found?.moveStatus)) throw alreadyMoving();
      await fileStorage.patchWhere(home, { kind, settings: seal(settings, key), move: null, moveStatus: null }, { ...txOptions, returning: "none" });
    });
  }

  return Object.freeze({
    folder,
    explain,
    driveKey,
    describe,
    choose,
    cancelMove,
    heldInTheirDrive
  });
}
