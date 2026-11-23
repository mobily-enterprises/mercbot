import { defineFeature } from "@jskit-ai/kernel/server/features";
import { registerDriveTokenRoute } from "./driveTokenRoute.js";
import { FILE_STORAGE_FILTERS } from "./fileMoves.js";
import { PAGE_VERSION_FILTERS } from "./pages.js";
import { createFilesRuntime } from "./filesRuntime.js";
import { createFileTransfer } from "./fileTransfer.js";
import { INTERNET_DAY_FILTERS, INTERNET_MINUTE_FILTERS } from "./internetUsage.js";
import { MEDIA_CHECK_FILTERS } from "./mediaChecks.js";
import { registerPageRoutes } from "./pageRoutes.js";
import { PROFILE_PICTURES, profilePictureDriver } from "./profilePictures.js";
import { registerRoutes } from "./registerRoutes.js";
import { SHELL_RUN_FILTERS } from "./shellRuns.js";
import {
  fileStorageResource,
  filesKeyResource,
  internetDayResource,
  internetMinuteResource,
  mediaCheckResource,
  pageVersionResource,
  shellRunResource
} from "./tableResources.js";

/** The tables the files feature owns, with their search entries. */
export const FILES_OWNS = Object.freeze([
  { resource: fileStorageResource, searchSchema: FILE_STORAGE_FILTERS },
  filesKeyResource,
  // What a home's bot commands used of the internet, by day, and each bot's present minute (D-127).
  { resource: internetDayResource, searchSchema: INTERNET_DAY_FILTERS },
  { resource: internetMinuteResource, searchSchema: INTERNET_MINUTE_FILTERS },
  { resource: mediaCheckResource, searchSchema: MEDIA_CHECK_FILTERS },
  { resource: pageVersionResource, searchSchema: PAGE_VERSION_FILTERS },
  // A bot's commands in a chat are read by whoever may read that chat (the bots' chat rule, D-112).
  {
    resource: shellRunResource,
    searchSchema: SHELL_RUN_FILTERS,
    rowPolicy: ({ requires, ...args }) => requires.records.rules.chatBotRule(args)
  }
]);

// A bot's files, the home's files, the bots' command line on them and the pages bots write there
// (D-20, D-21, D-36, D-47, D-74), where people's profile pictures are kept (D-19), and a home's
// own storage: WebDAV, or a Google Drive account from Connect apps (D-26, D-80). A copy built on Mercbot may check every
// picture and video before it's kept or sent (`mercbot.media-check`, D-90): uploads and profile pictures on their way in,
// screenshots and the files bots save afterwards, from media_checks.
const FilesFeature = defineFeature({
  id: "mercbot.files",
  domain: "files",
  owns: FILES_OWNS,
  systemScope:
    "open each home's own file storage for its bots, move a home's files to the storage it chose and sweep the moves whose server stopped, start, beat, finish and sweep the bots' command runs, count and limit the internet they use by home and day and by bot and minute, and keep the versions of the pages bots save, which run on no request, in any home; reach the Google Drive account a home keeps its files in, as the person it belongs to; queue and check the pictures and videos bots save and their computers' screenshots, in every home; keep which files key a new files bucket uses, for every server",
  requires: {
    records: "mercbot.bots.records",
    http: "runtime.http",
    fastify: "runtime.fastify",
    uploads: "runtime.uploads",
    storage: "runtime.storage",
    integrations: "mercbot.integrations",
    env: "runtime.env",
    meter: "mercbot.meter",
    sweeps: "mercbot.account.sweeps"
  },
  optional: {
    mediaCheck: "mercbot.media-check"
  },
  provides: {
    files: "mercbot.files"
  },
  /**
   * @param {object} capabilities
   * @param {{ directory: object, chats: object }} capabilities.records mercbot.bots.records
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads
   * @param {import("@jskit-ai/storage-runtime/server/types").RuntimeStorage} capabilities.storage
   * @param {import("@local/integrations/server/types").Integrations} capabilities.integrations
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@local/account/server/types").Meter} capabilities.meter what the bots' commands run is recorded through (D-73)
   * @param {{ useFilesSync: (sync: object | null) => void }} capabilities.sweeps the account's sweeps, whose usage archive
   *   is kept in the files bucket when there is one (D-91)
   * @param {import("@local/account/server/types").MediaCheck | null} capabilities.mediaCheck how a copy checks pictures and videos (D-90)
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  async setup({ records, http, fastify, uploads, storage, integrations, env, meter, sweeps, mediaCheck, resources, systemContext }) {
    const runtime = createFilesRuntime({ resources, systemContext, env, meter, integrations, mediaCheck });
    // Copy to… and Move to… between the places a person can open: chats and bots are the records' (D-120).
    const files = Object.freeze({ ...runtime, transfer: createFileTransfer({ files: runtime, records }) });
    sweeps.useFilesSync(files.volume.sync);
    registerRoutes(http, { files, records, uploads });
    // A Google Drive mount's rclone asks this server for its keys, at its own address (D-80), and so does a move's,
    // so this server carries on moves whose server stopped only once it listens.
    await registerDriveTokenRoute(fastify, files.mounts);
    fastify.addHook("onListen", () => {
      files.mounts.listening(fastify.server.address());
      files.moves.startSweeping();
      // Every server checks the pictures and videos waiting for a check (D-15), with a copy that checks them.
      files.media.startSweeping();
      // What this server writes in its copy of the files bucket goes there every few seconds too (D-91).
      if (files.volume.kind === "bucket") files.volume.startSyncing();
    });
    registerPageRoutes(http, { pages: files.pages, directory: records.directory });
    // JSKIT's profile pictures go on the shared volume, from wherever JSKIT's storage kept them.
    const earlier = storage.getMount().driver;
    storage.mount(PROFILE_PICTURES, profilePictureDriver({
      folder: files.store.profilePicturesFolder,
      saved: files.store.settleProfilePicture,
      earlier,
      media: files.media
    }));
    return { files };
  },
  // Shutting down (D-19): every save reaches people's own storage before the mounts close.
  async shutdown(_dependencies, { outputs }) {
    // Moves running here stop where they are; another server carries them on (D-80).
    outputs.files.moves.stopAll();
    // Media checks this server took go to another once their lease runs out (D-90).
    outputs.files.media.stop();
    await outputs.files.shell.drain();
    await outputs.files.mounts.closeAll();
    // Everything written here reaches the files bucket before the server stops (D-19, D-91).
    if (outputs.files.volume.kind === "bucket") await outputs.files.volume.stop();
  }
});

export { FilesFeature };
