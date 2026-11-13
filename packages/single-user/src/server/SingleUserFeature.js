import { randomBytes } from "node:crypto";
import os from "node:os";
import { hashPassword, verifyPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { SINGLE_USER_EMAIL } from "@local/account/this-copy";
import { KEY_COOKIE, cookieOf } from "./gate.js";
import { keyMatches, loadKey, passwordOf } from "./key.js";

// The browser keeps the key's cookie as long as browsers allow (400 days); `mercbot new-key` ends it sooner.
const KEY_COOKIE_OPTIONS = Object.freeze({ path: "/", httpOnly: true, sameSite: "strict", maxAge: 400 * 24 * 60 * 60 });
// Leaves /open?key=… for Mercbot itself, from its own page, so the key's SameSite=Strict cookie goes with it (a redirect
// from a page opened elsewhere, such as the file `mercbot open` opens, would go without it).
const OPENED = '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/">'
  + "<title>Mercbot</title><p><a href=\"/\">Open Mercbot</a></p></html>\n";

/**
 * Who runs this copy (`mercbot.copy-runners`): its one person, and nobody else.
 * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} profiles users.profiles
 */
export function oneRunner(profiles) {
  return Object.freeze({
    /**
     * @param {string} userId
     * @param {object} options the call's
     */
    async runsThisCopy(userId, options) {
      const user = await profiles.findById(String(userId), passedOn(options));
      return String(user?.email || "").toLowerCase() === SINGLE_USER_EMAIL;
    }
  });
}

// A person's own copy (D-81): one person, made on the first start, signed in by the copy's key
// instead of a password, who runs the copy (`mercbot.copy-runners`). The gate in front of every request (gate.js) has
// already checked the key; this signs the person in with JSKIT's own sessions, so everything else works as for anyone
// signed in: /open does it when `mercbot open` brings the key, and any later request with the key's cookie but no
// session (one that ran out) is signed in again before its route runs.
const SingleUserFeature = defineFeature({
  id: "mercbot.single-user",
  requires: {
    env: "runtime.env",
    fastify: "runtime.fastify",
    authService: "auth.service",
    accounts: "auth.local.accounts",
    sessions: "auth.local.sessions",
    profiles: "users.profiles"
  },
  provides: {
    copyRunners: "mercbot.copy-runners"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {import("@jskit-ai/auth-core/server/types").AuthService} capabilities.authService
   * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} capabilities.profiles
   */
  setup({ env, fastify, authService, profiles }) {
    const key = loadKey(env);

    /** Signs the person in on this reply, and for the rest of this request. */
    async function signIn(request, reply) {
      const { session } = await authService.login({ email: SINGLE_USER_EMAIL, password: passwordOf(key) });
      const cookies = [];
      authService.writeSessionCookies({ setCookie: (...cookie) => cookies.push(cookie) }, session);
      for (const [name, value, options] of cookies) {
        reply.setCookie(name, value, options);
        request.cookies[name] = value;
      }
    }

    fastify.get("/open", async (request, reply) => {
      if (!keyMatches(key, request.query?.key)) return reply.code(401).type("text/plain").send("Open Mercbot with mercbot open.");
      await signIn(request, reply);
      reply.setCookie(KEY_COOKIE, key, KEY_COOKIE_OPTIONS);
      return reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer").type("text/html; charset=utf-8").send(OPENED);
    });

    // Before JSKIT's own checks (its auth hooks are added once its plugins load, after this).
    fastify.addHook("preHandler", async (request, reply) => {
      if (authService.hasSessionCookie(request) || !keyMatches(key, cookieOf(request, KEY_COOKIE))) return;
      await signIn(request, reply);
    });
    return { copyRunners: oneRunner(profiles) };
  },
  /**
   * The person, made on the first start. Their password follows the key, so after `mercbot new-key` it's changed and
   * every session signed in with the old key ends.
   */
  async boot({ env, accounts, sessions }) {
    const password = passwordOf(loadKey(env));
    const person = await accounts.findByEmail(SINGLE_USER_EMAIL);
    if (!person) {
      await accounts.create({
        id: `usr_${randomBytes(18).toString("base64url")}`,
        email: SINGLE_USER_EMAIL,
        displayName: os.userInfo().username,
        password: await hashPassword(password)
      });
    } else if (!(await verifyPassword(password, person.password))) {
      await accounts.updatePassword(person.id, await hashPassword(password));
      await sessions.revokeForUser(person.id);
    }
  }
});

export { SingleUserFeature };
