import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sealBytes, unsealBytes, vaultKey } from "@local/account/vault-crypto";

const SKIP = [
  "./Singleton*", "./Crashpad", "./BrowserMetrics*", "./GrShaderCache", "./GraphiteDawnCache", "./ShaderCache",
  "./GPUPersistentCache", "./component_crx_cache", "./optimization_guide_model_store", "./Safe Browsing",
  "./segmentation_platform", "./Default/Cache", "./Default/Code Cache", "./Default/GPUCache", "./Default/DawnGraphiteCache",
  "./Default/DawnWebGPUCache", "./Default/Service Worker/CacheStorage", "./Default/Service Worker/ScriptCache"
];
const MARKER = ".mercbot-saved-at";
const COOKIES = "cookies.sealed";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let errors = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => (
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${command} failed: ${errors.slice(-300)}`))
    ));
    child.stdin.end(input || undefined);
  });
}

/**
 * A bot computer's browser, saved and brought back. Without the vault key nothing is saved.
 *
 * A bot's browser state outside the machine (D-19). Workers are disposable, so a computer's
 * profile (its sign-ins and site data) is archived without caches, sealed with the vault key and
 * kept whenever the computer sleeps or its server shuts down. While it's awake its cookies are
 * snapshotted too when they change, so even a machine that dies without warning loses at most a
 * few seconds of sign-ins. Waking on any server restores the newest of both.
 *
 * The sealed bytes are files in the computer's folder on the shared volume (`folderOf`, D-50);
 * PostgreSQL keeps only which profile file is current, its sha256 and size, and the cookies'
 * sha256. A profile is written under a new name, recorded, and only then is the old one removed,
 * so a crash at any point leaves a whole profile to restore. Files whose sha256 doesn't match the
 * record are ignored.
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./computerRecords.js").createComputerRecords>} dependencies.records the saved browsers' records
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {(computerId: number | string) => Promise<string>} dependencies.folderOf The computer's
 *   folder on the shared volume.
 */
export function createBrowserState({ records, env, folderOf }) {
  const key = vaultKey(env);
  const available = Boolean(key);

  async function save(computerId, profileDir, url = "") {
    if (!available) return;
    const archive = await run("tar", ["--zstd", "-cf", "-", "-C", profileDir, ...SKIP.map((pattern) => `--exclude=${pattern}`), "."]);
    const sealed = sealBytes(archive, key);
    const folder = await folderOf(computerId);
    const file = `profile-${Date.now()}-${randomBytes(4).toString("hex")}.sealed`;
    await writeFile(path.join(folder, file), sealed);
    const written = await records.saveBrowser(computerId, {
      profileFile: file,
      profileSha256: sha256(sealed),
      profileBytes: sealed.length,
      profileSavedAt: new Date().toISOString(),
      url
    });
    // The conversation is gone: so is what it would have kept.
    if (!written) {
      await rm(path.join(folder, file), { force: true });
      return;
    }
    const { before, saved } = written;
    if (before?.profileFile && before.profileFile !== file) await rm(path.join(folder, before.profileFile), { force: true });
    await writeFile(path.join(profileDir, MARKER), new Date(saved.profileSavedAt).toISOString());
  }

  async function snapshotCookies(computerId, cookies, url = "") {
    if (!available) return;
    const sealed = sealBytes(Buffer.from(JSON.stringify(cookies)), key);
    const folder = await folderOf(computerId);
    const temporary = path.join(folder, `${COOKIES}.${randomBytes(4).toString("hex")}`);
    await writeFile(temporary, sealed);
    await rename(temporary, path.join(folder, COOKIES));
    await records.saveBrowser(computerId, { cookiesSha256: sha256(sealed), cookiesSavedAt: new Date().toISOString(), url });
  }

  /** A saved file's bytes, or null when it's missing or isn't the one recorded. */
  async function sealedFile(folder, file, expected) {
    const bytes = await readFile(path.join(folder, file)).catch(() => null);
    if (bytes && sha256(bytes) === expected) return bytes;
    console.warn(`A saved browser file (${file}) is ${bytes ? "not the one recorded" : "missing"}; it isn't restored.`);
    return null;
  }

  /**
   * Before Chrome starts: put the newest saved profile in place, and say which cookies and page
   * to bring back once it's running.
   */
  async function restore(computerId, profileDir) {
    if (!available) return { cookies: [], url: "" };
    const row = await records.savedBrowser(computerId);
    if (!row) return { cookies: [], url: "" };
    const folder = await folderOf(computerId);
    if (row.profileFile) {
      const saved = new Date(row.profileSavedAt).toISOString();
      const local = await readFile(path.join(profileDir, MARKER), "utf8").catch(() => "");
      const sealed = local === saved ? null : await sealedFile(folder, row.profileFile, row.profileSha256);
      if (sealed) {
        await rm(profileDir, { recursive: true, force: true });
        await mkdir(profileDir, { recursive: true });
        await run("tar", ["--zstd", "-xf", "-", "-C", profileDir], unsealBytes(sealed, key));
        await writeFile(path.join(profileDir, MARKER), saved);
      }
    }
    const newerCookies = row.cookiesSha256 && (!row.profileSavedAt || new Date(row.cookiesSavedAt) > new Date(row.profileSavedAt));
    const sealedCookies = newerCookies ? await sealedFile(folder, COOKIES, row.cookiesSha256) : null;
    return {
      cookies: sealedCookies ? JSON.parse(unsealBytes(sealedCookies, key).toString("utf8")) : [],
      url: row.url || ""
    };
  }

  /** Reset: the saved browser goes (the computer's screenshots stay, with its chat). */
  async function forget(computerId) {
    await records.forgetBrowser(computerId);
    const folder = await folderOf(computerId);
    for (const name of await readdir(folder).catch(() => [])) {
      if (name.startsWith("profile-") || name.startsWith(COOKIES)) await rm(path.join(folder, name), { force: true });
    }
  }

  return Object.freeze({
    available,
    save,
    snapshotCookies,
    restore,
    forget
  });
}
