import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDERS, createOAuth } from "../../packages/integrations/src/server/oauth.js";
import { SIGN_IN_PAGE_SCRIPT, signInPage } from "../../packages/integrations/src/server/signInPage.js";

// Signing an account in (D-110): each provider shows its account chooser, with the account's own address suggested when
// it has one, so the person picks the mailbox rather than the browser's session deciding; and the page a sign-in ends on
// closes its own window once a Mercbot tab has the result, or goes back to Mercbot when the sign-in took Mercbot's tab.
const ENV = {
  APP_PUBLIC_URL: "https://mercbot.example",
  GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "g",
  MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "m",
  GITHUB_CLIENT_ID: "h", GITHUB_CLIENT_SECRET: "h"
};

test("every provider shows its account chooser, suggesting the account's address when it has one", async () => {
  const oauth = createOAuth({ env: ENV });
  const consent = async (id, loginHint) => Object.fromEntries(new URL(await oauth.authorizeUrl(PROVIDERS[id], [], "state", "verifier", { loginHint })).searchParams);
  const google = await consent("google", "pat@example.com");
  assert.deepEqual([google.prompt, google.login_hint, google.access_type], ["select_account consent", "pat@example.com", "offline"]);
  const microsoft = await consent("microsoft", "pat@example.com");
  assert.deepEqual([microsoft.prompt, microsoft.login_hint], ["select_account", "pat@example.com"]);
  const github = await consent("github", "pat");
  assert.deepEqual([github.prompt, github.login], ["select_account", "pat"]);
  for (const id of ["google", "microsoft", "github"]) {
    const none = await consent(id, "");
    assert.equal(none.prompt.includes("select_account"), true, id);
    assert.equal("login_hint" in none || "login" in none, false, `${id}: no address, no suggestion`);
  }
});

/**
 * Runs the sign-in page's script on `page`, in a stand-in browser: `storage` is what this tab's session storage holds,
 * `answered` whether a Mercbot tab answers, `closable` whether the browser lets the page close its window. Answers what
 * the page did and shows: `main` the main control ("Close", "Try again" or the words to close the tab).
 */
function runPage(page, { storage = {}, answered = true, closable = true, click = false } = {}) {
  const result = { posted: [], closed: false, replaced: "", storage: { ...storage } };
  const element = (fields) => ({ hidden: false, href: "/", listeners: {}, addEventListener(kind, run) { this.listeners[kind] = run; }, ...fields });
  const parts = {
    "[data-close]": element(),
    "[data-again]": element({ hidden: true }),
    "[data-close-yourself]": element({ hidden: true }),
    "[data-back]": element()
  };
  assert.match(page, /<button type="button" class="main" data-close>Close<\/button><a class="main" data-again href="\/" hidden>Try again<\/a>/u);
  assert.match(page, /<span class="closing" data-close-yourself hidden>You can close this tab now.<\/span><\/p><p class="back"><a data-back href="\/">Back to Mercbot<\/a><\/p>/u);
  class StandInChannel {
    constructor(name) {
      assert.equal(name, "mercbot-sign-in");
    }

    postMessage(message) {
      result.posted.push(message);
      if (answered && message.kind === "finished") this.onmessage?.({ data: { kind: "here" } });
    }
  }
  const document = {
    querySelector: (selector) => (selector === "main" ? { dataset: { result: /data-result="(\w+)"/u.exec(page)[1] } } : parts[selector] || null)
  };
  const sessionStorage = {
    getItem: (key) => result.storage[key] ?? null,
    removeItem: (key) => {
      delete result.storage[key];
    }
  };
  const later = [];
  const location = { replace: (to) => { result.replaced = to; } };
  const window = { close: () => { if (closable) result.closed = true; } };
  new Function("document", "sessionStorage", "location", "window", "BroadcastChannel", "navigator", "setTimeout", SIGN_IN_PAGE_SCRIPT)(
    document, sessionStorage, location, window, StandInChannel, {}, (run) => later.push(run)
  );
  if (click) {
    parts["[data-close]"].listeners.click();
    // A window that closed runs nothing more; one that didn't goes on to say so.
    if (!result.closed) later.forEach((run) => run());
  }
  const shown = ["[data-close]", "[data-again]", "[data-close-yourself]"].filter((selector) => !parts[selector].hidden);
  const words = { "[data-close]": "Close", "[data-again]": "Try again", "[data-close-yourself]": "You can close this tab now." };
  return { ...result, main: shown.map((selector) => words[selector]), again: parts["[data-again]"].href, back: parts["[data-back]"].href };
}

test("a sign-in in its own window tells Mercbot's tabs and closes once one answers; Close closes it, or says to", () => {
  const connected = signInPage("Connected to Google", "Signed in as pat@example.com. It's all set.", { connected: true });
  assert.deepEqual(runPage(connected), {
    posted: [{ kind: "finished", ok: true }], closed: true, replaced: "", storage: {}, main: ["Close"], again: "/", back: "/"
  });
  // No Mercbot tab open: it stays, with Close, which closes it.
  const alone = runPage(connected, { answered: false });
  assert.deepEqual([alone.closed, alone.main, alone.back], [false, ["Close"], "/"]);
  assert.equal(runPage(connected, { answered: false, click: true }).closed, true);
  // A browser that won't let the page close its window: Close never does nothing, it says to close the tab.
  const kept = runPage(connected, { answered: false, closable: false, click: true });
  assert.deepEqual([kept.closed, kept.main, kept.back], [false, ["You can close this tab now."], "/"]);
});

test("a sign-in that didn't connect offers Try again, from where it began, and tells the tabs without closing", () => {
  const failed = signInPage("Couldn't connect", "This Gmail account is pat@example.com, but you signed in as sam@example.com, so nothing changed.");
  const start = "/account/connect?plugin=gmail&home=you&account=4";
  const page = runPage(failed, { storage: { "mercbot-sign-in-again": start } });
  assert.deepEqual(page, {
    posted: [{ kind: "finished", ok: false }], closed: false, replaced: "", storage: {}, main: ["Try again"], again: start, back: "/"
  });
  // Without where it began (another site's sign-in, or no session storage): Close.
  assert.deepEqual(runPage(failed).main, ["Close"]);
});

test("a sign-in that took Mercbot's own tab goes back once connected; one that didn't offers Try again and the way back", () => {
  const back = "/w/you?connect=gmail";
  const start = "/account/connect?plugin=gmail&home=you&account=4";
  const storage = { "mercbot-sign-in-back": back, "mercbot-sign-in-again": start };
  const connected = signInPage("Connected to Google", "It's all set.", { connected: true });
  const home = runPage(connected, { storage });
  assert.deepEqual([home.replaced, home.closed, home.posted, home.storage], [back, false, [], {}], "straight back, each way used once");
  const failed = runPage(signInPage("Couldn't connect", "The Google sign-in was cancelled."), { storage });
  assert.deepEqual([failed.replaced, failed.main, failed.again, failed.back, failed.posted], ["", ["Try again"], start, back, []]);
  // Only a path on this site is followed.
  for (const elsewhere of ["//evil.example/", "https://evil.example/"]) {
    const page = runPage(connected, { storage: { "mercbot-sign-in-back": elsewhere, "mercbot-sign-in-again": elsewhere } });
    assert.deepEqual([page.replaced, page.back, page.closed], ["", "/", true], elsewhere);
    assert.equal(runPage(signInPage("Couldn't connect", "No."), { storage: { "mercbot-sign-in-again": elsewhere } }).main[0], "Close", elsewhere);
  }
});
