import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { pageFallback } from "../../server.js";

const PAGE = "<!doctype html><title>Mercbot</title>";

// A server with only the fallback, as server.js registers it, over a built folder with the page, one built file and
// robots.txt; or over no build at all.
async function fallbackServer(context, { built = true } = {}) {
  const distRoot = await mkdtemp(path.join(tmpdir(), "mercbot-page-fallback-"));
  context.after(() => rm(distRoot, { recursive: true, force: true }));
  if (built) {
    await mkdir(path.join(distRoot, "assets"));
    await writeFile(path.join(distRoot, "index.html"), PAGE);
    await writeFile(path.join(distRoot, "assets", "app-3f9a.js"), "export {};\n");
    await writeFile(path.join(distRoot, "robots.txt"), "User-agent: *\n");
  }
  const app = Fastify();
  context.after(() => app.close());
  await app.register(fastifyStatic, { root: distRoot, index: false, serve: false });
  app.setNotFoundHandler(pageFallback({ distRoot, spaDocument: built ? PAGE : "" }));
  return app;
}

test("a page path gets the page, whatever its later segments hold", async (context) => {
  const app = await fallbackServer(context);
  for (const url of ["/", "/help", "/w/home/apps/people", "/w/home/apps/people/report.v2/notes"]) {
    const answer = await app.inject({ method: "GET", url });
    assert.equal(answer.statusCode, 200, url);
    assert.match(answer.headers["content-type"], /^text\/html/u, url);
    assert.equal(answer.body, PAGE, url);
  }
});

test("built files are served, and a path that names a file is never the page", async (context) => {
  const app = await fallbackServer(context);
  const script = await app.inject({ method: "GET", url: "/assets/app-3f9a.js" });
  assert.equal(script.statusCode, 200);
  assert.equal(script.body, "export {};\n");
  assert.equal((await app.inject({ method: "GET", url: "/robots.txt" })).statusCode, 200);
  // Relative path confusion: the page answered for a built file with more path after it, so the browser read the
  // page's relative references against the file's folder. Now each is a 404.
  for (const url of ["/assets/app-3f9a.js/jw33v/mv", "/assets/app-3f9a.css/x", "/assets", "/assets/missing", "/robots.txt/jw33v/mv", "/sitemap.xml/x", "/missing.js"]) {
    const answer = await app.inject({ method: "GET", url });
    assert.equal(answer.statusCode, 404, url);
    assert.notEqual(answer.body, PAGE, url);
  }
});

test("API paths and other methods get the JSON 404, and without a build so do pages", async (context) => {
  const app = await fallbackServer(context);
  assert.equal((await app.inject({ method: "GET", url: "/api/missing" })).json().statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/help" })).statusCode, 404);
  const unbuilt = await fallbackServer(context, { built: false });
  const answer = await unbuilt.inject({ method: "GET", url: "/help" });
  assert.equal(answer.statusCode, 404);
  assert.match(answer.json().error, /Frontend build is not available/u);
});
