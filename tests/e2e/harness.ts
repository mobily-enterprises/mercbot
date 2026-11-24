import { readFileSync } from "node:fs";
import knexLib from "knex";
import type { Knex } from "knex";
import { expect, test as base, type Browser, type BrowserContext, type Locator, type Page, type Request as PageRequest, type Route } from "@playwright/test";

// The browser suite's `test`: when the run started its own Test Previews (globalSetup.mjs), each
// worker uses its own, on its own database, signed in as the first saved Preview identity. On
// Vibe64's managed run the one target comes from the config, as before.
type Target = { baseURL: string; storageState: string; database: string };
const targets: Target[] = process.env.MERCBOT_E2E_TARGETS ? JSON.parse(readFileSync(process.env.MERCBOT_E2E_TARGETS, "utf8")) : [];
const target = (parallelIndex: number): Target | undefined => targets[parallelIndex];

/** The header a test puts on an answer it makes up itself (route.fulfill), so the API guard leaves it alone. */
export const MADE_UP = "x-e2e-made-up";

/** How long the API guard waits, once a test has ended, for the API calls its pages are still waiting on. */
const SETTLE_MS = 10_000;

/** The annotation type of a refusal the test expects (expectRefusal). */
const REFUSAL = "expected refusal";

type Guard = { apiGuard: boolean; apiGuardCheck: void };

/** "METHOD /path?query" for a call to the app's API, or "" for any other request. */
function apiCall(request: PageRequest) {
  const { pathname, search } = new URL(request.url());
  return pathname.startsWith("/api/") ? `${request.method()} ${pathname}${search}` : "";
}

// How each browser engine reports a request the page itself cut off (by leaving it, or aborting it). Firefox says
// NS_ERROR_ABORT for an event stream still open when the page leaves for another site (a phone's sign-in, which
// reaches its hand-off page through the router and leaves from there), NS_BINDING_ABORTED for other calls.
const GAVE_UP = new Set(["net::ERR_ABORTED", "NS_BINDING_ABORTED", "NS_ERROR_ABORT", "Load request cancelled"]);

type GuardWindow = { e2eAttentionRequired: (text: string) => void; e2ePending?: () => string[] };

