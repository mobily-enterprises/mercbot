import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import knexLib from "knex";
import { AI_KINDS } from "../../packages/account/src/server/providers/index.js";
import { createServer } from "../../server.js";
import { resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";
import { testDatabaseConfig } from "../support/testDatabase.mjs";

// A person's own copy (D-81), started as Mercbot starts (bin/server.js) on this computer's
// loopback: it makes its key and its one person, opens with the key, and refuses every request, websocket included,
// that breaks a rule. JSKIT's inject() skips the server the gate is on, so every request here is a real one.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const EMAIL = "you@mercbot.localhost";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A port nothing listens on, for the next copy. */
const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer().once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

/**
 * The copy, started by bin/server.js on a free loopback port, with `env`; answers its port and a stop that drains it
 * (SIGTERM) and waits for it to exit.
 */
async function startCopy(env) {
  const port = await freePort();
  // Started as Mercbot starts, not as one of this run's test files.
  const own = { ...env, PORT: String(port), APP_PUBLIC_URL: `http://127.0.0.1:${port}` };
  delete own.NODE_TEST_CONTEXT;
  const copy = spawn(process.execPath, ["bin/server.js"], {
    cwd: ROOT,
    env: own,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exited = new Promise((resolve) => copy.once("exit", resolve));
  let output = "";
  await new Promise((resolve, reject) => {
    for (const stream of [copy.stdout, copy.stderr]) {
      stream.on("data", (chunk) => {
        output = `${output}${chunk}`.slice(-20000);
        if (output.includes("Server listening at")) resolve();
      });
    }
    exited.then((code) => reject(new Error(`The copy stopped (${code}) before it listened:\n${output.slice(-3000)}`)));
  });
  return {
    port,
    async stop() {
      if (copy.exitCode === null) copy.kill("SIGTERM");
      assert.equal(await exited, 0, "the copy drains and exits");
    }
  };
}

/** One request: its status, headers and body. An upgrade answered with anything but 101 comes back as a response. */
function send(port, { method = "GET", url = "/", headers = {}, upgrade = false, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: url, headers: { host: `127.0.0.1:${port}`, ...headers } });
    request.once("error", reject);
    request.once("upgrade", (response, socket) => {
      socket.destroy();
      resolve({ status: response.statusCode, headers: response.headers, body: "" });
    });
    request.once("response", (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    if (upgrade) request.setHeader("connection", "Upgrade").setHeader("upgrade", "websocket");
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const cookiesOf = (response) => Object.fromEntries((response.headers["set-cookie"] || []).map((line) => line.split(";")[0].split("=")));
const cookieHeader = (cookies) => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
const websocket = (port, url, headers) => send(port, {
  url,
  upgrade: true,
  headers: { origin: `http://127.0.0.1:${port}`, "sec-websocket-key": randomBytes(16).toString("base64"), "sec-websocket-version": "13", ...headers }
});

test("a person's own copy opens with its key, and refuses whatever breaks a rule", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-single-user-"));
  const knex = knexLib(await testDatabaseConfig());
  context.after(async () => {
    await knex.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });
  const env = {
    ...resolveRuntimeEnv(),
    MERCBOT_DATA_DIR: dataDir,
    HOST: "127.0.0.1"
  };
  // Mercbot doesn't start without its kinds of AI (D-72); nothing here reaches them.
  for (const kind of Object.values(AI_KINDS)) Object.assign(env, { [kind.providerSetting]: Object.keys(kind.types)[0], [kind.keySetting]: "no-ai-in-this-test" });

  // Anywhere but loopback, it doesn't start, before anything of it runs.
  for (const HOST of ["0.0.0.0", "::", "192.168.1.5"]) {
    await assert.rejects(createServer({ runtimeEnv: { ...env, HOST } }), /listens on this computer only: set HOST to 127\.0\.0\.1 or ::1/u, HOST);
  }

  let copy = await startCopy(env);
  context.after(() => copy.stop());
  let { port } = copy;

  // Its first start made the key, for the person alone, and the one person.
  const keyFile = path.join(dataDir, "mercbot.key");
  const key = (await readFile(keyFile, "utf8")).trim();
  assert.match(key, /^[0-9a-f]{64}$/u);
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  const person = await knex("auth_local_users").where({ email: EMAIL }).first();
  assert.ok(person, "the person is made on the first start");
  // The first start recorded no use of anything.
  for (const table of ["usage_events", "usage_daily", "usage_monthly"]) {
    assert.equal(Number((await knex(table).count({ n: "*" }).first()).n), 0, table);
  }
  // Once it listens, its features start their work (Fastify's onListen): it registers for bot computers at its address.
  const registered = () => knex("mercbot_servers").where({ url: `http://127.0.0.1:${port}` }).first();
  for (const deadline = Date.now() + 10_000; !(await registered()) && Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(await registered(), "the server registers for bot computers once it listens");

  // No cookie, a wrong key, the key in other letters: the plain page.
  for (const headers of [{}, { cookie: `mercbot_key=${randomBytes(32).toString("hex")}` }, { cookie: `mercbot_key=${key.toUpperCase()}` }]) {
    const refused = await send(port, { url: "/api/session", headers });
    assert.equal(refused.status, 401, JSON.stringify(headers));
    assert.match(refused.body, /Open Mercbot with <code>mercbot open<\/code>\./u);
    assert.equal(refused.headers["cache-control"], "no-store");
  }
  for (const given of [key.toUpperCase(), randomBytes(32).toString("hex")]) {
    const refused = await send(port, { url: `/open?key=${given}` });
    assert.equal(refused.status, 401);
    assert.equal(refused.headers["set-cookie"], undefined, "a wrong key gets no cookie");
  }
  // Another Host for this computer (DNS rebinding), with the key.
  assert.equal((await send(port, { url: `/open?key=${key}`, headers: { host: `evil.example:${port}` } })).status, 421);
  assert.equal((await send(port, { url: "/api/health", headers: { host: `evil.example:${port}` } })).status, 421);
  // The health check says only that it's up.
  assert.deepEqual(JSON.parse((await send(port, { url: "/api/health" })).body), { ok: true, app: "account-app" });
  // A page's sealed frame sends no cookie; its signed address answers for itself (here: no such page).
  const frame = await send(port, { url: "/api/pages/no-such-token/plan.html" });
  assert.equal(frame.status, 404);
  assert.doesNotMatch(frame.body, /mercbot open/u);

  // `mercbot open`: the key's cookie, HttpOnly and SameSite=Strict, a session, and a page that leaves the key's address.
  const opened = await send(port, { url: `/open?key=${key}` });
  assert.equal(opened.status, 200);
  assert.match(opened.body, /<meta http-equiv="refresh" content="0;url=\/">/u);
  const keyCookie = opened.headers["set-cookie"].find((line) => line.startsWith("mercbot_key="));
  assert.match(keyCookie, /HttpOnly/u);
  assert.match(keyCookie, /SameSite=Strict/u);
  assert.match(keyCookie, /Path=\//u);
  let cookies = cookiesOf(opened);
  assert.equal(cookies.mercbot_key, key);
  assert.ok(Object.keys(cookies).length > 1, "JSKIT's session cookies come with it");
  const session = await send(port, { url: "/api/session", headers: { cookie: cookieHeader(cookies) } });
  assert.equal(session.status, 200);
  const signedIn = JSON.parse(session.body);
  assert.equal(signedIn.authenticated, true);
  assert.equal(signedIn.email, EMAIL);
  Object.assign(cookies, cookiesOf(session));
  // Its files are kept in the data folder, so a new release finds them (change 4).
  const user = await knex("users").where({ email: EMAIL }).first();
  const [home] = await knex("workspaces")
    .insert({ slug: `own-copy-${randomBytes(6).toString("hex")}`, name: "Own copy", owner_user_id: user.id, is_personal: false })
    .returning(["id", "slug"]);
  await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: user.id, role_sid: "owner", status: "active" });
  const files = await send(port, { url: `/api/w/${home.slug}/files?folder=%2Ffiles%2Fshared`, headers: { cookie: cookieHeader(cookies) } });
  assert.equal(files.status, 200, files.body);
  assert.ok((await stat(path.join(dataDir, "files"))).isDirectory(), "the files are in <MERCBOT_DATA_DIR>/files");

  // Its home's work is never paused (D-73, D-81): Spending shows this month's cost with nothing to act on.
  const usage = await send(port, { url: `/api/w/${home.slug}/usage`, headers: { cookie: cookieHeader(cookies) } });
  assert.equal(usage.status, 200, usage.body);
  const summary = JSON.parse(usage.body);
  assert.deepEqual([summary.scope, summary.monthNano, summary.note, summary.attention, summary.action], ["home", 0, null, false, null]);

  // A change: from Mercbot's own page it goes through (JSKIT's CSRF token too); from anywhere else it's refused.
  const change = (headers) => send(port, {
    method: "POST",
    url: "/api/bridge/link/check",
    body: {},
    headers: { cookie: cookieHeader(cookies), "content-type": "application/json", "csrf-token": signedIn.csrfToken, ...headers }
  });
  for (const origin of [undefined, "http://evil.example", `http://localhost:${port}`, "null"]) {
    assert.equal((await change(origin ? { origin } : {})).status, 403, String(origin));
  }
  const sent = await change({ origin: `http://127.0.0.1:${port}` });
  assert.equal(sent.status, 200, sent.body);
  assert.equal((await change({ origin: `http://127.0.0.1:${port}`, "csrf-token": "wrong" })).status, 403, "JSKIT's CSRF check stays");

  // Sign-in, registration, sign-out, invitations: none of them here.
  for (const [method, url] of [["POST", "/api/login"], ["POST", "/api/register"], ["POST", "/api/logout"], ["POST", "/api/password/forgot"]]) {
    const absent = await send(port, { method, url, headers: { cookie: cookieHeader(cookies), origin: `http://127.0.0.1:${port}` } });
    assert.equal(absent.status, 404, url);
    assert.match(absent.body, /no sign-in, accounts, members or invitations/u);
  }

  // A websocket (Socket.IO's, a bot's live screen) without the key's cookie or from another page is refused before
  // anything listening for it sees it; with both, the live screen's own check answers (no such screen).
  for (const url of ["/socket.io/?EIO=4&transport=websocket", "/api/computer-vnc?ticket=none"]) {
    for (const headers of [{}, { cookie: `mercbot_key=${key.toUpperCase()}` }]) {
      const refused = await websocket(port, url, headers);
      assert.equal(refused.status, 401, url);
      assert.match(refused.body, /Open Mercbot with/u);
    }
    assert.equal((await websocket(port, url, { cookie: `mercbot_key=${key}`, origin: "http://evil.example" })).status, 403, url);
  }
  const screen = await websocket(port, "/api/computer-vnc?ticket=none", { cookie: `mercbot_key=${key}` });
  assert.deepEqual([screen.status, screen.body, screen.headers["content-type"]], [403, "", undefined], "the live screen's own refusal");

  // A session that ran out: the key's cookie alone signs the person in again, for this very request.
  const again = await send(port, { url: "/api/session", headers: { cookie: `mercbot_key=${key}` } });
  assert.equal(JSON.parse(again.body).authenticated, true);
  assert.ok(Object.keys(cookiesOf(again)).some((name) => name !== "mercbot_key"), "with new session cookies");

  // Vibe64's Preview opens the copy with its key too (tools/preview-identity, given the copy's data folder), as its one
  // person, and closes it again.
  const preview = async (operation, email) => {
    const command = spawn(process.execPath, ["tools/preview-identity", dataDir], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
    command.stdin.end(JSON.stringify({
      protocol: "vibe64.preview-identity.command.v1",
      requestId: `single-user-${operation}`,
      operation,
      ...(email ? { subject: { kind: "selector", selector: { type: "email", value: email } } } : {}),
      target: { origin: `http://127.0.0.1:${port}` }
    }));
    let text = "";
    for await (const chunk of command.stdout) text += chunk;
    return JSON.parse(text);
  };
  const previewed = await preview("login-as", EMAIL);
  assert.deepEqual([previewed.ok, previewed.signedOut, previewed.identity?.email], [true, false, EMAIL], JSON.stringify(previewed));
  const previewCookies = Object.fromEntries(previewed.setCookie.map((line) => line.split(";")[0].split("=")));
  assert.equal(previewCookies.mercbot_key, key);
  assert.equal(JSON.parse((await send(port, { url: "/api/session", headers: { cookie: cookieHeader(previewCookies) } })).body).authenticated, true);
  assert.equal((await preview("login-as", "someone@example.com")).code, "mercbot_one_person");
  const closed = await preview("logout");
  assert.deepEqual([closed.ok, closed.signedOut, closed.setCookie], [true, true, ["mercbot_key=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"]]);

  // `mercbot new-key`: a new key, and a restart. The old key opens nothing, and its sessions are over.
  await copy.stop();
  const newKey = randomBytes(32).toString("hex");
  await writeFile(keyFile, `${newKey}\n`, { mode: 0o600 });
  copy = await startCopy(env);
  ({ port } = copy);
  assert.equal((await send(port, { url: "/api/session", headers: { cookie: cookieHeader(cookies) } })).status, 401);
  assert.equal((await send(port, { url: `/open?key=${key}` })).status, 401);
  const live = await knex("auth_local_sessions").where({ user_id: person.id }).whereNull("revoked_at");
  assert.deepEqual(live, [], "every session signed in with the old key ended");
  const reopened = await send(port, { url: `/open?key=${newKey}`, headers: { cookie: cookieHeader(cookies) } });
  assert.equal(reopened.status, 200);
  cookies = { ...cookies, ...cookiesOf(reopened) };
  assert.equal(JSON.parse((await send(port, { url: "/api/session", headers: { cookie: cookieHeader(cookies) } })).body).authenticated, true);
  assert.equal(await knex("auth_local_users").where({ email: EMAIL }).count({ n: "*" }).first().then((row) => Number(row.n)), 1, "still one person");

  // Off (as a copy built on Mercbot that serves many people starts it): the same settings on any address make a server, with no gate.
  const ungated = await createServer({ runtimeEnv: { ...env, HOST: "0.0.0.0" }, gate: false });
  await ungated.close();
});
