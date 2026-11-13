import { filesFolder } from "@local/account/data-folder";
import { createDriveStorage } from "./driveStorage.js";
import { createFileMoves } from "./fileMoves.js";
import { createFileStore } from "./fileStore.js";
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
 * folders, and the pages bots write there (D-74).
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources this feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@local/account/server/types").Meter} [dependencies.meter] what the commands run is recorded through
 * @param {import("@local/integrations/server/types").Integrations} dependencies.integrations a Google Drive's account (D-80)
 */
export function createFilesRuntime({ resources, systemContext, env, meter, integrations }) {
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
  const apps = createOfficeApps({ store, env });
  // With a separate sandbox user (D-49) this server writes group-writable files too, so the
  // sandbox can change what it made and the other way round.
  if (sandboxUser(env)) process.umask(0o002);
  const shell = createShell({ store, runs, env, meter });
  const pages = createPages({ store, resources, systemContext, env });
  return Object.freeze({
    store,
    apps,
    storage,
    mounts,
    moves,
    shell,
    pages,
    commandOutput: runs.commandOutput
  });
}
