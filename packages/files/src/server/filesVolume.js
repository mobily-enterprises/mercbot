import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { newSealedKey, openSealedKey, openStream, sealStream, SealError } from "./filesCipher.js";
import { createS3Bucket, s3Settings } from "./s3Bucket.js";
import { createSyncedTree } from "./syncedTree.js";

// Where Mercbot's own files are kept (D-91): an S3 bucket every server shares, or, without one, a folder.
// - With the bucket's settings (s3Bucket.js) and MERCBOT_FILES_PASSPHRASE, every file is sealed (filesCipher.js) and
//   kept in the bucket, and this server works on a copy of what it uses in its files folder (MERCBOT_FILES_DIR, else
//   the data folder's files), kept in step with the bucket (syncedTree.js): pulled before it's read, pushed once it's
//   written and every PUSH_EVERY_MS, and pushed whole when the server stops. Nothing needs FUSE.
// - Without them, files are in the files folder itself: a single machine's, or a folder the host shares between
//   servers, which then holds the `.mercbot-files` marker (D-20).
// The bucket's key record is `.mercbot-files` at the prefix's top. A server that finds none makes a files key and
// offers its record to the database (files_keys, one row a bucket): the first offer is kept, and every server, of those
// starting together too, takes the kept one and writes it to the bucket, the same record every time. The database
// decides, not the store, so servers that start together on a new bucket all use one key on any store speaking the S3
// API: one that takes conditional writes, one that ignores them, and one that refuses them (answering If-None-Match
// 501 NotImplemented).
// The files folder is this server's own working copy in bucket mode, one server's alone: it's emptied when the server
// starts using it, since what's there was either pushed before it stopped or is from a server that stopped without
// it. One that holds files Mercbot didn't put there is never emptied: the bucket stays off and says why.
export const MARKER = ".mercbot-files";
const WORKING = ".mercbot-files-working";
const PUSH_EVERY_MS = 5000;
const RETRY_MS = 30000;

/**
 * The bucket as a synced tree's remote: each file sealed on its way up and opened on its way down, a folder an empty
 * object named with a trailing "/", as S3's own console keeps folders.
 */
function bucketRemote(bucket, filesKey, temporary) {
  return {
    async list(prefix) {
      const found = [];
      const dirs = new Set();
      for (const object of await bucket.list(`${prefix}/`)) {
        const rel = object.key.replace(/\/$/u, "");
        // A folder holding files is one even without its own object, as S3 shows it.
        for (let at = rel.lastIndexOf("/"); at > prefix.length; at = rel.lastIndexOf("/", at - 1)) dirs.add(rel.slice(0, at));
        if (object.key.endsWith("/")) dirs.add(rel);
        else found.push({ path: rel, size: object.size, version: object.etag, modified: object.modified });
      }
      return [...[...dirs].map((dir) => ({ path: dir, dir: true })), ...found];
    },
    download: (key, file) => bucket.readInto(key, (body) => pipeline(body, openStream(filesKey), createWriteStream(file))),
    async upload(file, key) {
      await fs.mkdir(temporary, { recursive: true });
      const sealed = path.join(temporary, `up-${randomBytes(8).toString("hex")}`);
      try {
        await pipeline(createReadStream(file), sealStream(filesKey), createWriteStream(sealed));
        return await bucket.write(key, { file: sealed, size: (await fs.stat(sealed)).size });
      } finally {
        await fs.rm(sealed, { force: true });
      }
    },
    remove: (key) => bucket.remove(key),
    makeDir: (key) => bucket.write(`${key}/`, Buffer.alloc(0)).then(() => {}),
    removeDir: (key) => bucket.remove(`${key}/`)
  };
}

/**
 * Which files key each bucket keeps, in the database (files_keys): `keep(bucket, record)` answers the record kept for
 * the bucket, `record` when it's the first offered. Of offers made at once, one is kept and every other answers it
 * (findOrCreate, outside a transaction).
 * @param {{ filesKeys: object, systemContext: (reason: string) => object }} dependencies
 */
export function databaseFilesKeys({ filesKeys, systemContext }) {
  return Object.freeze({
    async keep(bucket, record) {
      const kept = await filesKeys.findOrCreate({ id: bucket, record }, { context: systemContext("keep which files key a new files bucket uses") });
      return kept.record;
    }
  });
}

/** A bucket's name in files_keys: a digest of its endpoint, name and prefix, the same on every server. */
export function bucketId({ endpoint, bucket, prefix = "" }) {
  return createHash("sha256").update(`${endpoint}\n${bucket}\n${prefix}`).digest("hex");
}

