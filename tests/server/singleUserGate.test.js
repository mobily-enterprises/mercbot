import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSingleUserHost, cookieOf, refusalOf } from "../../packages/single-user/src/server/gate.js";
import { keyFile, keyMatches, loadKey } from "../../packages/single-user/src/server/key.js";

// A person's own copy (D-81): every request passes the gate before anything else sees it. Each rule, broken.
const key = randomBytes(32).toString("hex");
const copy = { key, port: 3001 };
const OWN = "127.0.0.1:3001";
const request = ({ method = "GET", url = "/", host = OWN, cookie = `mercbot_key=${key}`, origin } = {}) => ({
  method,
  url,
  headers: { ...(host === null ? {} : { host }), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }
});
const refused = (options, upgrade = false) => refusalOf(copy, request(options), upgrade)?.status ?? null;

test("only this computer's own address, on the server's own port, is answered", () => {
  for (const host of ["127.0.0.1:3001", "localhost:3001", "[::1]:3001", "LOCALHOST:3001"]) assert.equal(refused({ host }), null, host);
  for (const host of ["evil.example:3001", "evil.example", "127.0.0.1:3002", "127.0.0.1", "localhost", "localhost.evil.example:3001", "127.0.0.2:3001", "[::2]:3001", "", null]) {
    assert.equal(refused({ host }), 421, String(host));
  }
  // Another site's name for this computer is refused before the key is even looked at, the routes that prove
  // themselves included.
  assert.equal(refused({ host: "evil.example:3001", url: "/api/health", cookie: "" }), 421);
  assert.equal(refusalOf({ key, port: 80 }, request({ host: "localhost" }), false), null);
});

test("without the key's cookie, or with any other key, it says to open Mercbot with mercbot open", () => {
  for (const cookie of ["", `mercbot_key=${randomBytes(32).toString("hex")}`, `mercbot_key=${key.toUpperCase()}`, `mercbot_key=${key.slice(1)}`,
    `other=${key}`, `mercbot_keys=${key}`, `mercbot_key=${key}x`]) {
    assert.equal(refused({ cookie }), 401, cookie);
    assert.equal(refused({ url: "/api/session", cookie }), 401, cookie);
  }
  assert.equal(refused({ cookie: `a=1; mercbot_key=${key}; b=2` }), null);
  const refusal = refusalOf(copy, request({ cookie: "" }), false);
  assert.equal(refusal.text, "Open Mercbot with mercbot open.");
});

test("/open takes the key itself, exactly", () => {
  assert.equal(refused({ url: `/open?key=${key}`, cookie: "" }), null);
  for (const given of [key.toUpperCase(), randomBytes(32).toString("hex"), "", key.slice(0, 63), `${key} `]) {
    assert.equal(refused({ url: `/open?key=${encodeURIComponent(given)}`, cookie: "" }), 401, given);
  }
  assert.equal(refused({ url: "/open", cookie: "" }), 401);
  assert.equal(refused({ url: "/open?key=", cookie: `mercbot_key=${key}` }), 401, "the cookie doesn't stand in for the key here");
});

test("a change or a websocket comes from Mercbot's own page, and with the key", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(refused({ method, url: "/api/vault", origin: `http://${OWN}` }), null, method);
    assert.equal(refused({ method, url: "/api/vault" }), 403, `${method} without an Origin`);
    assert.equal(refused({ method, url: "/api/vault", origin: "http://evil.example" }), 403, method);
    assert.equal(refused({ method, url: "/api/vault", origin: "http://localhost:3001" }), 403, `${method} from the other loopback name`);
    assert.equal(refused({ method, url: "/api/vault", origin: "null" }), 403, `${method} from a file`);
  }
  const socket = "/socket.io/?EIO=4&transport=websocket";
  assert.equal(refused({ url: socket, origin: `http://${OWN}` }, true), null);
  assert.equal(refused({ url: socket, origin: `http://${OWN}`, cookie: "" }, true), 401, "a websocket without the cookie");
  assert.equal(refused({ url: socket, origin: "http://evil.example" }, true), 403, "a websocket from another page");
  assert.equal(refused({ url: socket }, true), 403);
  assert.equal(refused({ url: "/api/computer-vnc?bot=1", origin: `http://${OWN}`, cookie: `mercbot_key=${key.toUpperCase()}` }, true), 401);
});

