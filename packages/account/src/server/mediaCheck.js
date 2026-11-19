// Pictures and videos a copy built on Mercbot checks before they're kept or shown (D-90). Mercbot itself checks
// nothing: without a checker (`mercbot.media-check`, types.js MediaCheck) every file is allowed and nothing changes.
// What a file is comes from its own first bytes (its magic numbers), never from its name or what a browser said, and only
// pictures and videos are ever passed to a checker. A checker that throws, or answers no verdict, counts as
// "unavailable": a file that couldn't be checked is never let through as if it had been.

/** How many first bytes say what a file is (an MPEG transport stream's third sync byte is at 376). */
export const SNIFF_BYTES = 512;

/** What the person is told, unless the checker gives its own sentence, of a file it blocked. */
export const MEDIA_BLOCKED = "This file can't be used.";
/** ...and of a file it couldn't check. */
export const MEDIA_UNAVAILABLE = "This file can't be checked right now. Try again in a few minutes.";

const VERDICTS = new Set(["allow", "block", "unavailable"]);
const ALLOWED = Object.freeze({ verdict: "allow", notice: null, ref: null });
const UNCHECKED = Object.freeze({ verdict: "unavailable", notice: null, ref: null });

const ascii = (bytes, from, length) => bytes.subarray(from, from + length).toString("latin1");
const startsWith = (bytes, signature, at = 0) =>
  bytes.length >= at + signature.length && signature.every((byte, index) => bytes[at + index] === byte);

