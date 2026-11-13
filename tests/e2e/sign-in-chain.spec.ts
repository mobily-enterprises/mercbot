import { createServer, type Server } from "node:http";
import { chromium, expect, test } from "@playwright/test";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { WebSocket, WebSocketServer } from "ws";
import { buildSignInCodeTools, SIGN_IN_CODE_ACTIONS } from "../../packages/bots/src/server/signInCodes.js";
import { createComputerManager } from "../../packages/computer/src/server/computerManager.js";
import { SIGN_IN_CHAIN_MS } from "../../packages/computer/src/server/signInChain.js";

// A sign-in's chain (D-77) on a bot's computer, in a real Chromium: the computer manager runs as on a server, through
// its startBrowser, libraries and clock seams, with a plain Chromium in place of the gVisor desktop and a stand-in for
// Stagehand's AI that clicks the element it's told to. The sites are stand-in pages on this test's own server (Chromium
// sends *.example.com and *.example.net there) and the person's inbox is a stand-in for Gmail's API, holding one code
// from no-reply@example.com. No Test Preview is needed, so this uses Playwright's test directly rather than harness.ts.

const CODE = "604217";
const COMPUTER = "11";
const now = Date.now();

/** The stand-in sites, by host and path. */
function page(title: string, body: string) {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
}
const codeField = '<label>Code <input id="code" autocomplete="one-time-code"></label>';

function sites(request: { method?: string; url?: string; headers: { host?: string } }) {
  const host = String(request.headers.host || "");
  const { pathname, searchParams } = new URL(request.url || "/", `http://${host}`);
  const left = Number(searchParams.get("left"));
  const route = `${request.method} ${host}${pathname}`;
  switch (route) {
    // The sign-in the person asked for: the site's front page redirects to its sign-in page, whose "Sign in with
    // ExampleID" opens a popup on another site; that redirects again and posts a form that leads back to example.com's
    // code page.
    case "GET www.example.com/":
      return { redirect: "http://login.example.com/start" };
    case "GET login.example.com/start":
      return {
        html: page(
          "Sign in to Example",
          `<button id="with-id" onclick="window.open('http://id.example.net/authorize', 'exampleid', 'width=500,height=600')">Sign in with ExampleID</button>`
        )
      };
    case "GET id.example.net/authorize":
      return { redirect: "http://id.example.net/consent" };
    case "GET id.example.net/consent":
      return { html: page("ExampleID", '<form method="post" action="/continue"><button id="continue">Continue to Example</button></form>') };
    case "POST id.example.net/continue":
      return { redirect: "http://login.example.com/code", status: 303 };
    case "GET login.example.com/code":
      return { html: page("Enter your code", codeField) };
    case "GET login.example.com/other":
      return { html: page("Example help", codeField) };
    // Someone's form published on the same site, asking for "the code we just sent you".
    case "GET forms.example.com/f/collect":
      return { html: page("Quick survey", `${codeField}<a id="next" href="/f/thanks">Next</a>`) };
    case "GET forms.example.com/f/thanks":
      return { html: page("Thanks", codeField) };
    // A sign-in that goes through `left` more pages by itself, each a form it posts that redirects to the next.
    case "GET login.example.com/hops":
    case "GET login.example.com/step":
      return {
        html: page(
          left ? `${left} to go` : "Signed in",
          left ? `<form method="post" action="/hop?left=${left}"></form>${pathname === "/step" ? "<script>document.forms[0].submit()</script>" : ""}` : ""
        )
      };
    case "POST login.example.com/hop":
      return { redirect: `http://login.example.com/step?left=${left - 1}`, status: 303 };
    default:
      return { status: 404, html: page("Not found", route) };
  }
}

