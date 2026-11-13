import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { KEYS, keysOf, missingKeyLines } from "../../packages/account/src/server/keys.js";
import { vaultKey } from "../../packages/account/src/server/vaultCrypto.js";
import { vaultEntry } from "../../packages/account/src/server/vaultEntry.js";
import { PROVIDERS, createOAuth } from "../../packages/integrations/src/server/oauth.js";
import { withoutCredentials } from "../../tools/previewAi.mjs";

// Every key a copy of Mercbot can be given is optional: without one, its feature is off and the server says so at
// start, one line a missing key, naming the setting and what's off (keys.js, startServer).
const needed = (entry) => entry.settings.filter((setting) => !setting.optional).map((setting) => setting.name);
const everything = Object.fromEntries(KEYS.flatMap((entry) => entry.settings).map((setting) => [setting.name, "set"]));
// A value each AI kind accepts, so the kinds are set up when every setting is.
Object.assign(everything, { AI_PREMIUM_PROVIDER: "together", AI_ECONOMY_PROVIDER: "deepinfra", AI_IMAGES_PROVIDER: "gemini" });

test("a copy given nothing has every feature off, one line for each setting it needs", () => {
  const lines = missingKeyLines({});
  assert.deepEqual(lines.map((line) => line.split(" ")[0]), KEYS.flatMap(needed));
  // Exactly these: a person's own copy sends no email of its own, so it checks for no mail service.
  assert.deepEqual(lines.map((line) => line.split(" ")[0]), [
    "AI_PREMIUM_PROVIDER", "AI_PREMIUM_API_KEY", "AI_ECONOMY_PROVIDER", "AI_ECONOMY_API_KEY", "AI_IMAGES_PROVIDER",
    "AI_IMAGES_API_KEY", "APP_PUBLIC_URL", "MERCBOT_VAULT_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "MERCBOT_FILES_DIR", "MERCBOT_FILES_PASSPHRASE",
    "MERCBOT_HUB_URL"
  ]);
  assert.equal(
    lines[0],
    "AI_PREMIUM_PROVIDER isn't set, so this is off: Premium AI. Bots start no work: each says this copy's AI isn't set up, and which settings to add."
  );
  assert.deepEqual(keysOf({}).map((entry) => entry.status), KEYS.map(() => "missing"));
});

test("each key, missing alone, turns off its own feature and nothing else", () => {
  assert.deepEqual(missingKeyLines(everything), []);
  for (const entry of KEYS) {
    for (const name of needed(entry)) {
      const lines = missingKeyLines({ ...everything, [name]: "" });
      assert.deepEqual(lines, [`${name} isn't set, so this is off: ${entry.name}. ${entry.missing}`], name);
      assert.equal(keysOf({ ...everything, [name]: "" }).find((found) => found.name === entry.name).status, needed(entry).length > 1 ? "partly" : "missing", name);
    }
    // An optional setting, such as MERCBOT_FILES_BUCKET, never turns its feature off.
    for (const setting of entry.settings.filter((found) => found.optional)) assert.deepEqual(missingKeyLines({ ...everything, [setting.name]: "" }), [], setting.name);
  }
});

test("a test copy on the stand-in model has its AI, with no key", () => {
  const { AI_PREMIUM_API_KEY: _premium, AI_ECONOMY_API_KEY: _economy, AI_IMAGES_API_KEY: _images, ...keyless } = everything;
  assert.equal(missingKeyLines(keyless).length, 3, "without the stand-in, each kind's key is missing");
  assert.deepEqual(missingKeyLines({ ...keyless, MERCBOT_TEST_AI_URL: "http://127.0.0.1:4999" }), []);
  // Never in production, where the keys are needed (D-83).
  assert.equal(missingKeyLines({ ...keyless, MERCBOT_TEST_AI_URL: "http://127.0.0.1:4999", NODE_ENV: "production" }).length, 3);
});

