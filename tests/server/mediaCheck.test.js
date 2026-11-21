import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { MEDIA_BLOCKED, MEDIA_UNAVAILABLE, createMediaGuard, mediaRefusal, sniffMedia } from "../../packages/account/src/server/mediaCheck.js";
import { pictureRefusal } from "../../packages/bots/src/server/pictureMaker.js";
import { FilesError, createFileStore } from "../../packages/files/src/server/fileStore.js";
import { retryAfter } from "../../packages/files/src/server/mediaChecks.js";
import { profilePictureDriver } from "../../packages/files/src/server/profilePictures.js";
import { writeUpload } from "../../packages/files/src/server/uploadedFile.js";

// A copy built on Mercbot may check every picture and video before it's kept or sent (D-90): what a file is comes from
// its own first bytes; only pictures and videos reach the checker; a checker that fails counts as "unavailable"; and a
// refusal is 422 media_blocked or 503 media_check_unavailable, in the checker's words when it gave them.

const bytes = (...parts) => Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part))));
const pad = (buffer, size = 600) => Buffer.concat([buffer, Buffer.alloc(Math.max(0, size - buffer.length))]);
/** An ISO base media file's start: its `ftyp` box with a major brand and compatible ones. */
const ftyp = (major, ...compatible) => {
  const size = 16 + compatible.length * 4;
  return pad(bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...compatible));
};
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], "IHDR", [0, 0, 0, 1, 0, 0, 0, 1]);

const MEDIA = Object.freeze([
  ["a JPEG", pad(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF")), "image", "image/jpeg"],
  ["a PNG", PNG, "image", "image/png"],
  ["a GIF", pad(bytes("GIF89a")), "image", "image/gif"],
  ["an old GIF", pad(bytes("GIF87a")), "image", "image/gif"],
  ["a WebP", pad(bytes("RIFF", [0, 1, 0, 0], "WEBPVP8 ")), "image", "image/webp"],
  ["a BMP", pad(bytes("BM", Array(12).fill(0), [40, 0, 0, 0])), "image", "image/bmp"],
  ["a little-endian TIFF", pad(bytes([0x49, 0x49, 0x2a, 0x00])), "image", "image/tiff"],
  ["a big-endian TIFF", pad(bytes([0x4d, 0x4d, 0x00, 0x2a])), "image", "image/tiff"],
  ["a HEIC", ftyp("heic", "mif1", "heic"), "image", "image/heic"],
  ["a HEIF", ftyp("mif1", "mif1"), "image", "image/heif"],
  ["an AVIF", ftyp("avif", "mif1", "avif"), "image", "image/avif"],
  ["an AVIF named as HEIF first", ftyp("mif1", "mif1", "avif", "miaf"), "image", "image/avif"],
  ["an icon", pad(bytes([0, 0, 1, 0, 1, 0, 16, 16])), "image", "image/x-icon"],
  ["an MP4", ftyp("isom", "isom", "iso2", "mp41"), "video", "video/mp4"],
  ["an M4V", ftyp("M4V ", "M4V ", "mp42"), "video", "video/x-m4v"],
  ["a QuickTime movie", ftyp("qt  ", "qt  "), "video", "video/quicktime"],
  ["an old QuickTime movie", pad(bytes([0, 0, 0, 8], "moov")), "video", "video/quicktime"],
  ["a 3GP", ftyp("3gp4", "3gp4"), "video", "video/3gpp"],
  ["a WebM", pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], "webm")), "video", "video/webm"],
  ["a Matroska", pad(bytes([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88], "matroska")), "video", "video/x-matroska"],
  ["an AVI", pad(bytes("RIFF", [0, 1, 0, 0], "AVI LIST")), "video", "video/x-msvideo"],
  ["an MPEG program stream", pad(bytes([0, 0, 1, 0xba, 0x44])), "video", "video/mpeg"],
  ["an MPEG video", pad(bytes([0, 0, 1, 0xb3, 0x14])), "video", "video/mpeg"],
  ["an Ogg Theora video", pad(bytes("OggS", Array(24).fill(0), [0x80], "theora")), "video", "video/ogg"],
  // Its sound's first packet may come first.
  ["an Ogg video whose sound comes first", pad(bytes("OggS", Array(24).fill(0), [0x01], "vorbis", Array(40).fill(0), "OggS", Array(24).fill(0), [0x80], "theora")), "video", "video/ogg"],
  // Any other ISO base media file could hold a video, an MPEG-4 sound included, so it's checked as one.
  ["an M4A sound", ftyp("M4A ", "M4A ", "mp42", "isom"), "video", "video/mp4"],
  ["an ISO media file of a brand not listed", ftyp("zzzz", "zzzz"), "video", "video/mp4"]
]);