function standInSites() {
  const server = createServer((request, response) => {
    request.resume();
    const answer = sites(request);
    if (answer.redirect) {
      response.writeHead(answer.status || 302, { location: answer.redirect }).end();
      return;
    }
    response.writeHead(answer.status || 200, { "content-type": "text/html; charset=utf-8" }).end(answer.html);
  });
  return new Promise<Server>((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The person's Gmail, as its API answers: one sign-in code from example.com, a minute old. Other requests go out as usual. */
function standInGmail() {
  const original = globalThis.fetch;
  const header = (name: string, value: string) => ({ name, value });
  const routes: Record<string, unknown> = {
    "/messages?q=after": { messages: [{ id: "m-code" }] },
    "/messages/m-code?format=metadata": {
      internalDate: String(now - 60_000),
      payload: { headers: [header("From", "Example <no-reply@example.com>"), header("Subject", "Your Example sign-in code")] }
    },
    "/messages/m-code?format=full": {
      payload: {
        mimeType: "text/plain",
        headers: [header("Subject", "Your Example sign-in code")],
        body: { data: Buffer.from(`Your verification code is ${CODE}.`).toString("base64url") }
      }
    }
  };
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("gmail.googleapis.com")) return original(url, options);
    const found = Object.entries(routes).find(([part]) => String(url).includes(part));
    return new Response(JSON.stringify(found ? found[1] : { error: { message: "not found" } }), { status: found ? 200 : 404 });
  };
  return () => {
    globalThis.fetch = original;
  };
}

/**
 * A pass-through to Chromium's remote control that keeps every command the computer manager sends, and the events that
 * reach the sessions it opened on tabs itself: the sign-in chain's (Puppeteer's own sessions come from auto-attach).
 */
function countingProxy(endpoint: string) {
  const commands: { method: string; session: string }[] = [];
  const chainEvents: { method: string; url: string }[] = [];
  const chainSessions = new Set<string>();
  const tabs = new Set<string>();
  const attaching = new Map<number, string>();
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (client) => {
    const browser = new WebSocket(endpoint, { perMessageDeflate: false });
    const waiting: string[] = [];
    browser.on("open", () => waiting.splice(0).forEach((message) => browser.send(message)));
    client.on("message", (data) => {
      const message = data.toString();
      const { id, method, params, sessionId = "" } = JSON.parse(message);
      commands.push({ method, session: sessionId });
      if (method === "Target.attachToTarget") attaching.set(id, params.targetId);
      if (browser.readyState === WebSocket.OPEN) browser.send(message);
      else waiting.push(message);
    });
    browser.on("message", (data) => {
      const message = data.toString();
      const { id, method, params, result, sessionId = "" } = JSON.parse(message);
      if (params?.targetInfo?.type === "page") tabs.add(params.targetInfo.targetId);
      if (!sessionId && result?.sessionId && tabs.has(attaching.get(id) ?? "")) chainSessions.add(result.sessionId);
      if (method && chainSessions.has(sessionId)) chainEvents.push({ method, url: params?.url || params?.frame?.url || "" });
      client.send(message);
    });
    client.on("close", () => browser.close());
    browser.on("close", () => client.close());
  });
  const ready = new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    commands,
    chainEvents,
    chainSessions,
    url: async () => {
      await ready;
      const { port } = server.address() as { port: number };
      return `ws://127.0.0.1:${port}${new URL(endpoint).pathname}`;
    },
    close: () => {
      for (const client of server.clients) client.terminate();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

let sitesServer: Server | undefined;
let chrome: Browser | undefined;
let proxy: ReturnType<typeof countingProxy> | undefined;
let manager: ReturnType<typeof createComputerManager> | undefined;
let restoreFetch: (() => void) | undefined;
let clock = now;
let shots = 0;

/** The tab or popup on this test's own connection that holds `selector`. */
async function pageWith(selector: string): Promise<Page> {
  for (const tab of await chrome!.pages()) {
    if (await tab.$(selector).catch(() => null)) return tab;
  }
  throw new Error(`No page has ${selector}`);
}

const typedCode = async (selector = "#code") => (await pageWith(selector)).$eval(selector, (input) => (input as HTMLInputElement).value);

/**
 * What Mercbot's tools and cards are given on the person's own turn, with this computer and their Gmail, after they
 * said `said`.
 */
function personTurn(said = "Please sign in to example.com for me") {
  const before: { body: { text: string; detail?: string } }[] = [];
  const after: { kind: string; body: { question: string; subline: string; action: { id: string; args: Record<string, string> } } }[] = [];
  const integrations = {
    reachableAccounts: async () => [{ id: "1", pluginId: "gmail", label: "pat@example.org", name: "Pat", home: false }],
    connections: { accessToken: async () => ({ accessToken: "stand-in" }) },
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [] })
  };
  const reach = { userId: "7", homeId: "3", personal: true };
  const signIns = buildSignInCodeTools({
    appFor: () => ({ integrations, reach, skip: [], call: {} }),
    computer: manager,
    computerId: COMPUTER,
    conversationId: COMPUTER,
    turns: { messages: async () => [{ body: { text: said } }] },
    call: {},
    inTime: (work: Promise<unknown>) => work,
    before,
    after,
    askFirst: (card: object) => after.push({ kind: "choice", body: { purpose: "approval", ...card } } as never),
    screenshots: [],
    untrusted: (text: string) => text,
    wait: { minutes: 10, tries: 1, everyMs: 0 }
  });
  /** The person says yes on the card: its action runs as botCards.answerChoice runs it. */
  const approve = (args: Record<string, string>) =>
    SIGN_IN_CODE_ACTIONS.fill_sign_in_code.run({ integrations, reach, call: {}, computer: manager, conversationId: COMPUTER }, args);
  return {
    start: (address: string) => signIns.tools.startSignIn.execute({ address }),
    fillCode: () => signIns.tools.fillSignInCode.execute({ site: "example.com" }),
    finished: signIns.finished,
    approve,
    before,
    after
  };
}