/** The API guard's watch over one browser context: it adds what it finds to `problems`. */
async function watchContext(context: BrowserContext, problems: string[]) {
  context.on("response", (response) => {
    const call = apiCall(response.request());
    if (call && response.status() >= 400 && !response.headers()[MADE_UP]) problems.push(`${response.status()} ${call}`);
  });
  context.on("requestfailed", (request) => {
    const call = apiCall(request);
    // A call the page gave up itself (it left the page, or no longer needed the answer) is no fault: each engine says
    // so in its own words (Chromium, Firefox, WebKit).
    const reason = request.failure()?.errorText || "failed";
    if (call && !GAVE_UP.has(reason)) problems.push(`no answer (${reason}): ${call}`);
  });
  await context.exposeBinding("e2eAttentionRequired", (_source, text: string) => problems.push(`"Attention required" dialog: ${text}`));
  await context.addInitScript(() => {
    const guard = window as unknown as GuardWindow;
    // The page's own calls to the API still on their way (e2ePending), which the guard asks each page for once the
    // test ends. A document that's left takes its calls with it, and can't be asked: Playwright doesn't say that the
    // browser cut them off, and may even report one only after the document has gone.
    const pending = new Map<number, string>();
    let next = 0;
    const send = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = send(input, init);
      const url = URL.parse(input instanceof Request ? input.url : String(input), location.href);
      if (!url?.pathname.startsWith("/api/")) return answer;
      const id = next++;
      pending.set(id, `${(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase()} ${url.pathname}${url.search}`);
      return answer.finally(() => pending.delete(id));
    };
    guard.e2ePending = () => [...pending.values()];
    // Once its document is left (pagehide), what a page shows is never seen: the dialog for a call that leaving cut
    // off ("Network request failed.") isn't a fault, until the document is shown again.
    let left = false;
    addEventListener("pagehide", () => {
      left = true;
    });
    addEventListener("pageshow", () => {
      left = false;
    });
    const told = new Set<string>();
    new MutationObserver(() => {
      if (left) return;
      for (const title of document.querySelectorAll(".v-card-title")) {
        if (title.textContent?.trim() !== "Attention required") continue;
        const text = ((title.closest(".v-card") as HTMLElement | null)?.innerText || "").replace(/\s+/gu, " ").trim();
        if (!told.has(text)) {
          told.add(text);
          guard.e2eAttentionRequired(text);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** The API calls the live documents of `contexts` are still waiting on. */
async function pendingCalls(contexts: BrowserContext[]) {
  const frames = contexts.flatMap((context) => context.pages()).flatMap((page) => page.frames());
  const asked = frames.map((frame) => frame.evaluate(() => (window as unknown as GuardWindow).e2ePending?.() ?? []).catch(() => []));
  return (await Promise.all(asked)).flat();
}

/**
 * The API guard around `run` (see `apiGuard` below), on `context` and every context made meanwhile: resolves with
 * the problems it found, once the calls still on their way have answered or `settleMs` has passed.
 */
export async function apiGuardProblems({ browser, context, settleMs = SETTLE_MS }: { browser: Browser; context: BrowserContext; settleMs?: number }, run: () => Promise<void>) {
  const problems: string[] = [];
  const contexts = [context];
  const watches = [watchContext(context, problems)];
  // A context the test makes itself (browser.newContext) is watched from its start; its watch's setup is
  // awaited with the others afterwards.
  const watchNew = (created: BrowserContext) => {
    const watch = watchContext(created, problems);
    watch.catch(() => {});
    contexts.push(created);
    watches.push(watch);
  };
  browser.on("context", watchNew);
  try {
    await watches[0];
    await run();
  } finally {
    browser.off("context", watchNew);
  }
  await Promise.all(watches);
  const deadline = Date.now() + settleMs;
  let pending = await pendingCalls(contexts);
  while (pending.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    pending = await pendingCalls(contexts);
  }
  for (const call of pending) problems.push(`no answer ${settleMs / 1000} s after the test: ${call}`);
  return problems;
}

export const test = base.extend<Guard>({
  baseURL: async ({ baseURL }, use, testInfo) => use(target(testInfo.parallelIndex)?.baseURL ?? baseURL),
  storageState: async ({ storageState }, use, testInfo) => use(target(testInfo.parallelIndex)?.storageState ?? storageState),
  // A person's own copy takes a change only from its own page, by its Origin (D-81): the test's own requests
  // (page.request) say they come from it, as the page's own do.
  extraHTTPHeaders: async ({ extraHTTPHeaders, baseURL }, use) => use(baseURL ? { ...extraHTTPHeaders, origin: new URL(baseURL).origin } : extraHTTPHeaders),
  // The API guard, for a spec with test.use({ apiGuard: true }): the test fails on any answer of 400 or
  // more from the app's API to its pages, unless the test made it up (MADE_UP) or checks for it
  // (expectRefusal), on a call that gets no answer at all, and on JSKIT's "Attention required" dialog,
  // which shows an error nothing in the page handled and takes every click until it's closed. A page that
  // asks the server about something that isn't there (a bot still being created, a message not saved yet)
  // shows up here at once. It watches every browser context the test uses, its own ones too, and once the
  // test ends it waits up to SETTLE_MS for the calls still on their way, so an answer that comes late is
  // checked as well, and a call still unanswered then counts as one that never got an answer. A call the
  // page gives up, or leaves behind with its document, isn't waited for. The test's own requests
  // (page.request) aren't the page's and aren't checked.
  apiGuard: [false, { option: true }],
  apiGuardCheck: [async ({ browser, context, apiGuard }, use, testInfo) => {
    if (!apiGuard) return use();
    const problems = await apiGuardProblems({ browser, context }, use);
    const expected = new Set(testInfo.annotations.filter(({ type }) => type === REFUSAL).map(({ description }) => description));
    expect(problems.filter((problem) => !expected.has(problem)), "the page's API answers of 400 or more, its calls with no answer, and JSKIT's error dialog").toEqual([]);
  }, { auto: true }]
});

/**
 * Refusals the test checks for, such as "401 POST /api/login" for a wrong password: the page asks for something it
 * mustn't get and shows the refusal. The API guard leaves each one alone in that test, wherever it comes.
 */
export function expectRefusal(...calls: string[]) {
  for (const call of calls) test.info().annotations.push({ type: REFUSAL, description: call });
}

/**
 * The contrast ratio (WCAG 2) of an element's text, or of its focus ring, against what shows behind it: for text its own
 * background, else the nearest ancestor's; for the ring, drawn outside the element, its parent's and on. See-through
 * ones are blended down to the first opaque one. Also the ring's style and width, as the page computes them.
 */
async function contrastBehind(target: Locator, ring: boolean) {
  return target.evaluate((element, ring) => {
    type Colour = { r: number; g: number; b: number; a: number };
    const colour = (value: string): Colour => {
      const [r, g, b, a = 1] = (value.match(/[\d.]+/gu) || []).map(Number);
      return { r, g, b, a };
    };
    const over = (top: Colour, under: Colour): Colour => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const layers: Colour[] = [];
    for (let node: Element | null = ring ? element.parentElement : element; node; node = node.parentElement) {
      const background = colour(getComputedStyle(node).backgroundColor);
      if (background.a > 0) layers.push(background);
      if (background.a >= 1) break;
    }
    const behind = layers.reduceRight((under, layer) => over(layer, under), { r: 255, g: 255, b: 255, a: 1 });
    const style = getComputedStyle(element);
    const front = over(colour(ring ? style.outlineColor : style.color), behind);
    const luminance = ({ r, g, b }: Colour) => {
      const [red, green, blue] = [r, g, b].map((channel) => (channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const [light, dark] = [luminance(front), luminance(behind)].sort((first, second) => second - first);
    return { ratio: (light + 0.05) / (dark + 0.05), style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  }, ring);
}

/**
 * The contrast ratio (WCAG 2) of an element's text against what shows behind it. Text in its background's own colour,
 * as a selected segment's label drawn in the segment's colour, is about 1; WCAG asks body text for 4.5.
 */
export async function textContrast(target: Locator) {
  return (await contrastBehind(target, false)).ratio;
}

/**
 * An element's focus ring: its style, width and contrast against what's behind it. Material 3 asks a focus indicator
 * for at least 3:1; a browser's own ring (style "auto") is drawn in the browser's colours, which the page can't vouch for.
 */
export async function focusRing(target: Locator) {
  return contrastBehind(target, true);
}

/**
 * Holds an app's draft reads (POST `path`, version draft, those `which` picks) on their way, as a slow first read of a
 * new practice copy is (D-71), so they're still waited for while Reset or Publish clears the copy they read. Released,
 * each gets the answer the server gives a read the clearing caught in between (409, apps_practice_gone), unless the page
 * has dropped it; release() answers how many the page still waited for. Its 409 isn't made up (MADE_UP): one the page
 * waited for also fails the API guard.
 */
export async function holdDraftReads(page: Page, path: string, which: (read: Record<string, unknown>) => boolean = () => true) {
  const held: Route[] = [];
  let holding = true;
  await page.route(path, (route) => {
    const read = route.request().postDataJSON();
    return holding && read?.version === "draft" && which(read) ? held.push(route) : route.fallback();
  });
  const gone = { status: 409, contentType: "application/json", body: JSON.stringify({ error: "This practice data was just reset or cleared. Reload the preview to start again.", code: "apps_practice_gone" }) };
  return {
    held: () => held.length,
    stopHolding: () => {
      holding = false;
    },
    async release() {
      const answered = await Promise.all(held.map(async (route) => {
        const answer = route.request().response();
        await route.fulfill(gone).catch(() => {});
        return answer;
      }));
      await page.unroute(path);
      return answered.filter(Boolean).length;
    }
  };
}

/** The worker's test database: its own copy, or TEST_DB_NAME on a managed run. */
export function testDatabaseName() {
  return target(Number(process.env.TEST_PARALLEL_INDEX))?.database ?? process.env.TEST_DB_NAME;
}

/** The fixtures' home: the personal home of the copy's one person (tests/support/fixtures.mjs). */
export const HOME = "/w/you";

/** The worker's test database, for what a test seeds or checks itself; `destroy()` it when the test ends. */
export const connectTestDb = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

type Json = Record<string, any>;

/**
 * The test's own calls to a home's API (page.request, with JSKIT's CSRF token), under /api/w/<slug>: each expects an
 * answer of 2xx, naming the call and its answer when it isn't, and resolves with its JSON. `answer` gives the raw
 * response, for a test that checks a refusal.
 */
export async function homeApi(page: Page, home = HOME) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const at = (path: string) => `/api${home}${path}`;
  const answer = (method: string, path: string, data?: unknown) =>
    page.request.fetch(at(path), { method, headers, ...(data === undefined ? {} : { data }) });
  const call = async (method: string, path: string, data?: unknown): Promise<Json> => {
    const response = await answer(method, path, data);
    const text = await response.text();
    expect(response.ok(), `${method} ${at(path)} answered ${response.status()}: ${text}`).toBe(true);
    return text ? JSON.parse(text) : {};
  };
  return {
    headers,
    get: (path: string) => call("GET", path),
    post: (path: string, data: unknown = {}) => call("POST", path, data),
    patch: (path: string, data: unknown) => call("PATCH", path, data),
    put: (path: string, data: unknown) => call("PUT", path, data),
    del: (path: string) => call("DELETE", path),
    answer
  };
}

/** The home's bot named `name` (GET /bots, the sidebar's Bots), or a failed expectation naming it. */
export async function botNamed(page: Page, name: string, home = HOME): Promise<Json> {
  const { bots } = await (await homeApi(page, home)).get("/bots");
  const bot = bots.find((entry: { name: string }) => entry.name === name);
  expect(bot, `${home} has a bot called ${name}`).toBeTruthy();
  return bot;
}

/**
 * A room made as New room's [Create] makes it (D-112, D15): Public unless `kind` is "private", named `title` (a room
 * needs one), its maker in it with its start line ("<Name> started this room."), and the people and bots named.
 * Resolves with the chat (the ChatView).
 */
export async function makeChat(page: Page, choice: { kind?: "public" | "private"; title?: string | null; people?: string[]; bots?: string[] }, home = HOME): Promise<Json> {
  const { chat } = await (await homeApi(page, home)).post("/chats", { kind: "public", title: null, people: [], bots: [], ...choice });
  return chat;
}

/** The person's direct chat with a bot, as its row in Bots or its card's [Message] opens it (made on first use). */
export async function directChat(page: Page, botId: string, home = HOME): Promise<Json> {
  const { chat } = await (await homeApi(page, home)).post(`/bots/${botId}/direct`);
  return chat;
}

/**
 * A home's shell at `query` (?chat=<id>, ?bot=<id>, &member=bot:<id>…), past the intro slides a person sees in their first home
 * when its welcome chat is made, once the shell shows.
 */
export async function openShell(page: Page, query = "", home = HOME) {
  await page.goto(`${home}${query}`);
  const next = page.getByRole("button", { name: "Next" });
  const shown = page.locator(".mb-shell");
  await expect(shown.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shown).toBeVisible();
}

/** The shell's parts as a person finds them (D-112): the sidebar, a chat's row, the open chat and Details. */
export const shell = {
  /** The sidebar: Search, Files and Apps, pinned tiles, then Rooms, People and Bots. */
  sidebar: (page: Page) => page.getByRole("navigation", { name: "Chats" }),
  /** One of the sidebar's sections, each folding by its title and with its +. */
  section: (page: Page, name: "Rooms" | "People" | "Bots") => shell.sidebar(page).getByRole("region", { name, exact: true }),
  /** A chat's row or pinned tile in the sidebar, by the name it shows ("<title>, private" for a private chat). */
  chatRow: (page: Page, name: string) => shell.sidebar(page).getByRole("button", { name, exact: true }),
  /** The chat panel: the open chat, or where to start. */
  chat: (page: Page) => page.locator("main.mb-chat"),
  /** The open chat's composer. */
  composer: (page: Page) => page.locator("textarea.mb-composer__input"),
  /** Details beside what's shown: "Chat details", or "<Name>'s card". */
  details: (page: Page, name: string | RegExp) => page.getByRole("complementary", { name }),
  /** The open context menu's items. */
  menuItems: (page: Page) => page.locator(".v-overlay--active .mb-menu .mb-menu__text"),
  /** The open question (Archive, Leave, Delete…). */
  question: (page: Page) => page.locator(".v-overlay--active .mb-confirm")
};

/**
 * A person's or a bot's row in People or Bots, by their name: one not talked with in the last 14 days is under the
 * section's "N more", which this opens first.
 */
export async function sidebarEntry(page: Page, section: "People" | "Bots", name: string) {
  const part = shell.section(page, section);
  const row = part.getByRole("button", { name, exact: true });
  const more = part.locator("button.mb-more", { hasText: /\d+ more/u });
  await expect(row.or(more).first()).toBeVisible();
  if (!(await row.isVisible())) await more.click();
  await expect(row).toBeVisible();
  return row;
}

/** A home of the test's own, made as New home makes it, with Ben Rossi a member and the owner's bot Chef. */
export async function homeWithBen(page: Page, knex: Knex) {
  const stamp = Date.now().toString(36);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const made = await page.request.post("/api/workspaces", {
    headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
    data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Hilltop ${stamp}` } } })
  });
  expect(made.ok(), await made.text()).toBe(true);
  const slug = String((await made.json()).data.attributes.slug);
  const home = await knex("workspaces").where({ slug }).first();
  const homeId = String(home.id);
  const owner = String(home.owner_user_id);
  const [ben] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `ben-${stamp}`, email: `ben-${stamp}@example.test`, username: `ben${stamp}`, display_name: "Ben Rossi"
  }).returning("id");
  const benId = String(ben.id);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: benId, role_sid: "member", status: "active" });
  const chef = String((await knex("bots").insert({ made_by: owner, workspace_id: homeId, name: "Chef", color: "#E65100", library_template: "general" }).returning("id"))[0].id);
  const remove = async () => {
    // Away from the home first, so the page reads nothing of it while it goes; a test that timed out has no page left.
    if (!page.isClosed() && page.url() !== "about:blank") await page.goto("about:blank").catch(() => null);
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
      await knex(table).where({ workspace_id: homeId }).del();
    }
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").where({ id: benId }).del();
  };
  return { slug, path: `/w/${slug}`, homeId, name: String(home.name), owner, ben: benId, chef, stamp, remove };
}

/**
 * Whether the composer is as tall as its text needs, as useComposerLines counts it: one line (22 px) while the text fits
 * beside its buttons, else 20 px a line, 2 to 6 lines, measured here from the field's own text at its own width. It is
 * measured with transitions off: the specs' reduced motion gives every element a 1 ms one, which would keep the field
 * at its old height as it is read.
 */
export const composerFits = (page: Page) => shell.composer(page).evaluate((field: HTMLTextAreaElement) => {
  const height = field.offsetHeight;
  const { height: set, transition } = field.style;
  field.style.transition = "none";
  field.style.height = "0px";
  const needs = field.scrollHeight;
  field.style.height = set;
  void field.offsetHeight;
  field.style.transition = transition;
  return height === 22 ? needs <= 22 : height === Math.min(6, Math.max(2, Math.round(needs / 20))) * 20;
});

export { seedChat, seedMessage, seedMessages } from "../support/chatFixtures.mjs";
export { expect };
export type { Browser, Page, Route } from "@playwright/test";
