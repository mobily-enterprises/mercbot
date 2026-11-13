import assert from "node:assert/strict";
import test from "node:test";
import { createSignInChain, SIGN_IN_CHAIN_MS } from "../../packages/computer/src/server/signInChain.js";

// A computer's sign-in chain (D-77) against tabs that report navigations as Chrome's CDP does
// (frameRequestedNavigation when the page asked, then frameStartedNavigating with its kind, then
// frameNavigated). tests/e2e/sign-in-chain.spec.ts proves the same in a real Chromium.

/** A browser's tabs as the chain sees them, counting every command the chain sends. */
function fakeBrowser() {
  const commands = [];
  function tab({ opener = null, loaded = "about:blank" } = {}) {
    const listeners = new Map();
    const target = { opener: () => opener?.target ?? null };
    const session = {
      on: (name, listener) => listeners.set(name, listener),
      send: async (method) => {
        commands.push(method);
        return method === "Page.getFrameTree" ? { frameTree: { frame: { id: "main", url: loaded } } } : {};
      }
    };
    const page = {
      target: () => target,
      createCDPSession: async () => {
        commands.push("Target.attachToTarget");
        return session;
      }
    };
    const emit = (name, event) => listeners.get(name)?.(event);
    return {
      page,
      target,
      /** A navigation of the tab: one the page asked for (a click, a form, a script) or not, and of which kind. */
      go(url, { asked = false, kind = "differentDocument" } = {}) {
        if (asked) emit("Page.frameRequestedNavigation", { frameId: "main", url, reason: "anchorClick", disposition: "currentTab" });
        emit("Page.frameStartedNavigating", { frameId: "main", url, loaderId: "L", navigationType: kind });
        emit("Page.frameNavigated", { frame: { id: "main", url }, type: "Navigation" });
      },
      /** A navigation the page asks for that never starts (a download, one it cancels). */
      ask: (url) => emit("Page.frameRequestedNavigation", { frameId: "main", url, reason: "scriptInitiated", disposition: "currentTab" }),
      /** A frame inside the page navigating. */
      frame: (url) => emit("Page.frameStartedNavigating", { frameId: "child", url, loaderId: "F", navigationType: "differentDocument" })
    };
  }
  return { tab, commands };
}

test("a sign-in's chain holds the pages its tab reaches by itself, and not one typed in or gone back to", async () => {
  const browser = fakeBrowser();
  const chain = createSignInChain();
  const bot = browser.tab();
  await chain.follow(bot.page);
  bot.go("https://forms.example.com/collect");
  assert.equal(chain.holds(bot.page), false, "nothing before a sign-in starts");

  bot.go("https://example.com/sign-in");
  chain.start(bot.page, "https://example.com/sign-in");
  assert.equal(chain.holds(bot.page), true);
  assert.equal(chain.startedFrom(), "https://example.com/sign-in");
  bot.go("https://login.example.com/password", { asked: true });
  bot.go("https://login.example.com/posted", { asked: true });
  bot.go("https://login.example.com/password#code", { kind: "sameDocument" });
  bot.go("https://login.example.com/password", { kind: "reload" });
  bot.frame("https://ads.example.net/frame");
  assert.equal(chain.holds(bot.page), true, "clicks, forms, scripts, the same page and its frames keep it");

  bot.go("https://forms.example.com/collect", { kind: "historyDifferentDocument" });
  assert.equal(chain.holds(bot.page), false, "a move back in its history leaves it");
  bot.go("https://forms.example.com/next", { asked: true });
  assert.equal(chain.holds(bot.page), false, "and what that page leads to isn't in it either");

  chain.start(bot.page, "https://example.com/sign-in");
  bot.go("https://forms.example.com/collect");
  assert.equal(chain.holds(bot.page), false, "an address typed in leaves it");

  chain.start(bot.page, "https://example.com/sign-in");
  bot.go("https://login.example.com/one", { asked: true });
  // A navigation the page asked for and that never started (a download, a cancel), then one it didn't ask for.
  bot.ask("https://login.example.com/download");
  bot.go("https://forms.example.com/collect");
  assert.equal(chain.holds(bot.page), false, "an ask only counts for the navigation it asked for");
});

test("popups a page of the chain opens are in it; others aren't; and the chain ends", async () => {
  const browser = fakeBrowser();
  let now = 1_000_000;
  const chain = createSignInChain({ clock: () => now });
  const bot = browser.tab();
  await chain.follow(bot.page);
  const before = browser.tab({ opener: bot, loaded: "https://id.example.com/" });
  await chain.follow(before.page);
  assert.equal(chain.holds(before.page), false, "a popup from before the sign-in");

  chain.start(bot.page, "https://example.com/sign-in");
  const popup = browser.tab({ opener: bot });
  await chain.follow(popup.page);
  popup.go("https://id.example.com/start");
  assert.equal(chain.holds(popup.page), true, "its opening navigation is the opener's");
  popup.go("https://id.example.com/code", { asked: true });
  assert.equal(chain.holds(popup.page), true);
  const nested = browser.tab({ opener: popup, loaded: "https://id.example.com/more" });
  await chain.follow(nested.page);
  assert.equal(chain.holds(nested.page), true, "a popup's popup");
  nested.go("https://forms.example.com/collect");
  assert.equal(chain.holds(nested.page), false, "once loaded, an address typed in leaves it");
  const loose = browser.tab();
  await chain.follow(loose.page);
  assert.equal(chain.holds(loose.page), false, "a window nothing in the chain opened");
  const fromOutside = browser.tab({ opener: nested });
  await chain.follow(fromOutside.page);
  assert.equal(chain.holds(fromOutside.page), false, "a popup a page outside the chain opened");

  chain.end();
  assert.equal([bot, popup].some((tab) => chain.holds(tab.page)), false, "ended: no page is in it");
  assert.equal(chain.startedFrom(), "");

  chain.start(bot.page, "https://example.com/sign-in");
  assert.equal(chain.holds(popup.page), false, "a new sign-in starts its own chain");
  now += SIGN_IN_CHAIN_MS - 1;
  assert.equal(chain.holds(bot.page), true);
  now += 1;
  assert.equal(chain.holds(bot.page), false, "10 minutes after it started");
  now -= 1;
  assert.equal(chain.holds(bot.page), false, "and it stays ended");
});

test("the chain's bookkeeping costs the same for every navigation: no command to the browser", async () => {
  const browser = fakeBrowser();
  const chain = createSignInChain();
  const bot = browser.tab();
  await chain.follow(bot.page);
  assert.deepEqual(browser.commands, ["Target.attachToTarget", "Page.enable", "Page.getFrameTree"], "three commands once per tab");
  chain.start(bot.page, "https://example.com/sign-in");
  for (const count of [10, 10_000]) {
    browser.commands.length = 0;
    for (let step = 0; step < count; step += 1) bot.go(`https://login.example.com/step-${step}`, { asked: true });
    assert.equal(browser.commands.length, 0, `${count} navigations`);
    assert.equal(chain.holds(bot.page), true);
  }
});