/** Stagehand's act, without its AI: "click <selector>" clicks that element wherever it's open. */
const standInStagehand = {
  create: async () => ({
    act: async (instruction: string) => {
      const selector = instruction.replace(/^click /u, "");
      await (await pageWith(selector)).click(selector);
      return { success: true, message: "Clicked." };
    },
    observe: async () => ({ data: [] }),
    close: async () => {}
  })
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  sitesServer = await standInSites();
  const { port } = sitesServer.address() as { port: number };
  chrome = await puppeteer.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    args: [
      "--no-sandbox",
      `--host-resolver-rules=MAP *.example.com 127.0.0.1:${port},MAP *.example.net 127.0.0.1:${port}`,
      "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable"
    ]
  });
  proxy = countingProxy(chrome.wsEndpoint());
  const cdpUrl = await proxy.url();
  restoreFetch = standInGmail();
  manager = createComputerManager({
    env: {},
    changed: () => {},
    store: async () => `shot-${(shots += 1)}`,
    state: {},
    apps: { launchers: async () => [], closed: async () => {}, command: async () => [] },
    browser: async () => null,
    cdp: {},
    coding: { running: () => false, stop: () => {} },
    withDay: (_computerId: string, start: () => Promise<unknown>) => start(),
    startBrowser: async () => ({ cdpUrl, extensionCdpUrl: cdpUrl, saved: { cookies: [], url: "" } }),
    libraries: async () => ({ Stagehand: standInStagehand, localBrowser: { connect: async () => ({ close: async () => {} }) }, puppeteer }),
    clock: () => clock
  });
  await manager.wake(COMPUTER);
});

test.afterAll(async () => {
  restoreFetch?.();
  await manager?.shutdown();
  await proxy?.close();
  await chrome?.close();
  await new Promise((resolve) => (sitesServer ? sitesServer.close(resolve) : resolve(null)));
});

test.afterEach(async () => {
  // Each test starts from the bot's one tab: popups a test opened close.
  const [botTab, ...others] = await chrome!.pages();
  await Promise.all(others.map((tab) => tab.close()));
  await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe(botTab.url());
});

test("a sign-in the person asked for gets its code, through a redirect, a popup on another site and a form, without asking", async () => {
  const turn = personTurn();
  const opened = await turn.start("http://www.example.com/");
  expect(opened.url, "the first address redirected").toBe("http://login.example.com/start");
  expect(await manager!.signInPage(COMPUTER)).toEqual({ url: opened.url, inChain: true, startedFrom: "http://www.example.com/" });

  // "Sign in with ExampleID" opens a popup, which comes to the front in the chain and redirects.
  await manager!.act(COMPUTER, "click #with-id");
  await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe("http://id.example.net/consent");
  expect((await manager!.signInPage(COMPUTER)).inChain).toBe(true);
  // Its form posts and redirects back to example.com, in another of Chromium's processes.
  await manager!.act(COMPUTER, "click #continue");
  await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe("http://login.example.com/code");

  const filled = await turn.fillCode();
  expect(filled.status).toBe("filled");
  expect(turn.after, "no card").toEqual([]);
  expect(await typedCode(), "typed into the popup's code field").toBe(CODE);
  expect(JSON.stringify([filled, turn.before]), "never shown to the bot or the chat").not.toContain(CODE);
  expect(turn.before[0].body.detail).toContain("into http://login.example.com/code, where the sign-in you asked for led from http://www.example.com/");
});

test("a form on the same site that the bot opened itself gets a card with its address and sender, and the code only after a yes", async () => {
  const turn = personTurn();
  await turn.start("http://www.example.com/");
  const form = "http://forms.example.com/f/collect?ref=abc";
  await manager!.browse(COMPUTER, form);
  expect(await manager!.signInPage(COMPUTER), "opening an address itself ended the chain").toEqual({ url: form, inChain: false, startedFrom: "" });

  const asked = await turn.fillCode();
  expect(asked.status).toBe("waiting_for_approval");
  const [card] = turn.after;
  expect(card.body.question).toBe("Shall I type the sign-in code from no-reply@example.com into this page?");
  expect(card.body.subline, "the page's full address").toBe(form);
  expect(await typedCode(), "nothing typed before the yes").toBe("");

  const said = await turn.approve(card.body.action.args);
  expect(said.body.text).toBe("Typed in the sign-in code from your email");
  expect(await typedCode()).toBe(CODE);
});

