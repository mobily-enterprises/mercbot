import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeManagedPreviewIdentityRequest } from "@jskit-ai/auth-web/server/managedPreviewIdentity";
import { SINGLE_USER_EMAIL } from "../../packages/account/src/server/thisCopy.js";
import { loadKey } from "../../packages/single-user/src/server/key.js";
import { openWithKey } from "../../packages/single-user/src/server/previewIdentity.js";

// Vibe64's Preview opens a person's own copy (D-81) with its key, as `mercbot open` does (tools/preview-identity), and
// closes it again; singleUser.integration.js does the same against a real copy.
const PROTOCOL = "vibe64.preview-identity.command.v1";
const ORIGIN = "http://127.0.0.1:3001";
const ask = (operation, email) => ({
  operation,
  protocol: PROTOCOL,
  requestId: `request-${operation}`,
  ...(email ? { subject: { kind: "selector", selector: { type: "email", value: email } } } : {}),
  target: { origin: ORIGIN }
});

test("the Preview opens the copy with its key as its one person, and closes it by taking the key's cookie away", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mercbot-preview-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { MERCBOT_DATA_DIR: dir };
  const key = loadKey(env);
  const opened = ["mercbot_key=k; Max-Age=34560000; Path=/; HttpOnly; SameSite=Strict", "session=s; Path=/; HttpOnly"];
  const asked = [];
  let status = 200;
  const fetchImpl = async (url, init) => {
    asked.push([url, init]);
    const headers = new Headers();
    for (const cookie of opened) headers.append("set-cookie", cookie);
    return new Response("Open Mercbot", { status, headers });
  };
  const run = (request) => executeManagedPreviewIdentityRequest(request, { protocol: PROTOCOL, fetchImpl, exchange: openWithKey(env) });

  const signedIn = await run(ask("login-as", "You@Mercbot.localhost"));
  assert.deepEqual([signedIn.ok, signedIn.signedOut, signedIn.identity?.email, signedIn.setCookie], [true, false, SINGLE_USER_EMAIL, opened]);
  assert.deepEqual(asked, [[`${ORIGIN}/open?key=${key}`, { redirect: "manual" }]]);

  const signedOut = await run(ask("logout"));
  assert.deepEqual([signedOut.ok, signedOut.signedOut, signedOut.identity], [true, true, null]);
  assert.deepEqual(signedOut.setCookie, ["mercbot_key=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"]);

  // Anyone else is refused before the copy is asked.
  const someone = await run(ask("login-as", "someone@example.com"));
  assert.deepEqual([someone.ok, someone.code, someone.statusCode, someone.setCookie], [false, "mercbot_one_person", 404, []]);
  assert.equal(asked.length, 1);

  // A copy that doesn't take the key (another copy's data folder, or a key just replaced) is reported, with nothing for
  // the browser.
  status = 401;
  const turnedBack = await run(ask("login-as", SINGLE_USER_EMAIL));
  assert.deepEqual([turnedBack.ok, turnedBack.code, turnedBack.statusCode, turnedBack.setCookie], [false, "mercbot_not_opened", 502, []]);
});
