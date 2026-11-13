import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { startFakeDrive } from "../support/fakeDrive.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { createAccountService } from "../../packages/account/src/server/accountService.js";
import { seal, unseal } from "../../packages/account/src/server/vaultCrypto.js";
import { createDriveStorage } from "../../packages/files/src/server/driveStorage.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createStorageSettings } from "../../packages/files/src/server/storageSettings.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createIntegrationsService } from "../../packages/integrations/src/server/integrationsService.js";
import { PROVIDERS, createOAuth } from "../../packages/integrations/src/server/oauth.js";

// A home's files kept in Google Drive (D-80), against the disposable test database and the stand-in Drive
// (tests/support/fakeDrive.mjs), which is Google's token endpoint too: an owner or admin chooses one of the Google
// Drive accounts they reach, Mercbot makes its one folder there (and reuses it), a key that ran out is renewed once
// across two servers under the account's row lock, and a refused renewal asks to sign in again while the home's choice
// and its files stay. The mount itself is proven in driveMount.test.js.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const VAULT = randomBytes(32).toString("base64");
const VAULT_KEY = Buffer.from(VAULT, "base64");
const SETTINGS_UPDATE = "workspace.settings.update";
const catalogue = [{ id: "google-drive", name: "Google Drive", oauth: { provider: "google", scopes: ["https://www.googleapis.com/auth/drive"] } }];