const NOT_MEDIA = Object.freeze([
  ["text", Buffer.from("Dear Ada, here are the minutes of Tuesday's meeting.")],
  ["a PDF", pad(bytes("%PDF-1.7\n"))],
  ["a ZIP or office document", pad(bytes([0x50, 0x4b, 0x03, 0x04]))],
  ["an Ogg Vorbis sound", pad(bytes("OggS", Array(24).fill(0), [0x01], "vorbis"))],
  ["a WAV sound", pad(bytes("RIFF", [0, 1, 0, 0], "WAVEfmt "))],
  ["an MP3 sound", pad(bytes("ID3", [4, 0, 0]))],
  ["a file that only says RIFF", pad(bytes("RIFF", [0, 1, 0, 0], "CDXA"))],
  ["two bytes", Buffer.from([0xff, 0xd8])],
  ["nothing", Buffer.alloc(0)]
]);

test("what a file is comes from its own first bytes: every common picture and video, and nothing else", () => {
  for (const [name, head, kind, mime] of MEDIA) assert.deepEqual(sniffMedia(head), { kind, mime }, name);
  for (const [name, head] of NOT_MEDIA) assert.equal(sniffMedia(head), null, name);
  assert.equal(sniffMedia("GIF89a"), null, "only bytes are read");
});

/** A checker that answers `answers` in turn (the last for ever after) and keeps what it was asked. */
function checker(...answers) {
  const asked = [];
  const next = async (item) => {
    asked.push(item);
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, check: next, checkText: next };
}

test("without a checker everything is allowed, and only pictures and videos are ever passed to one", async (t) => {
  const none = createMediaGuard(null);
  assert.equal(none.on, false);
  assert.deepEqual(await none.check({ bytes: PNG, origin: "upload" }), { verdict: "allow", notice: null, ref: null });
  assert.deepEqual(await none.checkText({ text: "a cat", origin: "picture_prompt" }), { verdict: "allow", notice: null, ref: null });

  const copy = checker({ verdict: "block", notice: "  Not on this copy.  ", ref: "check-17" });
  const guard = createMediaGuard(copy);
  assert.equal(guard.on, true);
  assert.equal((await guard.check({ bytes: Buffer.from("plain text"), origin: "upload" })).verdict, "allow");
  assert.equal(copy.asked.length, 0, "a file that isn't a picture or video never reaches the checker");
  // A chat's place (fileStore.js placeFor), as an upload route gives it.
  const place = { homeId: 5, chatId: 11, chatKind: "private", botId: 9 };
  const answer = await guard.check({ bytes: PNG, origin: "upload", workspaceId: 5, userId: 7, botId: 9, conversationId: 11, place, path: "/files/chat/Uploads/a.png", ip: "10.0.0.1" });
  assert.deepEqual(answer, { verdict: "block", notice: "Not on this copy.", ref: "check-17" });
  assert.deepEqual(copy.asked, [{
    bytes: PNG, mime: "image/png", origin: "upload", workspaceId: "5", userId: "7", botId: "9", conversationId: "11", place, path: "/files/chat/Uploads/a.png", ip: "10.0.0.1"
  }], "it gets the sniffed type, the ids as strings, null where there's none, and where the file is kept");
  // The place is the checker's own copy, JSON-safe, which it may keep and give back: changing it changes nothing here.
  assert.notEqual(copy.asked[0].place, place);
  copy.asked[0].place.homeId = 6;
  assert.equal(place.homeId, 5);
  await guard.checkText({ text: "a cat on a mat", origin: "picture_prompt", workspaceId: 5, userId: 7, botId: 9, conversationId: 11 });
  assert.deepEqual(copy.asked[1], { text: "a cat on a mat", origin: "picture_prompt", workspaceId: "5", userId: "7", botId: "9", conversationId: "11" });
  // An item kept nowhere a place says (a picture a bot makes, a Vault photo, a profile picture, a screenshot) has none;
  // a screenshot's conversationId is its computer's, a chat_bots id (mediaChecks.js).
  await guard.check({ bytes: PNG, origin: "screenshot", workspaceId: 5, conversationId: 31, path: "31-0123456789abcdef.jpg" });
  assert.equal(copy.asked[2].place, null);

  // A checker that fails, or answers no verdict, counts as "unavailable": logged in one line, never with the file.
  const warned = t.mock.method(console, "warn", () => {});
  const failing = createMediaGuard(checker(new Error("the service is down\nwith a stack below"), { verdict: "maybe" }, { notice: "x" }));
  for (let tries = 0; tries < 3; tries += 1) {
    assert.deepEqual(await failing.check({ bytes: PNG, origin: "picture" }), { verdict: "unavailable", notice: null, ref: null });
  }
  assert.deepEqual(await failing.checkText({ text: "a cat", origin: "picture_prompt" }), { verdict: "unavailable", notice: null, ref: null });
  const lines = warned.mock.calls.map((call) => call.arguments.join(" "));
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "The media check (picture) failed; it counts as unavailable: the service is down");
  assert.ok(lines.every((line) => !line.includes("\n") && !line.includes(PNG.toString("base64")) && !line.includes("IHDR")));
});

