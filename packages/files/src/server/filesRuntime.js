import { filesFolder } from "@local/account/data-folder";
import { createMediaGuard } from "@local/account/media-check";
import { createDriveStorage } from "./driveStorage.js";
import { createFileMoves } from "./fileMoves.js";
import { createFileStorageRepository } from "./fileStorageRepository.js";
import { createFileStore } from "./fileStore.js";
import { createMediaChecks } from "./mediaChecks.js";
import { createOfficeApps } from "./officeApps.js";
import { createPages } from "./pages.js";
import { createRemoteMounts } from "./remoteMounts.js";
import { sandboxUser } from "./gvisor.js";
import { createShell } from "./shell.js";
import { createShellRuns } from "./shellRuns.js";
import { createStorageSettings } from "./storageSettings.js";

/**
 * The `mercbot.files` capability: the file store, the office apps, each home's own storage, its
 * mounts and the moves of its files between storages (D-80), the bots' command line on the same
 * folders, the pages bots write there (D-74), where a batch of homes keep their files, and how a copy built on Mercbot
 * checks pictures and videos (`media`, D-90).
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources this feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@local/account/server/types").Meter} [dependencies.meter] what the commands run is recorded through
 * @param {import("@local/account/server/types").MediaCheck | null} dependencies.mediaCheck a copy's checker (D-90), or null
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations a Google Drive's account (D-80)
 */
export function createFilesRuntime({ resources, systemContext, env, meter, integrations, mediaCheck }) {
  const drive = createDriveStorage({ integrations, systemContext, env });
  // A Google Drive mount's keys come through the home's storage choice, so a mount the home left gets none.
  const mounts = createRemoteMounts({ env, driveKey: (homeId, settings, why) => storage.driveKey(homeId, settings, why) });
  const runs = createShellRuns({ shellRuns: resources.shellRuns, systemContext });
  const store = createFileStore({
    root: env.MERCBOT_FILES_DIR,
    fallback: filesFolder(env),
    ownStorage: (homeId, how) => storage.folder(homeId, how),
    settle: mounts.settle,
    explain: (homeId) => storage.explain(homeId)
  });
  // Choosing other storage moves every file there first (D-80).
  const moves = createFileMoves({ fileStorage: resources.fileStorage, systemContext, env, store, mounts, drive, runs });
  const storage = createStorageSettings({ fileStorage: resources.fileStorage, systemContext, env, mounts, drive, moves });
  const media = createMediaChecks({ guard: createMediaGuard(mediaCheck), mediaChecks: resources.mediaChecks, systemContext, store });
  const apps = createOfficeApps({ store, env });
  // With a separate sandbox user (D-49) this server writes group-writable files too, so the
  // sandbox can change what it made and the other way round.
  if (sandboxUser(env)) process.umask(0o002);
  const shell = createShell({ store, runs, env, meter, media });
  const pages = createPages({ store, resources, systemContext, env });
  return Object.freeze({
    store,
    apps,
    storage,
    mounts,
    moves,
    shell,
    pages,
    media,
    commandOutput: runs.commandOutput,
    // Where each of a batch of homes keeps its files, in every home a system context reaches.
    storageKinds: createFileStorageRepository(resources).kindsByHome
  });
}