async function setup(context) {
  const knex = await connectTestDatabase();
  const drive = await startFakeDrive({ proxy: false });
  const [pat, kim] = (await knex("users").orderBy("id").limit(2)).map((user) => String(user.id));
  const [home] = await knex("workspaces").insert({ slug: `drive-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, name: "Drive test", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: kim, role_sid: "member", status: "active" }
  ]);
  const added = [];
  context.after(async () => {
    await knex("file_storage").where({ workspace_id: homeId }).del();
    await knex("plugin_accounts").whereIn("id", added).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex.destroy();
    await drive.close();
  });
  const { profiles, features } = await ownedHandles(knex, context, {
    "mercbot.integrations": INTEGRATIONS_OWNS,
    "mercbot.account": ACCOUNT_OWNS,
    "mercbot.files": FILES_OWNS
  });
  const env = { APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_VAULT_KEY: VAULT, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret", MERCBOT_TEST_GOOGLE_DRIVE_URL: drive.url };
  const providers = { ...PROVIDERS, google: { ...PROVIDERS.google, server: { issuer: drive.url, authorization_endpoint: `${drive.url}/authorize`, token_endpoint: `${drive.url}/token` } } };
  const accountService = createAccountService({ ...features["mercbot.account"], directory: { botOwner: async () => null }, profiles, env, copyRunners: null });
  const integrationsFeature = features["mercbot.integrations"];
  const filesFeature = features["mercbot.files"];

  /** One server's modules, as IntegrationsFeature and the files runtime build them; its mounts only record. */
  const serve = () => {
    const accounts = createAccounts({ pluginAccounts: integrationsFeature.resources.pluginAccounts, systemContext: integrationsFeature.systemContext });
    const connections = createConnections({
      resources: integrationsFeature.resources,
      accounts,
      systemContext: integrationsFeature.systemContext,
      catalogue,
      env,
      providers,
      oauthClient: createOAuth({ env, insecure: true }),
      isMember: async () => true,
      recordActivity: async () => {},
      // This copy lends no sign-ins.
      bridgedSignIns: null
    });
    const integrations = createIntegrationsService({
      resources: integrationsFeature.resources, accounts, catalogue, connections, account: accountService, profiles, systemContext: integrationsFeature.systemContext
    });
    const driveStorage = createDriveStorage({ integrations, systemContext: filesFeature.systemContext, env });
    const mounted = [];
    const mounts = {
      folder: async (id, settings) => {
        mounted.push([String(id), settings.folderId]);
        return "/mounted";
      },
      stop: async () => {},
      refusal: async () => {}
    };
    // Choosing other storage moves the home's files there first (fileMoves.js, proven in fileMoves.integration.js); here
    // the home switches at once, as a move that found no files does.
    const moves = {
      start: async (id, { kind, ...settings }) => {
        await knex("file_storage").insert({ workspace_id: id, kind, settings: seal(settings, VAULT_KEY) }).onConflict("workspace_id").merge();
      }
    };
    const storage = createStorageSettings({ fileStorage: filesFeature.resources.fileStorage, systemContext: filesFeature.systemContext, env, mounts, drive: driveStorage, moves });
    return { drive: driveStorage, storage, mounted };
  };

  /** A Google Drive account signed in with the stand-in's keys; `fields` may make it the home's or change its key. */
  async function account(userId, label, { tokens, ...fields } = {}) {
    const { access, refresh, expiresAt } = drive.issue();
    const [row] = await knex("plugin_accounts").insert({
      user_id: userId,
      plugin_id: "google-drive",
      name: `drive-${randomBytes(4).toString("hex")}`,
      label,
      status: "connected",
      connected_at: new Date(),
      tokens: seal(tokens || { access, refresh, expiresAt, scope: "https://www.googleapis.com/auth/drive" }, VAULT_KEY),
      ...fields
    }).returning("*");
    added.push(row.id);
    return { id: String(row.id), access, refresh };
  }
  /** The request of someone in the home, as Settings → Files sends it; owners and admins may change its settings. */
  const as = (userId, permissions = [SETTINGS_UPDATE]) =>
    requestContextOptions({ user: { id: userId }, workspace: { id: homeId, name: "Drive test" }, permissions });
  const row = (id) => knex("plugin_accounts").where({ id }).first();
  const stored = async () => {
    const found = await knex("file_storage").where({ workspace_id: homeId }).first();
    return found ? { kind: found.kind, raw: JSON.stringify(found.settings), settings: unseal(found.settings, VAULT_KEY) } : null;
  };
  return { knex, drive, pat, kim, homeId, serve, account, as, row, stored };
}

test("an owner or admin keeps the home's files in a Google Drive they reach, in one folder Mercbot makes there", async (context) => {
  const { drive, pat, kim, homeId, serve, account, as, stored } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const kimDrive = await account(kim, "kim@example.com");
  const homeDrive = await account(kim, "family@example.com", { workspace_id: homeId });
  const { storage, mounted } = serve();

  // Pat may choose their own account or the home's, never Kim's own.
  const before = await storage.describe(as(pat));
  assert.equal(before.kind, "mercbot");
  assert.deepEqual(before.driveAccounts.map((found) => [found.id, found.label, found.home]).sort(), [[patDrive.id, "pat@example.com", false], [homeDrive.id, "family@example.com", true]].sort());
  await assert.rejects(storage.choose(homeId, { kind: "drive", accountId: kimDrive.id }, as(pat)), { code: "files_storage_drive_account_unknown" });
  await assert.rejects(storage.choose(homeId, { kind: "drive", accountId: "" }, as(pat)), { code: "files_storage_drive_account_unknown" });
  assert.equal(await stored(), null, "nothing was saved");

  // Chosen: Mercbot's folder, named after the home, is made in Pat's Drive and the home's files open there.
  const chosen = await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  const folder = drive.named("Mercbot – Drive test");
  assert.equal(folder.mimeType, "application/vnd.google-apps.folder");
  assert.deepEqual({ ...chosen, driveAccounts: undefined }, {
    kind: "drive", accountId: patDrive.id, account: "pat@example.com", folder: "Mercbot – Drive test", signedIn: true, gone: false, canSignIn: true, driveAccounts: undefined,
    folderState: "here", space: { used: 0, limit: 15 * 1024 ** 3, free: 15 * 1024 ** 3, nearlyFull: false, at: chosen.space?.at }, move: null
  });
  const saved = await stored();
  assert.deepEqual([saved.kind, saved.settings], ["drive", {
    accountId: patDrive.id, userId: pat, label: "pat@example.com", folderId: folder.id, folderName: "Mercbot – Drive test", driveFolders: { [patDrive.id]: folder.id }
  }]);
  assert.ok(!saved.raw.includes(folder.id) && !saved.raw.includes(patDrive.access), "the settings are sealed and hold no key");
  assert.equal(await storage.folder(homeId), "/mounted");
  assert.deepEqual(mounted, [[homeId, folder.id]]);

  // Saved again for the same account: the same folder, not a second one.
  await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  assert.equal((await stored()).settings.folderId, folder.id);
  assert.equal([...drive.files.values()].filter((file) => file.name === "Mercbot – Drive test").length, 1);

  // Kim, a member, sees it's Pat's and can't sign it in for them.
  const seenByKim = await storage.describe(as(kim, []));
  assert.deepEqual([seenByKim.kind, seenByKim.account, seenByKim.signedIn, seenByKim.canSignIn], ["drive", "pat@example.com", true, false]);

  // The home's own account, which Kim added: its owners and admins may sign it in again.
  const homeChoice = await storage.choose(homeId, { kind: "drive", accountId: homeDrive.id }, as(pat));
  assert.deepEqual([homeChoice.account, homeChoice.canSignIn], ["family@example.com", true]);
  assert.equal((await stored()).settings.userId, kim, "a home's account is reached as the person who added it");
  assert.notEqual((await stored()).settings.folderId, folder.id, "another Drive, another folder");
  assert.equal((await storage.describe(as(kim, []))).canSignIn, false);

  // Files that can be read where they are always move with the home.
  await assert.rejects(storage.choose(homeId, { kind: "mercbot", withoutFiles: true }, as(pat)), { code: "files_storage_move_needed" });

  // Back to Mercbot's storage, then to Pat's Drive again: Mercbot's folder there, with the files, not a second one.
  const homeFolder = (await stored()).settings.folderId;
  assert.equal((await storage.choose(homeId, { kind: "mercbot" }, as(pat))).kind, "mercbot");
  assert.equal(await storage.folder(homeId), null, "the bots' files are on Mercbot meanwhile");
  assert.equal((await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat))).folder, "Mercbot – Drive test");
  assert.equal((await stored()).settings.folderId, folder.id);
  await storage.choose(homeId, { kind: "drive", accountId: homeDrive.id }, as(pat));
  assert.equal((await stored()).settings.folderId, homeFolder, "each account keeps its own folder");
  assert.equal([...drive.files.values()].filter((file) => file.name === "Mercbot – Drive test").length, 2);

  // Google not answering when the folder is looked for doesn't make another one; once it's in the bin, it does.
  drive.state.unavailable = true;
  await assert.rejects(storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat)), { code: "files_storage_drive_unreachable" });
  drive.state.unavailable = false;
  assert.equal((await stored()).settings.folderId, homeFolder, "the choice didn't change");
  folder.trashed = true;
  await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  assert.notEqual((await stored()).settings.folderId, folder.id);
  assert.equal([...drive.files.values()].filter((file) => file.name === "Mercbot – Drive test" && !file.trashed).length, 2);
});

test("a mount gets Drive keys only while that Drive is the home's choice", async (context) => {
  const { pat, homeId, serve, account, as, stored } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const homeDrive = await account(pat, "family@example.com", { workspace_id: homeId });
  const { storage } = serve();
  await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  const mounted = (await stored()).settings;
  assert.equal((await storage.driveKey(homeId, mounted)).accessToken, patDrive.access);

  // Another server's mount, kept after the home moved to another Drive or back to Mercbot's storage, gets none.
  await storage.choose(homeId, { kind: "drive", accountId: homeDrive.id }, as(pat));
  await assert.rejects(storage.driveKey(homeId, mounted), { code: "files_storage_drive_not_chosen" });
  await storage.choose(homeId, { kind: "mercbot" }, as(pat));
  await assert.rejects(storage.driveKey(homeId, mounted), { code: "files_storage_drive_not_chosen" });
  // Chosen again: the same folder, so the same mount's settings get keys again.
  await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  assert.equal((await storage.driveKey(homeId, mounted)).accessToken, patDrive.access);
});

test("a key that ran out is renewed once across two servers, under the account's row lock", async (context) => {
  const { drive, pat, homeId, serve, account, row } = await setup(context);
  const old = drive.issue();
  drive.expire(old.access);
  const { id } = await account(pat, "pat@example.com", { tokens: { access: old.access, refresh: old.refresh, expiresAt: Date.now() - 1000 } });
  const settings = { kind: "drive", accountId: id, userId: pat, label: "pat@example.com", folderId: "f", folderName: "Mercbot" };

  // Two servers' mounts ask at once; Google takes a moment to renew, so both find the key run out.
  drive.state.renewalDelay = 300;
  const [one, two] = [serve(), serve()];
  const [first, second] = await Promise.all([one.drive.key(homeId, settings), two.drive.key(homeId, settings)]);
  assert.equal(drive.state.refreshes, 1, "Google was asked once");
  assert.equal(first.accessToken, second.accessToken);
  assert.notEqual(first.accessToken, old.access);
  assert.ok(first.expiresAt > Date.now() + 60000);
  const kept = unseal((await row(id)).tokens, VAULT_KEY);
  assert.deepEqual([kept.access, kept.refresh], [first.accessToken, old.refresh], "the new key is saved, the permission kept");

  // The key works, and the next ask uses it without renewing.
  const about = await fetch(`${drive.url}/drive/v3/about?fields=storageQuota`, { headers: { authorization: `Bearer ${first.accessToken}` } });
  assert.equal(about.status, 200);
  assert.equal((await one.drive.key(homeId, settings)).accessToken, first.accessToken);
  assert.equal(drive.state.refreshes, 1);
});

test("a key Drive turned down is renewed at once, once across two servers; a refused renewal signs it out at once", async (context) => {
  const { drive, pat, homeId, serve, account, as, row, stored } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const [one, two] = [serve(), serve()];
  await one.storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  const { settings } = await stored();
  assert.equal((await one.storage.driveKey(homeId, settings)).accessToken, patDrive.access, "an hour's key, not run out");

  // Drive turns that key down (as when the person removes Mercbot's access) though it hasn't run out: both servers'
  // mounts ask at once, and Google is asked once.
  drive.expire(patDrive.access);
  drive.state.renewalDelay = 300;
  const [first, second] = await Promise.all([
    one.storage.driveKey(homeId, settings, { refused: patDrive.access }),
    two.storage.driveKey(homeId, settings, { refused: patDrive.access })
  ]);
  drive.state.renewalDelay = 0;
  assert.equal(drive.state.refreshes, 1, "Google was asked once");
  assert.equal(first.accessToken, second.accessToken);
  assert.notEqual(first.accessToken, patDrive.access);
  assert.equal(unseal((await row(patDrive.id)).tokens, VAULT_KEY).access, first.accessToken, "the new key is saved");
  // A mount that still had the old key, asking later, takes the new one without asking Google.
  assert.equal((await one.storage.driveKey(homeId, settings, { refused: patDrive.access })).accessToken, first.accessToken);
  assert.equal(drive.state.refreshes, 1);

  // Access removed in Google: the new key is turned down too, and so is its renewal. The account is signed out at once,
  // so the home says "Sign in again", and another server's mount asking about the same key doesn't reach Google.
  drive.refuse();
  const tokenCalls = () => drive.requests.filter((request) => request === "POST /token").length;
  await assert.rejects(one.storage.driveKey(homeId, settings, { refused: first.accessToken }), { code: "files_storage_sign_in_again" });
  assert.equal((await row(patDrive.id)).status, "needs-auth");
  const asked = tokenCalls();
  await assert.rejects(two.storage.driveKey(homeId, settings, { refused: first.accessToken }), { code: "files_storage_sign_in_again" });
  assert.equal(tokenCalls(), asked, "Google wasn't asked again");
  assert.equal((await one.storage.describe(as(pat))).signedIn, false);
  await assert.rejects(one.storage.explain(homeId), { code: "files_storage_sign_in_again" }, "a Files page that found the storage not answering says why");
});

test("a mount the home left gets no renewal, even of a key Drive turned down", async (context) => {
  const { drive, pat, homeId, serve, account, as, stored } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const { storage } = serve();
  await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  const mounted = (await stored()).settings;
  await storage.choose(homeId, { kind: "mercbot" }, as(pat));
  drive.expire(patDrive.access);
  await assert.rejects(storage.driveKey(homeId, mounted, { refused: patDrive.access }), { code: "files_storage_drive_not_chosen" });
  assert.equal(drive.state.refreshes, 0, "Google wasn't asked");
  await storage.explain(homeId);
});

test("Settings → Files sees Mercbot's folder in the bin and the Drive's space; the Files page tells what was last seen", async (context) => {
  const { knex, drive, pat, kim, homeId, serve, account, as, stored } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const { storage } = serve();
  drive.state.quota = 15 * 1024 ** 3;
  const chosen = await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  assert.equal(chosen.folderState, "here");
  assert.deepEqual({ ...chosen.space, at: undefined }, { used: 0, limit: 15 * 1024 ** 3, free: 15 * 1024 ** 3, nearlyFull: false, at: undefined });
  const looks = () => drive.requests.filter((request) => request.startsWith("GET /drive/v3/about")).length;

  // Nearly full under 1 GB free; the Files page (not fresh) asks Drive nothing and tells what Settings saw.
  drive.state.quota = 512 * 1024 ** 2;
  const seen = await storage.describe(as(pat), { fresh: true });
  assert.deepEqual([seen.space.free, seen.space.nearlyFull], [512 * 1024 ** 2, true]);
  const before = looks();
  const filesPage = await storage.describe(as(kim, []));
  assert.equal(looks(), before, "the Files page doesn't look at Drive");
  assert.deepEqual([filesPage.space.nearlyFull, filesPage.folderState], [true, "here"]);

  // The person put Mercbot's folder in the bin.
  const { settings } = await stored();
  drive.files.get(settings.folderId).trashed = true;
  assert.equal((await storage.describe(as(pat), { fresh: true })).folderState, "bin");
  assert.equal((await storage.describe(as(kim, []))).folderState, "bin");

  // The key's renewal looks too: once the Drive has room and the folder is back, the next renewal says so.
  drive.state.quota = 15 * 1024 ** 3;
  drive.files.get(settings.folderId).trashed = false;
  await knex("plugin_accounts").where({ id: patDrive.id }).update({
    tokens: seal({ access: patDrive.access, refresh: patDrive.refresh, expiresAt: Date.now() - 1000 }, VAULT_KEY)
  });
  assert.equal((await storage.driveKey(homeId, settings)).renewed, true);
  const deadline = Date.now() + 5000;
  while ((await storage.describe(as(kim, []))).folderState !== "here") {
    assert.ok(Date.now() < deadline, "the renewal's look was kept");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await storage.describe(as(kim, []))).space.nearlyFull, false);

  // A key Drive turns down while Settings looks is renewed once, and the look goes on.
  const { accessToken } = await storage.driveKey(homeId, settings);
  drive.expire(accessToken);
  const refreshes = drive.state.refreshes;
  assert.equal((await storage.describe(as(pat), { fresh: true })).folderState, "here");
  assert.equal(drive.state.refreshes, refreshes + 1);

  // What was seen of another folder (a look that landed after the home chose again) is never told of this one.
  await knex("file_storage").where({ workspace_id: homeId }).update({ drive_look: JSON.stringify({ folderId: "another", folder: "bin", used: 1, limit: 1, at: new Date().toISOString() }) });
  const other = await storage.describe(as(kim, []));
  assert.deepEqual([other.folderState, other.space], [null, null]);
});

test("a refused renewal asks to sign in again; the home's choice and its files stay", async (context) => {
  const { knex, drive, pat, kim, homeId, serve, account, as, row, stored } = await setup(context);
  const patDrive = await account(pat, "pat@example.com");
  const { drive: driveStorage, storage, mounted } = serve();
  await storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat));
  const { settings } = await stored();

  // The person took Mercbot's access back in their Google account, and the key ran out.
  drive.refuse();
  drive.expire(patDrive.access);
  await knex("plugin_accounts").where({ id: patDrive.id }).update({
    tokens: seal({ access: patDrive.access, refresh: patDrive.refresh, expiresAt: Date.now() - 1000 }, VAULT_KEY)
  });
  await assert.rejects(driveStorage.key(homeId, settings), { code: "files_storage_sign_in_again", statusCode: 409, params: { account: "pat@example.com" } });
  const signedOut = await row(patDrive.id);
  assert.deepEqual([signedOut.status, signedOut.tokens], ["needs-auth", null], "the account says to sign in again in Connect apps too");

  // The bots' files say why, and nothing is opened anywhere else.
  await assert.rejects(storage.folder(homeId), { code: "files_storage_sign_in_again" });
  assert.deepEqual(mounted, []);
  const described = await storage.describe(as(pat));
  assert.deepEqual([described.kind, described.folder, described.signedIn, described.gone, described.canSignIn], ["drive", "Mercbot – Drive test", false, false, true]);
  assert.equal((await storage.describe(as(kim, []))).canSignIn, false, "only Pat can sign their own account in again");
  assert.deepEqual((await stored()).settings, settings, "the home's choice is kept");
  assert.ok(drive.named("Mercbot – Drive test"), "the folder and its files are untouched");
  await assert.rejects(storage.choose(homeId, { kind: "drive", accountId: patDrive.id }, as(pat)), { code: "files_storage_sign_in_again" });

  // Removed from Connect apps: the files say so, and an owner or admin chooses again.
  await knex("plugin_accounts").where({ id: patDrive.id }).del();
  await assert.rejects(storage.folder(homeId), { code: "files_storage_drive_gone" });
  const gone = await storage.describe(as(pat));
  assert.deepEqual([gone.gone, gone.signedIn, gone.canSignIn], [true, false, false]);
  // The files can't be read there, so they can't move: the home switches only without them, and they stay in the Drive.
  await assert.rejects(storage.choose(homeId, { kind: "mercbot" }, as(pat)), { code: "files_storage_source_unreadable", statusCode: 409 });
  await storage.choose(homeId, { kind: "mercbot", withoutFiles: true }, as(pat));
  const kept = await stored();
  assert.deepEqual([kept.kind, kept.settings], ["mercbot", { driveFolders: { [patDrive.id]: settings.folderId } }], "only which folder Mercbot made is kept");
  assert.equal(await storage.folder(homeId), null);
});
