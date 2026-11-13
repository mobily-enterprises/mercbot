import { apiGuardProblems, expect, test, type Page } from "./harness";

// The API guard itself (harness.ts), on a made-up site the test answers for (no Test Preview needed): it
// reports a call refused, one whose answer comes after the test, one that fails and one that never gets
// an answer, in the test's own contexts too, and leaves alone a call the page gives up itself, or leaves
// behind with the document that made it.
const SITE = "http://guard.test";

async function onSite(page: Page) {
  await page.route(`${SITE}/`, (route) => route.fulfill({ contentType: "text/html", body: "<p>Guard</p>" }));
  await page.route(`${SITE}/api/refused*`, (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.route(`${SITE}/api/late`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 409, body: "{}" });
  });
  await page.route(`${SITE}/api/fails`, (route) => route.abort("connectionreset"));
  await page.route(`${SITE}/api/never`, () => {});
  await page.route(`${SITE}/api/given-up`, () => {});
  await page.route(`${SITE}/api/left`, () => {});
  await page.goto(`${SITE}/`);
}

test("the API guard reports refused, late, failed and unanswered calls, and leaves alone those the page gives up or leaves", async ({ browser, context, page }) => {
  const problems = await apiGuardProblems({ browser, context, settleMs: 2000 }, async () => {
    await onSite(page);
    await page.evaluate(async () => {
      const answered = (path: string) => fetch(path).catch(() => null);
      await answered("/api/refused");
      await answered("/api/fails");
      // The page leaves these on their way: the test ends before they answer, if they ever do.
      void answered("/api/late");
      void answered("/api/never");
      const giveUp = new AbortController();
      void fetch("/api/given-up", { signal: giveUp.signal }).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 100));
      giveUp.abort();
    });
    // A call on its way when its page loads another document is no longer waited on, even when Playwright reports
    // it only after the document has gone (the page leaves at once here).
    const leaving = await context.newPage();
    await onSite(leaving);
    await leaving.evaluate(() => void fetch("/api/left").catch(() => null));
    await leaving.goto(`${SITE}/`);
    // A context the test makes itself is watched too.
    const own = await browser.newContext();
    try {
      const other = await own.newPage();
      await onSite(other);
      await other.evaluate(() => fetch("/api/refused?from=own").catch(() => null));
    } finally {
      await own.close();
    }
  });
  expect(problems.sort()).toEqual([
    "404 GET /api/refused",
    "404 GET /api/refused?from=own",
    "409 GET /api/late",
    "no answer (net::ERR_CONNECTION_RESET): GET /api/fails",
    "no answer 2 s after the test: GET /api/never"
  ].sort());
});
