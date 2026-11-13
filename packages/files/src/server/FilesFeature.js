import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerDriveTokenRoute } from "./driveTokenRoute.js";
import { FILE_STORAGE_FILTERS } from "./fileMoves.js";
import { createFilesRuntime } from "./filesRuntime.js";
import { registerPageRoutes } from "./pageRoutes.js";
import { PROFILE_PICTURES, profilePictureDriver } from "./profilePictures.js";
import { registerRoutes } from "./registerRoutes.js";
import { SHELL_RUN_FILTERS } from "./shellRuns.js";
import { fileStorageResource, pageVersionResource, shellRunResource } from "./tableResources.js";

/** The tables the files feature owns, with their search entries. */
export const FILES_OWNS = Object.freeze([
  { resource: fileStorageResource, searchSchema: FILE_STORAGE_FILTERS },
  pageVersionResource,
  { resource: shellRunResource, searchSchema: SHELL_RUN_FILTERS }
]);

// A bot's files, the home's files, the bots' command line on them and the pages bots write there
// (D-20, D-21, D-36, D-47, D-74), where people's profile pictures are kept (D-19), and a home's
// own storage: WebDAV, or a Google Drive account from Connect apps (D-26, D-80).
const FilesFeature = defineFeature({
  id: "mercbot.files",
  domain: "files",
  owns: FILES_OWNS,
  systemScope:
    "open each home's own file storage for its bots, move a home's files to the storage it chose and sweep the moves whose server stopped, start, beat, finish and sweep the bots' command runs, and keep the versions of the pages bots save, which run on no request, in any home; reach the Google Drive account a home keeps its files in, as the person it belongs to",
  requires: {
    records: "mercbot.bots.records",
    http: "runtime.http",
    fastify: "runtime.fastify",
    uploads: "runtime.uploads",
    storage: "runtime.storage",
    integrations: "mercbot.integrations",
    env: "runtime.env",
    meter: "mercbot.meter"
  },
  provides: {
    files: "mercbot.files"
  },
  /**
   * @param {object} capabilities
   * @param {{ directory: object }} capabilities.records mercbot.bots.records
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
   * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} capabilities.storage
   * @param {import("@local/integrations/server/types").Integrations} capabilities.integrations
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@local/account/server/types").Meter} capabilities.meter what the bots' commands run is recorded through (D-73)
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  async setup({ records, http, fastify, uploads, storage, integrations, env, meter, resources, systemContext }) {
    const files = createFilesRuntime({ resources, systemContext, env, meter, integrations });
    registerRoutes(http, { files, directory: records.directory, uploads });
    // A Google Drive mount's rclone asks this server for its keys, at its own address (D-80), and so does a move's,
    // so this server carries on moves whose server stopped only once it listens.
    await registerDriveTokenRoute(fastify, files.mounts);
    fastify.addHook("onListen", () => {
      files.mounts.listening(fastify.server.address());
      files.moves.startSweeping();
    });
    registerPageRoutes(http, { pages: files.pages, directory: records.directory });
    // JSKIT's profile pictures go on the shared volume, from wherever JSKIT's storage kept them.
    const earlier = storage.getMount().driver;
    storage.mount(PROFILE_PICTURES, profilePictureDriver({ folder: files.store.profilePicturesFolder, earlier }));
    return { files };
  },
  // Shutting down (D-19): every save reaches people's own storage before the mounts close.
  async shutdown(_dependencies, { outputs }) {
    // Moves running here stop where they are; another server carries them on (D-80).
    outputs.files.moves.stopAll();
    await outputs.files.shell.drain();
    await outputs.files.mounts.closeAll();
  }
});

export { FilesFeature };