test("routes that prove themselves pass without the key; nothing else that looks like them does", () => {
  for (const [method, url, upgrade] of [
    ["GET", "/api/health", false],
    ["POST", "/api/internal/computer", false],
    ["GET", `/api/computer-cdp/${key}/devtools/browser/x`, true],
    ["POST", "/api/files/drive-token", false],
    ["GET", "/api/pages/frame-token/plan.html", false],
    ["GET", "/api/connections/callback?code=c&state=s", false]
  ]) {
    assert.equal(refused({ method, url, cookie: "" }, upgrade), null, url);
  }
  for (const url of ["/api/healthz", "/api/internal/computers", "/api/files/drive-tokens", "/api/pages", "/api/public/pages/link-token/plan.html", "/api/connections/callbacks", "/api/public/sign-in/callback"]) {
    assert.equal(refused({ url, cookie: "" }), 401, url);
  }
  // A request from outside, such as another service's webhook, carries no Origin and no key: it's refused, and only
  // Mercbot's own page with the key passes (D-81).
  const hook = "/api/hooks/anything";
  assert.equal(refused({ method: "POST", url: hook, cookie: "" }), 403, "a request from outside");
  assert.equal(refused({ method: "POST", url: hook, cookie: "", origin: `http://${OWN}` }), 401, "from Mercbot's page, without the key");
  assert.equal(refused({ method: "POST", url: hook, origin: `http://${OWN}` }), null, "from Mercbot's page, with the key");
});

test("there's no sign-in, registration, sign-out, password, members or invitations to reach", () => {
  const own = `http://${OWN}`;
  for (const [method, url] of [
    ["POST", "/api/login"], ["POST", "/api/login/otp/request"], ["POST", "/api/register"], ["POST", "/api/register/confirm"],
    ["POST", "/api/logout"], ["POST", "/api/password/forgot"], ["POST", "/api/password/reset"], ["GET", "/api/oauth/google/start"],
    ["POST", "/api/oauth/complete"], ["POST", "/api/dev-auth/login-as"], ["POST", "/api/settings/security/change-password"],
    ["POST", "/api/settings/security/logout-others"], ["GET", "/api/workspace/invitations/pending"],
    ["POST", "/api/workspace/invitations/redeem"], ["GET", "/api/w/home/invites"], ["POST", "/api/w/home/invites"],
    ["DELETE", "/api/w/home/invites/4"], ["PATCH", "/api/w/home/members/5/role"], ["DELETE", "/api/w/home/members/5"],
    // The invitations read a page at a time, as homesApi.js reads them.
    ["GET", "/api/w/home/invites?limit=100"], ["GET", "/api/w/home/invites?limit=100&cursor=c2"]
  ]) {
    assert.equal(refused({ method, url, origin: own }), 404, `${method} ${url}`);
  }
  // Without the key they get only the page that says to open Mercbot.
  assert.equal(refused({ method: "POST", url: "/api/login", origin: own, cookie: "" }), 401);
  // Who's in the home (just the person) and the session still answer, and the people read a page at a time too, as a
  // group's Add a person reads them (homesApi.js).
  for (const url of ["/api/w/home/members", "/api/w/home/members?limit=100", "/api/w/home/members?limit=100&cursor=c2", "/api/w/home/roles", "/api/session", "/api/settings"]) {
    assert.equal(refused({ url }), null, url);
  }
});

test("the key is 32 random bytes in a file only the person can read, compared exactly", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mercbot-key-"));
  try {
    const env = { MERCBOT_DATA_DIR: path.join(dir, "data") };
    const made = loadKey(env);
    assert.match(made, /^[0-9a-f]{64}$/u);
    assert.equal(statSync(keyFile(env)).mode & 0o777, 0o600);
    assert.equal(loadKey(env), made, "made once, then kept");
    assert.ok(keyMatches(made, made));
    assert.ok(!keyMatches(made, made.toUpperCase()));
    assert.ok(!keyMatches(made, undefined));
    chmodSync(keyFile(env), 0o640);
    assert.throws(() => loadKey(env), /can be read by other people on this computer\. Make it yours alone with: chmod 600 /u);
    chmodSync(keyFile(env), 0o600);
    writeFileSync(keyFile(env), "not a key\n");
    assert.throws(() => loadKey(env), /holds no Mercbot key\. Make a new one with: mercbot new-key/u);
    assert.equal(readFileSync(keyFile(env), "utf8"), "not a key\n", "a key file is never replaced behind the person's back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a single-user copy starts only on loopback", () => {
  for (const HOST of ["127.0.0.1", "::1"]) assert.doesNotThrow(() => checkSingleUserHost({ HOST }));
  for (const HOST of ["0.0.0.0", "::", "192.168.1.5", "localhost", "", undefined]) {
    assert.throws(() => checkSingleUserHost({ HOST }), /listens on this computer only: set HOST to 127\.0\.0\.1 or ::1/u, String(HOST));
  }
  assert.equal(cookieOf({ headers: { cookie: "a=1;  mercbot_key = v ; b" } }, "mercbot_key"), "v");
});