// ISO base media files (MP4, MOV, 3GP, HEIC, AVIF) name what they are by their `ftyp` box's brands.
const BRANDS = new Map([
  ...["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"].map((brand) => [brand, "image/heic"]),
  ...["mif1", "msf1"].map((brand) => [brand, "image/heif"]),
  ...["avif", "avis"].map((brand) => [brand, "image/avif"]),
  ...["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "mp71", "avc1", "dash", "f4v ", "mmp4", "MSNV", "NDAS"]
    .map((brand) => [brand, "video/mp4"]),
  ["M4V ", "video/x-m4v"],
  ["M4VH", "video/x-m4v"],
  ["M4VP", "video/x-m4v"],
  ["qt  ", "video/quicktime"],
  ...["3gp4", "3gp5", "3gp6", "3gp7", "3ge6", "3ge7", "3gg6", "3gs7"].map((brand) => [brand, "video/3gpp"]),
  ...["3g2a", "3g2b", "3g2c"].map((brand) => [brand, "video/3gpp2"])
]);
// A picture's brands win over a video's among the compatible ones: an AVIF names mif1 and avif.
const BRAND_ORDER = ["image/avif", "image/heic", "image/heif"];
// Any other ISO base media file (an MPEG-4 sound, M4A, or a brand not listed) could hold a video, so it's checked as one.
const ANY_ISO = "video/mp4";

function isoMedia(bytes) {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return null;
  const boxEnd = Math.min(bytes.length, Math.max(16, bytes.readUInt32BE(0)));
  const brands = [ascii(bytes, 8, 4)];
  for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(ascii(bytes, at, 4));
  const known = brands.map((brand) => BRANDS.get(brand)).filter(Boolean);
  return BRAND_ORDER.find((mime) => known.includes(mime)) || known[0] || ANY_ISO;
}

// A BMP file starts with "BM" and has one of the known DIB header sizes at byte 14.
const BMP_HEADERS = new Set([12, 16, 40, 52, 56, 64, 108, 124]);
const OGG_VIDEO = Object.freeze(["\u0080theora", "\u0001video", "BBCD\u0000"]);

/** Each kind of picture or video, by its first bytes, as [mime, test]. */
const SIGNATURES = Object.freeze([
  ["image/jpeg", (b) => startsWith(b, [0xff, 0xd8, 0xff])],
  ["image/png", (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ["image/gif", (b) => ["GIF87a", "GIF89a"].includes(ascii(b, 0, 6))],
  ["image/webp", (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP"],
  ["image/bmp", (b) => b.length >= 18 && ascii(b, 0, 2) === "BM" && BMP_HEADERS.has(b.readUInt32LE(14))],
  ["image/tiff", (b) => [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a], [0x49, 0x49, 0x2b, 0x00], [0x4d, 0x4d, 0x00, 0x2b]].some((sig) => startsWith(b, sig))],
  ["image/x-icon", (b) => startsWith(b, [0x00, 0x00, 0x01, 0x00]) && b.length >= 6 && b.readUInt16LE(4) > 0],
  ["video/x-msvideo", (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "AVI "],
  ["video/webm", (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) && ascii(b, 0, Math.min(b.length, 64)).includes("webm")],
  ["video/x-matroska", (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])],
  ["video/mpeg", (b) => startsWith(b, [0x00, 0x00, 0x01, 0xba]) || startsWith(b, [0x00, 0x00, 0x01, 0xb3])],
  ["video/mp2t", (b) => b.length > 376 && b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47],
  // An Ogg file starts with each of its streams' first packets, which name their codecs: Theora, an OGM video stream or
  // Dirac is a video; Vorbis and Opus alone are sound.
  ["video/ogg", (b) => ascii(b, 0, 4) === "OggS" && OGG_VIDEO.some((codec) => ascii(b, 0, b.length).includes(codec))],
  ["video/x-flv", (b) => ascii(b, 0, 3) === "FLV" && b[3] === 0x01],
  ["video/x-ms-asf", (b) => startsWith(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])],
  // A QuickTime movie made before `ftyp` boxes starts with one of its own atoms.
  ["video/quicktime", (b) => b.length >= 8 && ["moov", "mdat", "wide", "pnot"].includes(ascii(b, 4, 4))]
]);

/**
 * What a file is by its first bytes (at least SNIFF_BYTES of them, or all of a shorter file): a picture or a video,
 * with its type, or null for anything else.
 * @param {Buffer} bytes
 * @returns {{ kind: "image" | "video", mime: string } | null}
 */
export function sniffMedia(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 3) return null;
  const mime = isoMedia(bytes) || SIGNATURES.find(([, test]) => test(bytes))?.[0] || null;
  return mime ? { kind: mime.startsWith("image/") ? "image" : "video", mime } : null;
}

const idOf = (value) => (value === null || value === undefined || value === "" ? null : String(value));
// Where a file is kept, as the checker gets it: a copy of its own, JSON-safe, so a checker may keep it and give it back.
const placeOf = (place) => (place && typeof place === "object" ? JSON.parse(JSON.stringify(place)) : null);

/** A checker's answer as Mercbot keeps it: its verdict, and its own sentence and reference when it gave them. */
function answerOf(answer) {
  return Object.freeze({
    verdict: answer.verdict,
    notice: typeof answer.notice === "string" && answer.notice.trim() ? answer.notice.trim() : null,
    ref: typeof answer.ref === "string" && answer.ref ? answer.ref : null
  });
}

/**
 * The checks every way in asks (D-90): `check` for a file, which it sniffs itself, passing only pictures and videos to
 * the checker, and `checkText` for what a picture is asked to show. Both answer `{ verdict, notice, ref }` and never
 * throw. Without a checker (`on` false) everything is allowed and nothing is asked.
 * @param {import("./types.js").MediaCheck | null | undefined} mediaCheck
 */
export function createMediaGuard(mediaCheck) {
  const on = Boolean(mediaCheck);

  /** The checker's answer, or "unavailable" when it threw or gave no verdict: logged in one line, never with the file. */
  async function ask(origin, question) {
    try {
      const answer = await question();
      if (VERDICTS.has(answer?.verdict)) return answerOf(answer);
      console.warn(`The media check (${origin}) gave no verdict; it counts as unavailable.`);
    } catch (error) {
      console.warn(`The media check (${origin}) failed; it counts as unavailable: ${String(error?.message || error).split("\n")[0]}`);
    }
    return UNCHECKED;
  }

  /**
   * `place` is the files place a file is kept in (fileStore.js), given only for an upload and a saved file.
   * @param {{ bytes: Buffer, origin: import("./types.js").MediaOrigin, workspaceId?: unknown, userId?: unknown,
   *   botId?: unknown, conversationId?: unknown, place?: object | null, path?: string | null, ip?: string | null }} item
   */
  async function check({
    bytes, origin, workspaceId = null, userId = null, botId = null, conversationId = null, place = null, path = null, ip = null
  }) {
    if (!on) return ALLOWED;
    const media = sniffMedia(bytes);
    if (!media) return ALLOWED;
    return ask(origin, () => mediaCheck.check({
      bytes,
      mime: media.mime,
      origin,
      workspaceId: idOf(workspaceId),
      userId: idOf(userId),
      botId: idOf(botId),
      conversationId: idOf(conversationId),
      place: placeOf(place),
      path: path ?? null,
      ip: ip ?? null
    }));
  }

  /**
   * @param {{ text: string, origin: "picture_prompt", workspaceId?: unknown, userId?: unknown, botId?: unknown,
   *   conversationId?: unknown }} item
   */
  async function checkText({ text, origin, workspaceId = null, userId = null, botId = null, conversationId = null }) {
    if (!on) return ALLOWED;
    return ask(origin, () => mediaCheck.checkText({
      text: String(text),
      origin,
      workspaceId: idOf(workspaceId),
      userId: idOf(userId),
      botId: idOf(botId),
      conversationId: idOf(conversationId)
    }));
  }

  return Object.freeze({
    on,
    check,
    checkText
  });
}

/**
 * How a route refuses a file its check didn't allow: 422 `media_blocked` or 503 `media_check_unavailable`, in the
 * checker's own words when it gave them; null for a file it allowed.
 * @param {{ verdict: string, notice?: string | null }} answer
 * @returns {{ status: number, code: string, message: string } | null}
 */
export function mediaRefusal({ verdict, notice = null }) {
  if (verdict === "block") return { status: 422, code: "media_blocked", message: notice || MEDIA_BLOCKED };
  if (verdict === "unavailable") return { status: 503, code: "media_check_unavailable", message: notice || MEDIA_UNAVAILABLE };
  return null;
}
