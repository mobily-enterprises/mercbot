import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { createAccountService } from "../../packages/account/src/server/accountService.js";
import { createDriveStorage } from "../../packages/files/src/server/driveStorage.js";
import { registerDriveTokenRoute } from "../../packages/files/src/server/driveTokenRoute.js";
import { createFileMoves } from "../../packages/files/src/server/fileMoves.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createRemoteMounts } from "../../packages/files/src/server/remoteMounts.js";
import { createShellRuns } from "../../packages/files/src/server/shellRuns.js";
import { createStorageSettings } from "../../packages/files/src/server/storageSettings.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createIntegrationsService } from "../../packages/integrations/src/server/integrationsService.js";
import { PROVIDERS, createOAuth } from "../../packages/integrations/src/server/oauth.js";
import { ownedHandles } from "./ownedHandles.mjs";

// A Mercbot server's files modules for the tests of moving a home's files between storages (D-80, fileMoves.js), on the
// test database and the stand-in Drive (fakeDrive.mjs), which is Google's sign-in too. Several can run at once, in this
// process or another (moveServer.mjs), as servers do. Needs the toolbox's rclone (npm run tools:install).

const CATALOGUE = Object.freeze([{ id: "google-drive", name: "Google Drive", oauth: { provider: "google", scopes: ["https://www.googleapis.com/auth/drive"] } }]);

/**
 * The environment of a server whose homes keep files on `filesDir` (made Mercbot's shared volume here) or in the
 * stand-in Drive, which its rclone reaches through the stand-in's proxy.
 * @param {{ vault: string, drive: { url: string, proxy: string, caFile: string }, filesDir: string }} options
 */
export async function filesEnv({ vault, drive, filesDir }) {
  await fs.writeFile(path.join(filesDir, ".mercbot-files"), "");
  return {
    PATH: process.env.PATH,
    APP_PUBLIC_URL: "http://localhost:4000",
    MERCBOT_VAULT_KEY: vault,
    MERCBOT_FILES_DIR: filesDir,
    MERCBOT_TOOLS_DIR: path.resolve(".tools"),
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    MERCBOT_TEST_GOOGLE_DRIVE_URL: drive.url,
    MERCBOT_TEST_GOOGLE_DRIVE_PROXY: drive.proxy,
    MERCBOT_TEST_GOOGLE_DRIVE_CA: drive.caFile
  };
}

/** The handles the integrations, account and files features get, on the test's Knex. */
export function filesHandles(knex, context) {
  return ownedHandles(knex, context, {
    "mercbot.integrations": INTEGRATIONS_OWNS,
    "mercbot.account": ACCOUNT_OWNS,
    "mercbot.files": FILES_OWNS
  });
}

/**
 * One server: its files modules wired as filesRuntime.js wires them, and its own route for its rclone's Drive keys.
 * @param {{ handles: Awaited<ReturnType<typeof filesHandles>>, env: Record<string, string>, timing?: object }} options
 *   `timing` shortens the moves' waits (fileMoves.js)
 */
export async function startFilesServer({ handles, env, timing }) {
  const { profiles, features } = handles;
  const integrationsFeature = features["mercbot.integrations"];
  const { resources, systemContext } = features["mercbot.files"];
  const google = env.MERCBOT_TEST_GOOGLE_DRIVE_URL;
  const providers = { ...PROVIDERS, google: { ...PROVIDERS.google, server: { issuer: google, authorization_endpoint: `${google}/authorize`, token_endpoint: `${google}/token` } } };
  const accounts = createAccounts({ pluginAccounts: integrationsFeature.resources.pluginAccounts, systemContext: integrationsFeature.systemContext });
  const connections = createConnections({
    resources: integrationsFeature.resources,
    accounts,
    systemContext: integrationsFeature.systemContext,
    catalogue: CATALOGUE,
    env,
    providers,
    oauthClient: createOAuth({ env, insecure: true }),
    isMember: async () => true,
    recordActivity: async () => {},
    // This copy lends no sign-ins.
    bridgedSignIns: null
  });
  const account = createAccountService({ ...features["mercbot.account"], directory: { botOwner: async () => null }, profiles, env });
  const integrations = createIntegrationsService({
    resources: integrationsFeature.resources, accounts, catalogue: CATALOGUE, connections, account, profiles, systemContext: integrationsFeature.systemContext
  });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-files-server-"));
  const drive = createDriveStorage({ integrations, systemContext, env });
  const mounts = createRemoteMounts({ env, dataDir, driveKey: (homeId, settings, why) => storage.driveKey(homeId, settings, why) });
  const runs = createShellRuns({ shellRuns: resources.shellRuns, systemContext });
  const store = createFileStore({
    root: env.MERCBOT_FILES_DIR,
    ownStorage: (homeId, how) => storage.folder(homeId, how),
    settle: mounts.settle,
    explain: (homeId) => storage.explain(homeId)
  });
  const moves = createFileMoves({ fileStorage: resources.fileStorage, systemContext, env, store, mounts, drive, runs, timing });
  const storage = createStorageSettings({ fileStorage: resources.fileStorage, systemContext, env, mounts, drive, moves });
  const server = Fastify();
  await registerDriveTokenRoute(server, mounts);
  await server.listen({ host: "127.0.0.1", port: 0 });
  mounts.listening(server.server.address());
  return {
    storage,
    moves,
    store,
    runs,
    async close() {
      moves.stopAll();
      await mounts.closeAll();
      await server.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  };
}
