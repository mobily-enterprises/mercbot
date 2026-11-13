import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataFolder } from "@local/account/data-folder";

// A person's own copy is opened with its key instead of a sign-in (D-81): 32 random bytes, as 64 lower-case hex
// characters, in <data folder>/mercbot.key, outside the release and readable by the person alone. `mercbot open` takes
// the browser to /open with it, and `mercbot new-key` replaces it.
const KEY = /^[0-9a-f]{64}$/u;

/**
 * Where this copy's key is kept.
 * @param {{ MERCBOT_DATA_DIR?: string }} env
 */
export function keyFile(env) {
  return path.join(dataFolder(env), "mercbot.key");
}

/**
 * This copy's key, made on its first start. A key file anyone else on this computer may read, or one that holds no
 * key, stops the start, saying how to fix it.
 * @param {{ MERCBOT_DATA_DIR?: string }} env
 */
export function loadKey(env) {
  const file = keyFile(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(`Mercbot's key, ${file}, can be read by other people on this computer. Make it yours alone with: chmod 600 ${file}`);
  }
  const key = readFileSync(file, "utf8").trim();
  if (!KEY.test(key)) throw new Error(`${file} holds no Mercbot key. Make a new one with: mercbot new-key`);
  return key;
}

const digest = (value) => createHash("sha256").update(value).digest();

/**
 * Whether `given` is the key: compared in constant time, and exactly, so a key in other letters is another key.
 * @param {string} key
 * @param {unknown} given
 */
export function keyMatches(key, given) {
  return typeof given === "string" && timingSafeEqual(digest(key), digest(given));
}

/**
 * The person's password, which follows the key: nobody types it, and a new key changes it.
 * @param {string} key
 */
export function passwordOf(key) {
  return createHmac("sha256", key).update("mercbot single-user sign-in").digest("hex");
}
