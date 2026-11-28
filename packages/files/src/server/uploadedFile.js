import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SNIFF_BYTES, mediaRefusal, sniffMedia } from "@local/account/media-check";
import { FilesError } from "./fileStore.js";

/** The upload routes' size limit, which the multipart reader stops at (its stream is then `truncated`). */
export const UPLOAD_LIMIT = 150 * 1024 * 1024;
const LIMIT_MB = UPLOAD_LIMIT / (1024 * 1024);

/** The refusal of an upload over UPLOAD_LIMIT. */
export const tooBig = () =>
  new FilesError(413, `That file is too big; the limit is ${LIMIT_MB} MB.`, { code: "files_upload_too_big", params: { limitMb: LIMIT_MB } });

/** An upload's first bytes, read before anything is written, and all of it, those bytes first, as it comes. */
async function opened(stream) {
  const reader = stream[Symbol.asyncIterator]();
  const chunks = [];
  let size = 0;
  let ended = false;
  while (size < SNIFF_BYTES && !ended) {
    const next = await reader.next();
    ended = Boolean(next.done);
    if (!ended) {
      chunks.push(next.value);
      size += next.value.length;
    }
  }
  async function* all() {
    yield* chunks;
    if (ended) return;
    for (let next = await reader.next(); !next.done; next = await reader.next()) yield next.value;
  }
  return { head: Buffer.concat(chunks), all };
}

/**
 * Writes an uploaded file's stream to `target`, its folder made as needed. With a copy that checks pictures and videos
 * (`media.on`, D-90), a file whose first bytes say it's one is read whole, up to UPLOAD_LIMIT, and checked before
 * anything is written: one the check blocks is refused (422 media_blocked), and so is one it can't check now (503
 * media_check_unavailable), each in the checker's words or Mercbot's, and nothing is kept. Any other file is written as it
 * comes, as it is without a checker. A file over the limit is refused (413) before it's checked; one written as it came
 * is the caller's to refuse once its stream is `truncated`.
 * @param {import("node:stream").Readable & { truncated?: boolean }} stream the multipart reader's file stream
 * @param {{ target: string, media: { on: boolean, check: Function }, item: Omit<import("@local/account/server/types").MediaItem, "bytes" | "mime"> }} where
 */
export async function writeUpload(stream, { target, media, item }) {
  const write = async (from) => {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await pipeline(from, fs.createWriteStream(target));
  };
  if (!media.on) return write(stream);
  const { head, all } = await opened(stream);
  if (!sniffMedia(head)) return write(Readable.from(all()));
  const chunks = [];
  for await (const chunk of all()) chunks.push(chunk);
  if (stream.truncated) throw tooBig();
  const bytes = Buffer.concat(chunks);
  const refusal = mediaRefusal(await media.check({ ...item, bytes }));
  if (refusal) throw new FilesError(refusal.status, refusal.message, { code: refusal.code });
  return write(Readable.from([bytes]));
}
