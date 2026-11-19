import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { registerRoutes } from "../../packages/integrations/src/server/registerRoutes.js";
import { cookieName, cookieOptions, newBinding, sameBrowser } from "../../packages/integrations/src/server/signInBinding.js";
import { SIGN_IN_PAGE_SCRIPT, signInPage } from "../../packages/integrations/src/server/signInPage.js";

// A sign-in belongs to the browser that started it (D-97): the cookie it is given, what its sign-in keeps, and the
// Connect apps routes that set the cookie, hand it to the callback and clear it.

test("a sign-in's cookie is HttpOnly, SameSite=Lax, sent only to the callback, and Secure at an https address", () => {
  assert.deepEqual(cookieOptions({ APP_PUBLIC_URL: "https://mercbot.example/" }), {
    path: "/api/connections/callback",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 900
  });
  assert.equal(cookieOptions({ APP_PUBLIC_URL: "http://localhost:3001" }).secure, false, "a copy on its own computer");
  assert.equal(cookieOptions({ PORT: "3001" }).path, "/api/connections/callback");
  assert.equal(cookieOptions({ APP_PUBLIC_URL: "https://example.org/mercbot" }).path, "/mercbot/api/connections/callback");
  assert.equal(cookieOptions({ APP_PUBLIC_URL: "https://mercbot.example" }, 0).maxAge, 0);
});

test("only the cookie a sign-in's browser was given proves the browser; the sign-in keeps its hash", () => {
  const state = "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE";
  const { cookie, binding } = newBinding(state);
  assert.equal(cookie.name, cookieName(state));
  assert.equal(cookie.name, "mercbot_sign_in_abcdefghijklmnop");
  assert.match(cookie.value, /^[\w-]{43}$/u);
  assert.notEqual(binding, cookie.value);
  assert.ok(binding.length <= 64, "fits oauth_states.binding");
  const row = { id: state, binding };
  assert.equal(sameBrowser(row, { [cookie.name]: cookie.value }), true);
  assert.equal(sameBrowser(row, {}), false, "no cookie");
  assert.equal(sameBrowser(row, null), false, "no cookies at all");
  assert.equal(sameBrowser(row, { [cookie.name]: `${cookie.value}x` }), false, "another value");
  assert.equal(sameBrowser(row, { mercbot_sign_in_other: cookie.value }), false, "under another sign-in's name");
  assert.equal(sameBrowser({ id: state, binding: null }, { [cookie.name]: cookie.value }), false, "a sign-in not begun in any browser");
  assert.notEqual(newBinding(state).cookie.value, cookie.value, "every sign-in gets its own");
});

test("the sign-in page runs no inline script: its Copy button's script is served from Mercbot's own address", () => {
  const page = signInPage("Your organisation needs to approve Mercbot", "Send them the link.", { approval: "https://approve.example/?a=1&b=<2>", back: "/" });
  assert.doesNotMatch(page, /\son[a-z]+\s*=/iu, "no inline event handler");
  assert.deepEqual([...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gu)].map(([, attributes, body]) => [attributes.trim(), body]), [
    ['src="/api/connections/sign-in-page.js" defer', ""]
  ]);
  assert.match(page, /<button type="button" data-copy>Copy the link<\/button>/u);
  assert.match(page, /https:\/\/approve\.example\/\?a=1&#38;b=&#60;2&#62;/u);
  assert.doesNotMatch(signInPage("Connected to Google", "It's all set.", { back: "/" }), /<script/u, "only the approval page has one");
  assert.match(SIGN_IN_PAGE_SCRIPT, /querySelector\("\[data-copy\]"\)/u);
  assert.doesNotThrow(() => new Script(SIGN_IN_PAGE_SCRIPT), "the script parses");
});

/** The Connect apps routes registered on a stand-in router, with `connections` standing in for the sign-ins. */
function routes(connections, env = { APP_PUBLIC_URL: "https://mercbot.example" }) {
  const registered = new Map();
  const http = { router: { register: (method, path, _meta, handler) => registered.set(`${method} ${path}`, handler) } };
  registerRoutes(http, { integrations: { connections }, catalogue: [], env });
  return registered;
}

/** Calls a route handler as Fastify would, with `request`'s fields; answers what it sent and the cookies it set. */
async function call(handler, request) {
  const reply = { status: 200, headers: {}, set: [], cleared: [], body: undefined };
  const fake = {
    code(status) { reply.status = status; return this; },
    header(name, value) { reply.headers[name] = value; return this; },
    send(body) { reply.body = body; return this; },
    setCookie(name, value, options) { reply.set.push([name, value, options]); return this; },
    clearCookie(name, options) { reply.cleared.push([name, options]); return this; }
  };
  await handler({ params: {}, query: {}, body: {}, cookies: {}, ...request, callOptions: async () => ({ context: { who: "caller" } }) }, fake);
  return reply;
}

test("Connect sets the browser's cookie and keeps it out of the answer; the callback hands the cookies over and clears it", async () => {
  const cookie = { name: "mercbot_sign_in_0123456789abcdef", value: "proof" };
  const seen = [];
  const connections = {
    connect: async (_reach, accountId) => ({ url: `https://consent.example/?account=${accountId}`, cookie }),
    beginLentSignIn: async (state) => ({ url: `https://consent.example/?state=${state}`, app: "Gmail", cookie }),
    callback: async (query, cookies, options) => {
      seen.push([query, cookies, options.context]);
      return { provider: "Google", label: "pat@example.com" };
    }
  };
  const registered = routes(connections);

  const connected = await call(registered.get("POST /api/w/:workspaceSlug/plugin-accounts/:accountId/connect"), { params: { accountId: "7" } });
  assert.deepEqual(connected.body, { url: "https://consent.example/?account=7" });
  assert.deepEqual(connected.set, [[cookie.name, "proof", cookieOptions({ APP_PUBLIC_URL: "https://mercbot.example" })]]);

  const begun = await call(registered.get("POST /api/connections/lent/begin"), { body: { state: "s1" } });
  assert.deepEqual([begun.body, begun.set.length], [{ url: "https://consent.example/?state=s1", app: "Gmail" }, 1]);

  // A hub's own answer for a borrowed sign-in carries no cookie: none is set.
  const borrowed = routes({ connect: async () => ({ url: "https://hub.example/account/connect?lent=s2" }) });
  const viaHub = await call(borrowed.get("POST /api/w/:workspaceSlug/plugin-accounts/:accountId/connect"), { params: { accountId: "8" } });
  assert.deepEqual([viaHub.body, viaHub.set], [{ url: "https://hub.example/account/connect?lent=s2" }, []]);

  const state = "0123456789abcdefXYZ";
  const back = await call(registered.get("GET /api/connections/callback"), { query: { code: "c", state }, cookies: { [cookie.name]: "proof", other: "x" } });
  assert.deepEqual(seen, [[{ code: "c", state }, { [cookie.name]: "proof", other: "x" }, { who: "caller" }]]);
  assert.match(String(back.body), /Connected to Google/u);
  assert.deepEqual(back.cleared, [[cookie.name, cookieOptions({ APP_PUBLIC_URL: "https://mercbot.example" }, 0)]], "the cookie goes once used");
  assert.equal(back.headers["cache-control"], "no-store");

  const script = await call(registered.get("GET /api/connections/sign-in-page.js"), {});
  assert.deepEqual([script.headers["content-type"], script.body], ["text/javascript; charset=utf-8", SIGN_IN_PAGE_SCRIPT]);
});
