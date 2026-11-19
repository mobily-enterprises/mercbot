import { assertAppEnvironment } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { appEnvironment, isStagingOrProduction } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { isLoopbackHost } from "@local/account/this-copy";
import { loadEnvFile } from "./envFile.js";
import { surfaceRuntime } from "./surfaceRuntime.js";

const DEFAULT_PORT = 3001;

/**
 * The port a value names, else DEFAULT_PORT.
 * @param {string | undefined} value
 */
function toPort(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_PORT;
}

/**
 * The process environment, with .env loaded and DB_CLIENT, SERVER_SURFACE, PORT and HOST resolved. Every value stays
 * a string, as the kernel's RuntimeEnv type says. It first stops, with JSKIT's own words, unless APP_ENV says where
 * the copy runs (D-87): set to development, test, staging or production, with NODE_ENV=production in staging and
 * production, and no SIDE_EFFECTS, which APP_ENV replaced. In staging and production, AUTH_LOCAL_EMAIL_CONFIRMATION is
 * "false" unless it's set: nobody registers on a person's own copy (D-81) and Mercbot sends no confirmation links, so
 * JSKIT, which would otherwise want a sender for them (`auth.local.confirmation-sender`), doesn't stop the start. A
 * copy built on Mercbot that confirms new accounts' addresses sets it, with its own sender.
 * @returns {import("@jskit-ai/kernel/server/types").RuntimeEnv}
 */
function resolveRuntimeEnv() {
  loadEnvFile();
  const serverSurface = surfaceRuntime.normalizeSurfaceMode(
    process.env.JSKIT_SERVER_SURFACE || process.env.SERVER_SURFACE
  );
  assertAppEnvironment(process.env);
  const unconfirmed = isStagingOrProduction(process.env) && !String(process.env.AUTH_LOCAL_EMAIL_CONFIRMATION || "").trim();
  return {
    ...process.env,
    ...(unconfirmed ? { AUTH_LOCAL_EMAIL_CONFIRMATION: "false" } : {}),
    DB_CLIENT: String(process.env.DB_CLIENT || "").trim() || "pg",
    SERVER_SURFACE: serverSurface,
    PORT: String(toPort(process.env.PORT)),
    HOST: String(process.env.HOST || "").trim() || "0.0.0.0"
  };
}

/**
 * Every link Mercbot sends people is built from APP_PUBLIC_URL, so a staging or production server (APP_ENV, D-87)
 * refuses to start with one that isn't https (D-65). The one exception is a copy only this computer reaches:
 * `http://localhost`, `http://127.0.0.1` or `http://[::1]`, on any port, while the server listens at a loopback HOST
 * too. Without one it starts, as anywhere else: links then point at http://localhost, and the start log says so
 * (keys.js). A missing or unknown APP_ENV throws, naming the fix.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
function checkPublicUrl(env) {
  if (!isStagingOrProduction(env)) return;
  const value = String(env.APP_PUBLIC_URL || "").trim();
  if (!value) return;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url?.protocol === "https:") return;
  const loopbackUrl = url?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (loopbackUrl && isLoopbackHost(env.HOST)) return;
  const where = appEnvironment(env);
  throw new Error(
    loopbackUrl
      ? `In ${where}, an http APP_PUBLIC_URL needs HOST set to 127.0.0.1 or ::1, so that only this computer reaches it; HOST is ${env.HOST || "unset"}.`
      : `In ${where}, APP_PUBLIC_URL must be this copy's https address, like https://example.com, or http://localhost:<port> with HOST set to 127.0.0.1.`
  );
}

export { DEFAULT_PORT, checkPublicUrl, resolveRuntimeEnv };