test("a yes for a page that has moved on since types nothing", async () => {
  const turn = personTurn();
  await manager!.browse(COMPUTER, "http://forms.example.com/f/collect");
  await turn.fillCode();
  const [card] = turn.after;
  await manager!.act(COMPUTER, "click #next");
  await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe("http://forms.example.com/f/thanks");

  const said = await turn.approve(card.body.action.args);
  expect(said.body.text).toBe("Couldn't type in the sign-in code");
  expect(said.body.detail).toContain("The page has moved on since, so nothing was typed.");
  expect(await typedCode()).toBe("");
});

test("the chain closes 10 minutes after it started, when the bot opens an address itself, and when the sign-in is over", async () => {
  const turn = personTurn("Please sign in to example.com for me, at login.example.com/code");
  await turn.start("http://login.example.com/code");
  expect((await manager!.signInPage(COMPUTER)).inChain).toBe(true);
  clock += SIGN_IN_CHAIN_MS;
  expect((await manager!.signInPage(COMPUTER)).inChain, "10 minutes on").toBe(false);
  expect((await turn.fillCode()).status, "so the person is asked").toBe("waiting_for_approval");
  // The computer checks the chain again just before typing, so a page that left it meanwhile gets nothing.
  expect(await manager!.fill(COMPUTER, { site: "example.com", code: CODE, inChain: true })).toEqual({
    filled: [],
    outsideChain: true,
    url: "http://login.example.com/code"
  });
  expect(await typedCode()).toBe("");

  // An address the bot opens itself closes the whole chain: a window the sign-in's popup opens afterwards isn't in it.
  await turn.start("http://www.example.com/");
  await manager!.act(COMPUTER, "click #with-id");
  await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe("http://id.example.net/consent");
  await manager!.browse(COMPUTER, "http://login.example.com/other");
  expect(await manager!.signInPage(COMPUTER), "an address the bot opened itself").toEqual({
    url: "http://login.example.com/other",
    inChain: false,
    startedFrom: ""
  });
  await (await pageWith("#continue")).evaluate(() => {
    window.open("http://login.example.com/code", "later");
  });
  await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe("http://login.example.com/code");
  expect((await manager!.signInPage(COMPUTER)).inChain, "a window the popup opened later").toBe(false);

  const finishing = personTurn("Sign in at login.example.com/code please");
  await finishing.start("http://login.example.com/code");
  await finishing.finished();
  expect((await manager!.signInPage(COMPUTER)).inChain, "the turn ended with nothing waiting on the person").toBe(false);
});

test("the chain's bookkeeping costs the same for every navigation: three events and no command", async () => {
  const turn = personTurn("Please sign in at login.example.com/hops?left=30 and login.example.com/hops?left=3");
  // The events the chain listens to (signInChain.js); its session hears the rest of the Page domain's too.
  const handled = new Set(["Page.frameRequestedNavigation", "Page.frameStartedNavigating", "Page.frameNavigated"]);
  const cost: Record<number, { commands: string[]; events: number }> = {};
  for (const hops of [3, 30]) {
    await turn.start(`http://login.example.com/hops?left=${hops}`);
    const botTab = await pageWith("form");
    const sent = proxy!.commands.length;
    const heard = proxy!.chainEvents.length;
    // The page goes through `hops` pages by itself, each a form it posts and a redirect.
    await botTab.$eval("form", (form) => (form as HTMLFormElement).submit());
    const arrived = () => proxy!.chainEvents.slice(heard).some(({ method, url }) => method === "Page.frameNavigated" && url.endsWith("step?left=0"));
    await expect.poll(arrived).toBe(true);
    await expect.poll(async () => (await manager!.signInPage(COMPUTER)).url).toBe("http://login.example.com/step?left=0");
    expect((await manager!.signInPage(COMPUTER)).inChain, `still in the chain after ${hops} pages`).toBe(true);
    cost[hops] = {
      commands: proxy!.commands.slice(sent).filter(({ session }) => proxy!.chainSessions.has(session)).map(({ method }) => method),
      events: proxy!.chainEvents.slice(heard).filter(({ method }) => handled.has(method)).length
    };
  }
  test.info().annotations.push({
    type: "cost",
    description:
      `Over 3 navigations the chain sent ${cost[3].commands.length} commands and handled ${cost[3].events} events; ` +
      `over 30, ${cost[30].commands.length} and ${cost[30].events}.`
  });
  expect(cost[3]).toEqual({ commands: [], events: 3 * 3 });
  expect(cost[30]).toEqual({ commands: [], events: 3 * 30 });
  // Over everything this file did, each tab's chain session was sent its two commands when it opened and nothing else.
  expect(proxy!.chainSessions.size).toBeGreaterThan(0);
  for (const session of proxy!.chainSessions) {
    expect(proxy!.commands.filter((command) => command.session === session).map(({ method }) => method)).toEqual(["Page.enable", "Page.getFrameTree"]);
  }
});