/**
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} options.env
 * @param {string} options.folder the files folder (filesFolder)
 * @param {{ keep: (bucket: string, record: string) => Promise<string> }} options.keys which files key a new bucket keeps
 *   (databaseFilesKeys)
 * @param {(line: string) => void} [options.log]
 * @param {() => number} [options.now] the clock, in milliseconds, that spaces the files folder's pulls from the bucket
 *   (syncedTree.js)
 */
export function createFilesVolume({ env, folder, keys, log = (line) => console.warn(line), now = Date.now }) {
  const settings = s3Settings(env);
  const passphrase = String(env.MERCBOT_FILES_PASSPHRASE ?? "");
  const root = path.resolve(folder);
  if (!settings || settings.missing.length || !passphrase) {
    return Object.freeze({
      kind: "folder",
      root,
      tree: null,
      sync: null
    });
  }

  const bucket = createS3Bucket(settings);
  let ready = null;
  let failedAt = 0;
  let tree = null;
  let timer = null;
  let pushing = null;
  let lastFailure = 0;

  /** Makes the files folder this server's working copy, emptied; refuses one that holds anything else. */
  async function claimFolder() {
    await fs.mkdir(root, { recursive: true });
    const stamped = await fs.access(path.join(root, WORKING)).then(() => true, () => false);
    const names = (await fs.readdir(root)).filter((name) => name !== WORKING && name !== MARKER);
    if (!stamped && names.length) {
      throw new Error(`the files folder ${root} holds files that aren't a copy of the files bucket; empty it, or set MERCBOT_FILES_DIR to an empty folder`);
    }
    for (const name of names) await fs.rm(path.join(root, name), { recursive: true, force: true });
    await fs.writeFile(path.join(root, WORKING), "a working copy of the files bucket\n");
  }

  /** The files key: the bucket's, or, the first time it has none, the one the database keeps for it. */
  async function filesKey() {
    const found = await bucket.read(MARKER);
    if (found) return openSealedKey(passphrase, found);
    const made = await newSealedKey(passphrase);
    const kept = await keys.keep(bucketId(settings), made.record);
    // Every server writes the record kept, the same bytes: a plain write, which every S3 store takes.
    await bucket.write(MARKER, Buffer.from(kept));
    return openSealedKey(passphrase, kept);
  }

  async function start() {
    await claimFolder();
    const key = await filesKey();
    tree = createSyncedTree({ root, remote: bucketRemote(bucket, key, path.join(root, ".mbsync")), now });
    // What reads the files folder itself (the usage archive) sees it's in use.
    await fs.writeFile(path.join(root, MARKER), "bucket\n");
    return true;
  }

  /** Whether the bucket is there to use: its key opened and the files folder claimed. Tried again after a failure. */
  async function available() {
    if (!ready && Date.now() - failedAt > RETRY_MS) {
      ready = start().catch((error) => {
        failedAt = Date.now();
        ready = null;
        log(`The files bucket isn't available, so files can't be read or saved: ${error instanceof SealError ? error.message : error?.message}`);
        return false;
      });
    }
    return ready ? ready : false;
  }

  async function pushAll() {
    if (!tree) return;
    const failures = await tree.pushAll();
    if (failures.length && Date.now() - lastFailure > 60000) {
      lastFailure = Date.now();
      log(`Sending files to the files bucket failed for ${failures.length} folder(s), tried again in a moment: ${failures[0].error?.message}`);
    }
  }

  /** Pushes everything changed here every PUSH_EVERY_MS, once this server is up. */
  function startSyncing() {
    if (timer) return;
    timer = setInterval(() => {
      if (!pushing) pushing = pushAll().finally(() => (pushing = null));
    }, PUSH_EVERY_MS);
    timer.unref();
  }

  /** Stops the timer and pushes what's left (D-19); the folder stays this process's until it exits. */
  async function stop() {
    clearInterval(timer);
    timer = null;
    await pushing;
    await pushAll();
    bucket.close();
  }

  /** Runs `work` on the tree once the bucket is there to use, else fails saying so. */
  async function withTree(work) {
    if (!(await available())) throw new Error("The files bucket isn't available right now.");
    return work(tree);
  }
  /**
   * The working copy for what writes into the files folder outside the file store (the usage archive, which the
   * account feature keeps): see retention.js's FilesSync.
   */
  const sync = Object.freeze({
    available,
    pull: (rel, how) => withTree((ready) => ready.pull(rel, how)),
    push: (rel) => withTree((ready) => ready.push(rel)),
    removeTree: (rel) => withTree((ready) => ready.removeTree(rel))
  });

  return Object.freeze({
    kind: "bucket",
    root,
    available,
    get tree() {
      return tree;
    },
    sync,
    startSyncing,
    stop
  });
}
