import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt } from "node:crypto";
import { Transform } from "node:stream";
import { promisify } from "node:util";

// Files are sealed before they reach the bucket and opened after they leave it (D-91), so the bucket's owner never
// holds a readable file: what JuiceFS's encrypted volume did (D-20). One random key, the files key, seals them all;
// the key itself is kept in the bucket, sealed with a key made from MERCBOT_FILES_PASSPHRASE (scrypt), so a server
// needs only the passphrase, as with the volume.
//
// An object is "MBF1", 16 random bytes (the object's own key is made from the files key and them, HKDF-SHA256), then
// its contents in pieces of 64 KiB, each sealed with AES-256-GCM: an 11-byte counter and a last-piece flag make each
// piece's nonce, so pieces can't be reordered, dropped or cut off without the object failing to open (the STREAM
// construction). Sealing and opening are streams, so a file of any size passes through in pieces.
const MAGIC = Buffer.from("MBF1");
const SALT_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES;
export const PIECE_BYTES = 64 * 1024;
const TAG_BYTES = 16;
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const scryptAsync = promisify(scrypt);

export class SealError extends Error {}

function nonce(counter, last) {
  const value = Buffer.alloc(12);
  value.writeUIntBE(counter, 5, 6);
  value[11] = last ? 1 : 0;
  return value;
}

/** A new files key, sealed with the passphrase: what the bucket keeps (`.mercbot-files`). */
export async function newSealedKey(passphrase) {
  const key = randomBytes(32);
  const salt = randomBytes(16);
  const kek = await scryptAsync(String(passphrase), salt, 32, SCRYPT);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const sealed = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  return {
    key,
    record: JSON.stringify({ mercbotFiles: 1, kdf: "scrypt", ...SCRYPT, maxmem: undefined, salt: salt.toString("base64"), iv: iv.toString("base64"), sealed: sealed.toString("base64") })
  };
}

/** The files key from what the bucket keeps; a SealError when the passphrase doesn't open it. */
export async function openSealedKey(passphrase, text) {
  let record;
  try {
    record = JSON.parse(String(text));
  } catch {
    throw new SealError("The files bucket's key record can't be read.");
  }
  if (record?.mercbotFiles !== 1 || record.kdf !== "scrypt") throw new SealError("The files bucket's key record isn't one Mercbot made.");
  const kek = await scryptAsync(String(passphrase), Buffer.from(record.salt, "base64"), 32, { N: record.N, r: record.r, p: record.p, maxmem: SCRYPT.maxmem });
  const sealed = Buffer.from(record.sealed, "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(sealed.subarray(-TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, -TAG_BYTES)), decipher.final()]);
  } catch {
    throw new SealError("MERCBOT_FILES_PASSPHRASE doesn't open the files bucket's key.");
  }
}

const objectKey = (filesKey, salt) => Buffer.from(hkdfSync("sha256", filesKey, salt, "mercbot files object", 32));

/** A stream that seals what passes through it with the files key. */
export function sealStream(filesKey) {
  const salt = randomBytes(SALT_BYTES);
  const key = objectKey(filesKey, salt);
  let counter = 0;
  let pending = Buffer.alloc(0);
  const piece = (plain, last) => {
    const cipher = createCipheriv("aes-256-gcm", key, nonce(counter, last));
    counter += 1;
    return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  };
  let started = false;
  return new Transform({
    transform(chunk, _encoding, done) {
      if (!started) {
        this.push(Buffer.concat([MAGIC, salt]));
        started = true;
      }
      pending = Buffer.concat([pending, chunk]);
      // A full piece is sealed only once more follows it, so the last piece is always known as the last.
      while (pending.length > PIECE_BYTES) {
        this.push(piece(pending.subarray(0, PIECE_BYTES), false));
        pending = pending.subarray(PIECE_BYTES);
      }
      done();
    },
    flush(done) {
      if (!started) this.push(Buffer.concat([MAGIC, salt]));
      this.push(piece(pending, true));
      done();
    }
  });
}

/** A failure to open as a SealError: its own, or one saying the file didn't open. */
const asSealError = (error) =>
  (error instanceof SealError ? error : new SealError("A sealed file didn't open: it was changed, cut off or sealed with another key."));

/** A stream that opens what sealStream sealed; it fails on anything changed, cut off or sealed with another key. */
export function openStream(filesKey) {
  let key = null;
  let counter = 0;
  let pending = Buffer.alloc(0);
  const sealedPiece = PIECE_BYTES + TAG_BYTES;
  const open = (sealed, last) => {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce(counter, last));
    counter += 1;
    decipher.setAuthTag(sealed.subarray(-TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, -TAG_BYTES)), decipher.final()]);
  };
  return new Transform({
    transform(chunk, _encoding, done) {
      pending = Buffer.concat([pending, chunk]);
      try {
        if (!key) {
          if (pending.length < HEADER_BYTES) return done();
          if (!pending.subarray(0, MAGIC.length).equals(MAGIC)) throw new SealError("That object isn't one of Mercbot's sealed files.");
          key = objectKey(filesKey, pending.subarray(MAGIC.length, HEADER_BYTES));
          pending = pending.subarray(HEADER_BYTES);
        }
        while (pending.length > sealedPiece) {
          this.push(open(pending.subarray(0, sealedPiece), false));
          pending = pending.subarray(sealedPiece);
        }
        done();
      } catch (error) {
        done(asSealError(error));
      }
    },
    flush(done) {
      try {
        if (!key || pending.length < TAG_BYTES) throw new SealError("A sealed file is cut off.");
        this.push(open(pending, true));
        done();
      } catch (error) {
        done(asSealError(error));
      }
    }
  });
}

/** How big a file of `size` bytes is once sealed. */
export function sealedSize(size) {
  const pieces = Math.floor(size / PIECE_BYTES) + (size % PIECE_BYTES || size === 0 ? 1 : 0);
  return HEADER_BYTES + pieces * TAG_BYTES + size;
}
