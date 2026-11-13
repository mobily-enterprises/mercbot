import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Vault secrets (D-17): passwords, card numbers and codes are sealed with AES-256-GCM under
 * MERCBOT_VAULT_KEY (32 random bytes, base64) before they're stored, and checked when opened.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function vaultKey(env) {
  const raw = String(env.MERCBOT_VAULT_KEY || "");
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MERCBOT_VAULT_KEY must be 32 bytes, base64-encoded.");
  return key;
}

export function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function unseal(sealed, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(text);
}

/** Binary secrets, such as a bot's saved browser profile (D-19): sealed bytes, same key and mode. */
export function sealBytes(buffer, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function unsealBytes(sealed, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}