// Where a feature is used, it says it's off. Here: the Google, Microsoft and GitHub apps, and the Vault key. Elsewhere:
// the AI kinds (aiKinds.test.js), the public address (publicUrl.test.js), the hub (connections.integration.js), images
// (aiKinds.test.js, vault.test.js) and the files volume (below, and files.test.js).
test("without its app, connecting Google, Microsoft or GitHub says sign-in isn't set up; without the Vault key, the Vault takes no logins", async () => {
  const oauth = createOAuth({ env: {} });
  for (const [id, name] of [["google", "Google"], ["microsoft", "Microsoft"], ["github", "GitHub"]]) {
    await assert.rejects(oauth.authorizeUrl(PROVIDERS[id], [], "state", "verifier"), {
      statusCode: 409,
      code: "integrations_sign_in_unset",
      message: `${name} sign-in isn't set up on this copy of Mercbot.`
    });
  }
  const login = { kind: "login", data: { label: "Bank", website: "https://bank.example", password: "secret" } };
  assert.throws(() => vaultEntry(login, vaultKey({})), {
    statusCode: 503,
    code: "account_vault_unavailable",
    message: "The vault isn't set up to keep passwords and cards on this server."
  });
  // A contact has nothing to seal, so the Vault still keeps those.
  assert.equal(vaultEntry({ kind: "contact", data: { fullName: "Pat" } }, vaultKey({})).label, "Pat");
});

// A Preview (bin/develop.js) and a Test Preview reach no outside service with a key from .env or Development Env: each
// outside service's credential is emptied, so its feature is off or has its stand-in, a copy built on Mercbot's own
// too (here, sign-in providers' and a human check's). The copy's own secrets stay.
test("a Preview empties every outside service's credential, and keeps the copy's own secrets", () => {
  const env = { ...everything, AUTH_GOOGLE_CLIENT_ID: "id", GOOGLE_TEST_CLIENT_SECRET: "secret", WEATHER_API_KEY: "w", GITHUB_TOKEN: "t" };
  for (const name of ["AUTH_GOOGLE_CLIENT_SECRET", "AUTH_MICROSOFT_CLIENT_ID", "AUTH_MICROSOFT_CLIENT_SECRET", "AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) {
    env[name] = "set";
  }
  Object.assign(env, { AUTH_LOCAL_SESSION_SECRET: "session", MERCBOT_VAULT_KEY: "vault", DB_PASSWORD: "db", MERCBOT_FILES_PASSPHRASE: "files" });
  withoutCredentials(env);
  const emptied = Object.keys(env).filter((name) => env[name] === "").sort();
  assert.deepEqual(emptied, [
    "ACCESS_KEY", "AI_ECONOMY_API_KEY", "AI_IMAGES_API_KEY", "AI_PREMIUM_API_KEY", "AUTH_GITHUB_CLIENT_ID", "AUTH_GITHUB_CLIENT_SECRET",
    "AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET", "AUTH_MICROSOFT_CLIENT_ID", "AUTH_MICROSOFT_CLIENT_SECRET", "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET", "GITHUB_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TEST_CLIENT_SECRET", "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET", "SECRET_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY", "WEATHER_API_KEY"
  ]);
  for (const name of ["AUTH_LOCAL_SESSION_SECRET", "MERCBOT_VAULT_KEY", "DB_PASSWORD", "MERCBOT_FILES_PASSPHRASE"]) assert.notEqual(env[name], "", name);
});

test("without its passphrase the files volume stays off, and Mercbot starts with its files in its data folder", async (context) => {
  // serve.sh in a folder of its own, whose bin/server.js says where files would go and stops.
  const root = await mkdtemp(path.join(os.tmpdir(), "mercbot-serve-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "bin"));
  await copyFile(path.resolve("scripts/serve.sh"), path.join(root, "scripts", "serve.sh"));
  await writeFile(path.join(root, "bin", "server.js"), "console.log(`files: ${process.env.MERCBOT_FILES_DIR ?? \"data folder\"}`);\n");
  const env = { PATH: process.env.PATH, MERCBOT_NAMESPACE: "own", MERCBOT_FILES_DIR: path.join(root, "volume") };
  const ran = spawnSync("bash", [path.join(root, "scripts", "serve.sh")], { env, encoding: "utf8" });
  assert.deepEqual([ran.status, ran.stdout], [0, "files: data folder\n"], ran.stderr);
  assert.match(ran.stderr, /^MERCBOT_FILES_PASSPHRASE isn't set, so the files volume isn't mounted at .+\/volume: files stay in this machine's data folder\.\n$/u);
});
