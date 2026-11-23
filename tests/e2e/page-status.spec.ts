import { createServer, type Server } from "node:http";
import { chromium, expect, test } from "@playwright/test";
import puppeteer, { type Browser } from "puppeteer-core";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { createComputerManager } from "../../packages/computer/src/server/computerManager.js";
import { turnDoubles } from "../support/botDoubles.mjs";

// The status of each page the bot opens, in a real Chromium: the computer manager runs as on a server, through its
// startBrowser and libraries seams, with a plain Chromium in place of the gVisor desktop. The site is a stand-in on this
// test's own server, shaped like a WordPress site: /programme/ is a page, /programme redirects there, and /tickets is
// its "NOT FOUND" page. A reply's tools then open them as the bot does: the missing page is an error, with no
// screenshot under the reply. No Test Preview is needed, so this uses Playwright's test directly rather than harness.ts.

const SEAT = Object.freeze({ id: "13", workspace_id: "11", user_id: "12", chat_id: "14", chat_bot_id: "9", chat: { id: "14", kind: "private" } });

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><h1>${body}</h1></body></html>`;

function standInSite() {
  const server = createServer((request, response) => {
    request.resume();
    const { pathname } = new URL(request.url || "/", "http://site.test");
    if (pathname === "/programme") {
      response.writeHead(301, { location: "/programme/" }).end();
    } else if (pathname === "/programme/" || pathname === "/about/") {
      const title = pathname === "/about/" ? "About" : "Programme";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(title, `The ${title.toLowerCase()}`));
    } else {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end(page("Page not found", "NOT FOUND"));
    }
  });
  return new Promise<Server>((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let siteServer: Server | undefined;
let chrome: Browser | undefined;
let manager: ReturnType<typeof createComputerManager> | undefined;
let site = "";
let shots = 0;

test.beforeAll(async () => {
  siteServer = await standInSite();
  site = `http://127.0.0.1:${(siteServer.address() as { port: number }).port}`;
  chrome = await puppeteer.launch({ executablePath: chromium.executablePath(), headless: true, args: ["--no-sandbox"] });
  const cdpUrl = chrome.wsEndpoint();
  manager = createComputerManager({
    env: {},
    changed: () => {},
    store: async () => `9-${String((shots += 1)).padStart(16, "0")}.jpg`,
    state: {},
    apps: { launchers: async () => [], closed: async () => {}, command: async () => [] },
    browser: async () => null,
    cdp: {},
    coding: { running: () => false, stop: () => {} },
    withDay: (_computerId: string, start: () => Promise<unknown>) => start(),
    startBrowser: async () => ({ cdpUrl, extensionCdpUrl: cdpUrl, saved: { cookies: [], url: "" } }),
    libraries: async () => ({
      Stagehand: { create: async () => ({ close: async () => {} }) },
      localBrowser: { connect: async () => ({ close: async () => {} }) },
      puppeteer
    })
  });
  await manager.wake(SEAT.chat_bot_id);
});

test.afterAll(async () => {
  await manager?.shutdown();
  await chrome?.close();
  await new Promise((resolve) => (siteServer ? siteServer.close(resolve) : resolve(null)));
});

test("a missing page reports its 404", async () => {
  const missing = await manager!.browse(SEAT.chat_bot_id, `${site}/tickets`);
  expect([missing.url, missing.title, missing.status]).toEqual([`${site}/tickets`, "Page not found", 404]);
});

test("a redirected page reports the 200 of the page the redirect led to", async () => {
  const redirected = await manager!.browse(SEAT.chat_bot_id, `${site}/programme`);
  expect([redirected.url, redirected.title, redirected.status]).toEqual([`${site}/programme/`, "Programme", 200]);
});

test("a page that answers at once reports its 200, also when it's read again without reloading", async () => {
  const direct = await manager!.browse(SEAT.chat_bot_id, `${site}/about/`);
  expect([direct.url, direct.title, direct.status]).toEqual([`${site}/about/`, "About", 200]);
  expect((await manager!.browse(SEAT.chat_bot_id, `${site}/about/`)).status).toBe(200);
});

test("a reply that opened a missing page tells the bot to use the site's links, and shows only the pages that exist", async () => {
  const run = buildTools(turnDoubles({ approvals: { decide: async () => "allow" }, computer: manager, seat: SEAT }));
  const open = (url: string) => run.tools.openWebPage.execute({ url });
  expect(await open(`${site}/tickets`)).toEqual({
    error: "That page doesn't exist (404). Use the links on the site's own pages instead of guessing addresses."
  });
  expect((await open(`${site}/programme`)).title).toBe("Programme");
  expect((await open(`${site}/about/`)).title).toBe("About");
  await run.finish();
  const under = run.after.find((message: { kind: string }) => message.kind === "screenshots");
  expect(under.body.images.map((image: { caption: string }) => image.caption)).toEqual(["Programme", "About"]);
});
