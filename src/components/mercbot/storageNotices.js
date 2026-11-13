import { formatSize } from "./filesApi.js";

// What Settings → Files and the Files page say of a home's Google Drive (D-80), from what Mercbot last saw of it
// (storageApi.get): Mercbot's folder put in the bin or deleted, and the Drive's space; and of a move of the home's files
// to other storage.

/** "14.2 GB free of 15.0 GB", or only what's used for a Drive without a limit; "" before Mercbot has looked. */
export function spaceLine(space) {
  if (!space) return "";
  return space.limit === null ? `${formatSize(space.used)} used.` : `${formatSize(space.free)} free of ${formatSize(space.limit)}.`;
}

/**
 * The home's Google Drive's problems everyone in the home should know of, each { key, text }: the folder in the bin
 * (key "bin") or deleted ("missing"), and the Drive full or nearly full ("space"). `where` is "settings" (Settings →
 * Files, whose owners and admins have Choose again beside it) or "files" (the Files page, which says where to go).
 * Nothing for a Drive that needs signing in again, which says so itself.
 * @param {object | null} storage storageApi.get's answer
 * @param {"settings" | "files"} where
 */
export function driveNotices(storage, where) {
  if (storage?.kind !== "drive" || !storage.signedIn || storage.gone) return [];
  const chooseAgain = where === "settings" ? "choose again" : "an owner or admin can choose again in Settings → Files";
  const notices = [];
  if (storage.folderState === "bin") {
    notices.push({
      key: "bin",
      text: `Mercbot's folder “${storage.folder}” is in the bin of ${storage.account}'s Google Drive, and what the bots save goes to the bin with it. Google deletes what's in the bin after 30 days. Take the folder out of the bin in Google Drive, or ${chooseAgain}.`
    });
  } else if (storage.folderState === "missing") {
    notices.push({
      key: "missing",
      text: `Mercbot's folder “${storage.folder}” was deleted from ${storage.account}'s Google Drive, with the files in it. To keep files there again, ${chooseAgain}: Mercbot makes a new folder.`
    });
  }
  const space = storage.space;
  if (space?.nearlyFull) {
    notices.push({
      key: "space",
      text: space.free
        ? `${storage.account}'s Google Drive is nearly full: ${formatSize(space.free)} free. Once it's full, the bots can't save files there. Free some space in Google Drive, or get more from Google.`
        : `${storage.account}'s Google Drive is full, so the bots can't save files there. Free some space in Google Drive, or get more from Google.`
    });
  }
  return notices;
}

/** Where a move's place keeps the files, in a sentence: "on Mercbot", "in Google Drive (pat@example.com)". */
export const keptIn = (place) => (place.kind === "mercbot" ? "on Mercbot" : `in ${place.label}`);

/** Whether the home's files are being moved (storageApi.get's `move`): running, or switched and putting the old copy away. */
export const moveGoing = (storage) => ["running", "switched"].includes(storage?.move?.status);

/**
 * Where a move of the home's files is, in words: "Copied 120 of 1,000 files (2.0 MB of 15.0 MB)." while copying.
 * @param {object} move storageApi.get's `move`
 */
export function moveProgress(move) {
  if (move.status === "switched") return "Switched. Putting the old copy away…";
  if (move.stage === "waiting") return "Getting ready: the bots' computers go to sleep and their last saves finish.";
  if (move.stage === "counting" || move.files === null) return "Counting the files…";
  if (move.stage === "commands") return "Waiting for the bots' commands that started before the move: they may still save files.";
  const count = (number) => number.toLocaleString("en");
  if (move.stage === "checking") return `Checking the copy of ${count(move.files)} files…`;
  return `Copied ${count(move.filesDone)} of ${count(move.files)} files (${formatSize(move.bytesDone)} of ${formatSize(move.bytes)}).`;
}

/** What the Files page says while the home's files are being moved, or null. */
export function moveNotice(storage) {
  if (!moveGoing(storage)) return null;
  return { key: "moving", text: `Moving this home's files to ${storage.move.to.label}: they're read-only until that's done, usually in a few minutes.` };
}
