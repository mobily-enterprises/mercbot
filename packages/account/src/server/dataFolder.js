import path from "node:path";

/**
 * This copy's data folder: MERCBOT_DATA_DIR, else `.data` in the release. Everything a copy keeps on its own disk goes
 * here, so an upgrade to a new release folder keeps it.
 * @param {{ MERCBOT_DATA_DIR?: string }} env
 */
export function dataFolder(env) {
  return path.resolve(env.MERCBOT_DATA_DIR || ".data");
}

/**
 * Where bots' and homes' files live: the shared volume (MERCBOT_FILES_DIR, D-20) when there is one, else
 * `<data folder>/files` on this machine.
 * @param {{ MERCBOT_FILES_DIR?: string, MERCBOT_DATA_DIR?: string }} env
 */
export function filesFolder(env) {
  return env.MERCBOT_FILES_DIR ? path.resolve(env.MERCBOT_FILES_DIR) : path.join(dataFolder(env), "files");
}