test("a refusal is 422 media_blocked or 503 media_check_unavailable, in the checker's words when it gave them", () => {
  assert.deepEqual(mediaRefusal({ verdict: "block" }), { status: 422, code: "media_blocked", message: MEDIA_BLOCKED });
  assert.equal(MEDIA_BLOCKED, "This file can't be used.");
  assert.deepEqual(mediaRefusal({ verdict: "unavailable", notice: null }), { status: 503, code: "media_check_unavailable", message: MEDIA_UNAVAILABLE });
  assert.equal(MEDIA_UNAVAILABLE, "This file can't be checked right now. Try again in a few minutes.");
  assert.equal(mediaRefusal({ verdict: "block", notice: "Not here." }).message, "Not here.");
  assert.equal(mediaRefusal({ verdict: "allow" }), null);
  // What make_picture tells the bot: its own sentence, or the checker's to say.
  assert.match(pictureRefusal("prompt", { verdict: "block", notice: null }), /^That picture can't be made from this description, so none was made\./u);
  assert.match(pictureRefusal("prompt", { verdict: "unavailable", notice: null }), /can't be checked right now.*try again in a few minutes/u);
  assert.match(pictureRefusal("picture", { verdict: "block", notice: "Not on this copy." }), /can't be shown, so it wasn't kept.*"Not on this copy\."/u);
  assert.match(pictureRefusal("picture", { verdict: "unavailable", notice: null }), /wasn't kept or shown.*try again in a few minutes/u);
});

test("a check that can't be made is tried again after a minute, twice as long each time, up to half an hour", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map(retryAfter), [60, 120, 240, 480, 960, 1800, 1800]);
});

async function tempFolder(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-media-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** An upload as the multipart reader streams it: `chunks`, and `truncated` once it stopped at the limit. */
const uploaded = (chunks, truncated = false) => Object.assign(Readable.from(chunks), { truncated });
const ITEM = Object.freeze({
  origin: "upload", workspaceId: "5", userId: "7", botId: "9", conversationId: "11",
  place: { homeId: "5", chatId: "11", chatKind: "private", botId: "9" }, path: "/files/chat/Uploads/a.png", ip: "10.0.0.1"
});
const refusalOf = (promise) => promise.then(() => "kept", (error) => (error instanceof FilesError ? [error.statusCode, error.code, error.message] : error));

test("an upload that's a picture or video is read whole and checked before anything is written", async (t) => {
  const dir = await tempFolder(t);
  const target = (name) => path.join(dir, "Uploads", name);
  const big = Buffer.concat([PNG, Buffer.alloc(5000, 7)]);
  // Without a checker, and for any other file with one, it's written as it comes.
  await writeUpload(uploaded([big]), { target: target("plain.png"), media: createMediaGuard(null), item: ITEM });
  assert.deepEqual(await fs.readFile(target("plain.png")), big);
  const allowing = checker({ verdict: "allow" });
  const text = Buffer.from("Not a picture, whatever its name says.");
  await writeUpload(uploaded([text]), { target: target("notes.png"), media: createMediaGuard(allowing), item: ITEM });
  assert.deepEqual(await fs.readFile(target("notes.png")), text);
  assert.equal(allowing.asked.length, 0);

  // A picture arriving in small pieces is checked whole, then written whole.
  const pieces = Array.from({ length: Math.ceil(big.length / 100) }, (_, at) => big.subarray(at * 100, at * 100 + 100));
  await writeUpload(uploaded(pieces), { target: target("cat.png"), media: createMediaGuard(allowing), item: ITEM });
  assert.deepEqual(allowing.asked[0].bytes, big);
  assert.equal(allowing.asked[0].mime, "image/png");
  assert.deepEqual(allowing.asked[0].place, ITEM.place, "with the place it's kept in");
  assert.deepEqual(await fs.readFile(target("cat.png")), big);

  // Blocked, or not checkable now, it's refused, and nothing is written.
  const blocking = createMediaGuard(checker({ verdict: "block" }));
  assert.deepEqual(await refusalOf(writeUpload(uploaded([big]), { target: path.join(dir, "New", "x.png"), media: blocking, item: ITEM })),
    [422, "media_blocked", "This file can't be used."]);
  assert.equal(existsSync(path.join(dir, "New")), false, "not even its folder");
  assert.deepEqual(await refusalOf(writeUpload(uploaded([big]), { target: target("y.png"), media: createMediaGuard(checker(new Error("down"))), item: ITEM })),
    [503, "media_check_unavailable", "This file can't be checked right now. Try again in a few minutes."]);
  assert.equal(existsSync(target("y.png")), false);
  const noticed = createMediaGuard(checker({ verdict: "block", notice: "Pictures like this aren't kept here." }));
  assert.deepEqual(await refusalOf(writeUpload(uploaded([big]), { target: target("z.png"), media: noticed, item: ITEM })),
    [422, "media_blocked", "Pictures like this aren't kept here."]);

  // One over the limit is refused as too big, unchecked.
  const unasked = checker({ verdict: "allow" });
  assert.deepEqual((await refusalOf(writeUpload(uploaded([big], true), { target: target("huge.png"), media: createMediaGuard(unasked), item: ITEM }))).slice(0, 2),
    [413, "files_upload_too_big"]);
  assert.equal(unasked.asked.length, 0);
  assert.equal(existsSync(target("huge.png")), false);
});

test("a new profile picture is checked before it's written: one not allowed isn't kept", async (t) => {
  const dir = await tempFolder(t);
  await fs.writeFile(path.join(dir, ".mercbot-files"), "");
  const store = createFileStore({ root: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const earlier = { getItemRaw: async () => null, removeItem: async () => {} };
  const file = path.join(dir, "profile-pictures", "7", "avatar");
  const driverWith = (copy) => profilePictureDriver({ folder: store.profilePicturesFolder, earlier, media: createMediaGuard(copy) });

  assert.deepEqual(await refusalOf(driverWith(checker({ verdict: "block" })).setItemRaw("7:avatar", PNG)), [422, "media_blocked", "This file can't be used."]);
  assert.equal(existsSync(file), false);
  assert.deepEqual((await refusalOf(driverWith(checker(new Error("down"))).setItemRaw("7:avatar", PNG))).slice(0, 2), [503, "media_check_unavailable"]);
  assert.equal(existsSync(file), false);
  const allowing = checker({ verdict: "allow" });
  await driverWith(allowing).setItemRaw("7:avatar", PNG);
  assert.deepEqual(await fs.readFile(file), PNG);
  assert.deepEqual([allowing.asked[0].origin, allowing.asked[0].userId, allowing.asked[0].mime], ["profile_picture", "7", "image/png"]);
});

test("a copy's private folder is beside the store's own, for this server's user alone, and only while the volume is there", async (t) => {
  const dir = await tempFolder(t);
  await fs.writeFile(path.join(dir, ".mercbot-files"), "");
  const store = createFileStore({ root: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const folder = await store.privateFolder("kept-records");
  assert.equal(folder, path.join(dir, "kept-records"));
  assert.equal((await fs.stat(folder)).mode & 0o777, 0o700);
  assert.equal(await store.privateFolder("kept-records"), folder, "asking again answers the same folder");
  for (const name of ["homes", "runs", "computers", "profile-pictures", "usage-archive", "ab", "Kept", "../kept", "kept/records", "-kept", `k${"e".repeat(41)}`]) {
    await assert.rejects(store.privateFolder(name), /can't be a private folder's name/u, name);
  }
  await fs.rm(path.join(dir, ".mercbot-files"));
  assert.deepEqual((await refusalOf(store.privateFolder("other-records"))).slice(0, 2), [503, "files_unavailable"]);
  assert.equal(existsSync(path.join(dir, "other-records")), false);
});

test("every file a command may have written is found for its check, however many and wherever, hidden ones too", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mb-changed-since-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  // A Public chat's place, where a command writes in all three folders.
  const place = store.placeFor({ homeId: "11", chatId: "12", chatKind: "public", botId: "13" });
  await store.prepare(place);
  const write = async (virtualPath) => {
    const real = await store.resolve(place, virtualPath);
    await fs.mkdir(path.dirname(real), { recursive: true });
    await fs.writeFile(real, "x");
    return real;
  };
  const old = await write("/files/shared/Old/before.png");
  const before = new Date(Date.now() - 60000);
  await fs.utimes(old, before, before);
  const since = Date.now() - 1000;
  // More in one folder than a listing shows (its newest 300), in sub-folders, in all three folders, and hidden.
  const made = Array.from({ length: 320 }, (_, at) => `/files/chat/Frames/frame-${at}.png`);
  made.push("/files/bot/Clips/deep/er/clip.mp4", "/files/shared/team.png", "/files/chat/.hidden.png", "/files/chat/.cache/thumb.png");
  for (const virtualPath of made) await write(virtualPath);
  assert.deepEqual((await store.changedSince(place, since)).sort(), [...made].sort());
  assert.equal((await store.list(place)).chat.length, 300, "a listing stops at 300; the check's read doesn't");
});
