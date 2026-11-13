import { describe, expect, it } from "vitest";
import { driveNotices, moveGoing, moveNotice, moveProgress, spaceLine } from "../../src/components/mercbot/storageNotices.js";

// What Settings → Files and the Files page say of a home's Google Drive (D-80), from what Mercbot last saw of it, and of
// a move of the home's files to other storage.
const GB = 1024 ** 3;
const drive = (fields = {}) => ({ kind: "drive", account: "pat@example.com", folder: "Mercbot – Home", signedIn: true, gone: false, folderState: "here", space: null, ...fields });
const keys = (storage, where = "settings") => driveNotices(storage, where).map((notice) => notice.key);

describe("a home's Google Drive", () => {
  it("tells the space, or what's used when the Drive has no limit", () => {
    expect(spaceLine({ used: 0.8 * GB, limit: 15 * GB, free: 14.2 * GB })).toBe("14.2 GB free of 15.0 GB.");
    expect(spaceLine({ used: 300 * 1024 ** 2, limit: null, free: null })).toBe("300.0 MB used.");
    expect(spaceLine(null)).toBe("");
  });

  it("says when Mercbot's folder is in the bin or deleted, with what to do where it's said", () => {
    expect(keys(drive())).toEqual([]);
    const [bin] = driveNotices(drive({ folderState: "bin" }), "settings");
    expect(bin.text).toBe("Mercbot's folder “Mercbot – Home” is in the bin of pat@example.com's Google Drive, and what the bots save goes to the bin with it. Google deletes what's in the bin after 30 days. Take the folder out of the bin in Google Drive, or choose again.");
    expect(driveNotices(drive({ folderState: "bin" }), "files")[0].text).toMatch(/or an owner or admin can choose again in Settings → Files\.$/u);
    expect(driveNotices(drive({ folderState: "missing" }), "settings")[0].text).toBe("Mercbot's folder “Mercbot – Home” was deleted from pat@example.com's Google Drive, with the files in it. To keep files there again, choose again: Mercbot makes a new folder.");
  });

  it("warns when the Drive is nearly full, and says when it's full", () => {
    expect(keys(drive({ space: { used: 14 * GB, limit: 15 * GB, free: GB, nearlyFull: false } }))).toEqual([]);
    const [nearly] = driveNotices(drive({ space: { used: 14.5 * GB, limit: 15 * GB, free: 0.5 * GB, nearlyFull: true } }), "files");
    expect(nearly.text).toBe("pat@example.com's Google Drive is nearly full: 512.0 MB free. Once it's full, the bots can't save files there. Free some space in Google Drive, or get more from Google.");
    expect(driveNotices(drive({ space: { used: 15 * GB, limit: 15 * GB, free: 0, nearlyFull: true } }), "files")[0].text).toMatch(/^pat@example\.com's Google Drive is full, so the bots can't save files there\./u);
    expect(keys(drive({ folderState: "bin", space: { used: 15 * GB, limit: 15 * GB, free: 0, nearlyFull: true } }))).toEqual(["bin", "space"]);
  });

  it("says nothing of a Drive that needs signing in again or was removed, or of other storage", () => {
    const full = { folderState: "bin", space: { used: 15 * GB, limit: 15 * GB, free: 0, nearlyFull: true } };
    expect(keys(drive({ ...full, signedIn: false }))).toEqual([]);
    expect(keys(drive({ ...full, gone: true }))).toEqual([]);
    expect(keys({ kind: "mercbot" })).toEqual([]);
    expect(keys(null)).toEqual([]);
  });
});

describe("a move of the home's files", () => {
  const move = (fields = {}) => ({
    status: "running", stage: "copying", from: { kind: "mercbot", label: "Mercbot" }, to: { kind: "drive", label: "Google Drive (pat@example.com)" },
    files: 1000, bytes: 15 * 1024 ** 2, filesDone: 120, bytesDone: 2 * 1024 ** 2, ...fields
  });

  it("says how far it's got", () => {
    expect(moveProgress(move())).toBe("Copied 120 of 1,000 files (2.0 MB of 15.0 MB).");
    expect(moveProgress(move({ stage: "waiting", files: null }))).toBe("Getting ready: the bots' computers go to sleep and their last saves finish.");
    expect(moveProgress(move({ stage: "counting", files: null }))).toBe("Counting the files…");
    expect(moveProgress(move({ stage: "commands" }))).toBe("Waiting for the bots' commands that started before the move: they may still save files.");
    expect(moveProgress(move({ stage: "checking" }))).toBe("Checking the copy of 1,000 files…");
    expect(moveProgress(move({ status: "switched", stage: "cleaning" }))).toBe("Switched. Putting the old copy away…");
  });

  it("tells the Files page while it runs, and nothing once it ended", () => {
    expect(moveNotice({ kind: "mercbot", move: move() })).toEqual({
      key: "moving",
      text: "Moving this home's files to Google Drive (pat@example.com): they're read-only until that's done, usually in a few minutes."
    });
    expect(moveGoing({ move: move({ status: "switched" }) })).toBe(true);
    for (const status of ["done", "failed", "cancelled"]) expect(moveNotice({ kind: "drive", move: move({ status }) })).toBe(null);
    expect(moveNotice({ kind: "mercbot", move: null })).toBe(null);
  });
});
