import { readFileSync } from "node:fs";
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

type GuardWindow = { e2eAttentionRequired: (text: string) => void; e2ePending?: () => string[] };

/** The API guard's watch over one browser context: it adds what it finds to `problems`. */
async function watchContext(context: BrowserContext, problems: string[]) {
  context.on("response", (response) => {
    const call = apiCall(response.request());
    if (call && response.status() >= 400 && !response.headers()[MADE_UP]) problems.push(`${response.status()} ${call}`);
  });
  context.on("requestfailed", (request) => {
    const call = apiCall(request);
    // A call the page gave up itself (it left the page, or no longer needed the answer) is no fault.
    const reason = request.failure()?.errorText || "failed";
    if (call && reason !== "net::ERR_ABORTED") problems.push(`no answer (${reason}): ${call}`);
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
 * The contrast ratio (WCAG 2) of an element's text against what shows behind it: its own background, else the nearest
 * ancestor's, see-through ones blended down to the first opaque one. Text in its background's own colour, as a selected
 * segment's label drawn in the segment's colour, is about 1; WCAG asks body text for 4.5.
 */
export async function textContrast(target: Locator) {
  return target.evaluate((element) => {
    type Colour = { r: number; g: number; b: number; a: number };
    const colour = (value: string): Colour => {
      const [r, g, b, a = 1] = (value.match(/[\d.]+/gu) || []).map(Number);
      return { r, g, b, a };
    };
    const over = (top: Colour, under: Colour): Colour => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const layers: Colour[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const background = colour(getComputedStyle(node).backgroundColor);
      if (background.a > 0) layers.push(background);
      if (background.a >= 1) break;
    }
    const behind = layers.reduceRight((under, layer) => over(layer, under), { r: 255, g: 255, b: 255, a: 1 });
    const text = over(colour(getComputedStyle(element).color), behind);
    const luminance = ({ r, g, b }: Colour) => {
      const [red, green, blue] = [r, g, b].map((channel) => (channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const [light, dark] = [luminance(text), luminance(behind)].sort((first, second) => second - first);
    return (light + 0.05) / (dark + 0.05);
  });
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

export { expect };
export type { Browser, Page, Route } from "@playwright/test";
