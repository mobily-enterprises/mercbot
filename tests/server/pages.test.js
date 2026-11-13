import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import {
  describePage,
  isPagePath,
  pageKeyOf,
  prepareForSave,
  readPage,
  setTicks,
  withShell,
  withStandalonePolicy,
  withoutForbidden,
  withoutScripts,
  writePage
} from "../../packages/files/src/server/pageDocument.js";
import { createPageFiles, __testables as pageFilesTestables } from "../../packages/files/src/server/pageFiles.js";
import { pageHeaders } from "../../packages/files/src/server/pageHeaders.js";
import { __testables as pagesTestables } from "../../packages/files/src/server/pages.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { buildLoggerOptions } from "../../server/lib/loggerOptions.js";
import { turnDoubles } from "../support/botDoubles.mjs";

const { partOf } = pagesTestables;
const { fetchOutside } = pageFilesTestables;

// Rich HTML pages (D-74): what a page is saved as, what is taken out of it, the headers that seal it,
// the addresses its token reaches, and the files copied in from outside, against a local web server.

test("a page's path is an .html file in a Pages folder of a bot's folder for everyone or of the home's", () => {
  for (const good of ["/files/bot/Pages/party.html", "/files/shared/Pages/plan.html", "/files/bot/Trips/Pages/rome.html"]) assert.ok(isPagePath(good), good);
  for (const bad of [
    "/files/mine/Pages/party.html",
    "/files/bot/Pages/party.md",
    "/files/bot/party.html",
    "/files/bot/Pages/../secret.html",
    "/files/bot/Pages//party.html",
    "/files/bot/Pages/sub/party.html",
    "files/bot/Pages/party.html"
  ]) assert.equal(isPagePath(bad), false, bad);
});

test("a saved page is a whole document with its key, and keeps nothing that loads ahead or leaves", () => {
  const document = readPage(
    "<title>Party</title><base href='https://evil.example/'><meta http-equiv='refresh' content='0;url=https://evil.example'>" +
    "<link rel='prefetch' href='https://evil.example/x'><h1>Party</h1><p>Saturday at eight.</p>" +
    "<iframe src='https://evil.example'></iframe><object data='x'></object><embed src='y'><a href='https://a.example' ping='https://evil.example'>A</a>"
  );
  const removed = prepareForSave(document, { title: "Party", key: "key-1" });
  assert.deepEqual(removed.sort(), ["base", "embed", "iframe", "link rel=\"prefetch\"", "meta http-equiv=\"refresh\"", "object"]);
  const html = writePage(document);
  assert.match(html, /^<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="mercbot-page" content="key-1">/u);
  assert.match(html, /<meta name="viewport"/u);
  assert.doesNotMatch(html, /<iframe|<object|<embed|<base|http-equiv|prefetch|ping=/u);
  assert.equal(pageKeyOf(readPage(html)), "key-1");
  assert.deepEqual(describePage(readPage(html)), { title: "Party", summary: "Saturday at eight." });
  // Saved again, the page keeps one key and one character set.
  const again = readPage(html);
  prepareForSave(again, { title: "Party", key: "key-1" });
  assert.equal(writePage(again).match(/mercbot-page/gu).length, 1);
  assert.equal(writePage(again).match(/charset/gu).length, 1);
});

test("ticks are saved into the file, by each checklist item's place", () => {
  const document = readPage("<ul class='checklist'><li>Raincoat</li><li data-done>Snacks</li></ul><ul><li>Not a checklist</li></ul><ul class='checklist'><li>Map</li></ul>");
  assert.equal(setTicks(document, [{ tick: 0, done: true }, { tick: 1, done: false }, { tick: 2, done: true }, { tick: 9, done: true }]), 3);
  const html = writePage(document);
  assert.match(html, /<li data-done="">Raincoat<\/li><li>Snacks<\/li>/u);
  assert.match(html, /<li data-done="">Map<\/li>/u);
  assert.match(html, /<li>Not a checklist<\/li>/u);
  assert.equal(setTicks(document, [{ tick: 0, done: true }]), 0, "a tick already there changes nothing");
});

test("a page without its scripts keeps its text and loses every way to run one", () => {
  const document = readPage(
    "<p onclick='steal()'>Hello</p><script>steal()</script><a href='java\tscript:steal()' target='_top'>A</a>" +
    "<a href=' JAVASCRIPT:steal()'>B</a><a href='https://ok.example'>C</a><img src='x.files/a.png' onerror='steal()'>" +
    "<form action='javascript:steal()'><button formaction='vbscript:x'>Go</button></form><svg><a xlink:href='javascript:x'>S</a></svg>" +
    "<iframe srcdoc='<script>x</script>'></iframe><template><script>later()</script></template><object data='data:text/html,<script>x</script>'></object>"
  );
  withoutForbidden(document);
  withoutScripts(document);
  const html = writePage(document);
  assert.doesNotMatch(html, /script|onclick|onerror|target=|vbscript|steal/iu);
  assert.match(html, /<p>Hello<\/p>/u);
  assert.match(html, /<a href="https:\/\/ok.example">C<\/a>/u);
});

test("the shell goes first, after the character set, and numbers what the helper needs", () => {
  const document = readPage("<meta charset='utf-8'><title>T</title><ul class='checklist'><li>A</li><li>B</li></ul><a class='card' href='https://www.museum.example/visit'>Museum</a>");
  withShell(document, { css: "body{}", helper: "/* helper */" });
  withStandalonePolicy(document);
  const html = writePage(document);
  assert.match(html, /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'[^"]*connect-src 'none'[^"]*"><style id="mercbot-shell">body\{\}<\/style><script>\/\* helper \*\/<\/script><title>/u);
  assert.match(html, /<li data-tick="0">A<\/li><li data-tick="1">B<\/li>/u);
  assert.match(html, /data-domain="museum.example"/u);
});

test("a page's headers seal it: its own files only, no requests, forms, frames or workers, no referrer", () => {
  const framed = pageHeaders({ scripts: true });
  const policy = framed["content-security-policy"];
  for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "child-src 'none'", "worker-src 'none'",
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", "sandbox allow-scripts", "script-src 'self' 'unsafe-inline' 'unsafe-eval'"]) {
    assert.ok(policy.split("; ").includes(directive), directive);
  }
  assert.doesNotMatch(policy, /allow-same-origin|allow-forms|allow-popups|allow-top-navigation|https?:/u);
  assert.equal(framed["referrer-policy"], "no-referrer");
  assert.match(framed["permissions-policy"], /camera=\(\).*geolocation=\(\).*microphone=\(\)/u);
  assert.equal(framed["x-content-type-options"], "nosniff");
  const alone = pageHeaders({ scripts: false })["content-security-policy"].split("; ");
  assert.ok(alone.includes("script-src 'none'") && alone.includes("sandbox") && alone.includes("frame-ancestors 'none'"));
});

test("a page's address reaches only its own document and the files in its folder", () => {
  const page = "/files/bot/Pages/party.html";
  assert.deepEqual(partOf(page, "party.html"), { document: true });
  assert.deepEqual(partOf(page, "party.files/abc-cake.png"), { file: "/files/bot/Pages/party.files/abc-cake.png", ext: "png" });
  for (const bad of ["other.html", "party.files/../other.html", "party.files/%2e%2e/secret.png", "party.files/x.html", "party.files/x.pdf", "party.files//x.png",
    "../party.html", "party.files/", "%E0%A4%A"]) {
    assert.equal(partOf(page, bad), null, bad);
  }
});

/** A local web server answering each path from `answers`: [status, type, body]. */
async function webServer(context, answers) {
  const server = http.createServer((request, response) => {
    const [status, type, body, headers = {}] = answers[request.url] || [404, "text/plain", "missing"];
    response.writeHead(status, { ...(type ? { "content-type": type } : {}), ...headers });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function pageStore(context) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-pages-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  return { store, place: { homeId: "1", botId: "2", userId: "3" } };
}

test("saving copies what a page loads from outside into its folder, and takes out what it can't", async (context) => {
  const site = await webServer(context, {
    "/cake.png": [200, "image/png", "PNG-BYTES"],
    "/look.css": [200, "text/css", "body { background: url('paper.png'); } @import url('more.css'); h1 { font-family: x; src: url(/font.woff2); }"],
    "/paper.png": [200, "image/png", "PAPER"],
    "/font.woff2": [200, "font/woff2", "FONT"],
    "/chart.js": [200, "application/javascript", "window.chart = 1;"],
    "/page.html": [200, "text/html", "<p>not a picture</p>"],
    "/moved.png": [302, null, "", { location: "/cake.png" }]
  });
  const { store, place } = await pageStore(context);
  const uploads = await store.resolve(place, "/files/mine/Pictures");
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, "invite.png"), "INVITE");
  const files = createPageFiles({ store, insecure: true });
  const document = readPage(
    `<img src="${site}/cake.png"><img src="${site}/moved.png"><img src="/files/mine/Pictures/invite.png"><link rel="stylesheet" href="${site}/look.css">` +
    `<script src="${site}/chart.js"></script><img src="${site}/page.html"><img src="${site}/gone.png"><img src="ftp://files.example/x.png">` +
    `<img src="/files/mine/secret.pdf"><img srcset="${site}/cake.png 1x, ${site}/gone.png 2x"><div style="background:url(${site}/paper.png)">x</div>`
  );
  const { copied, removed } = await files.bringIn(document, { place, pagePath: "/files/bot/Pages/party.html" });
  const html = writePage(document);
  assert.equal(copied, 6, "cake, moved, the chat's picture, the style sheet, the library and the paper");
  assert.deepEqual(removed.map((entry) => entry.address).sort(), ["/files/mine/secret.pdf", `${site}/gone.png`, `${site}/page.html`, "ftp://files.example/x.png", "more.css"].sort());
  assert.match(removed.find((entry) => entry.address === `${site}/page.html`).why, /can't hold text\/html/u);
  assert.match(removed.find((entry) => entry.address === `${site}/gone.png`).why, /answered 404/u);
  assert.doesNotMatch(html, /127\.0\.0\.1|ftp:|secret/u, "nothing outside is named any more");
  assert.match(html, /<img src="party.files\/[0-9a-f]{12}-cake.png">/u);
  assert.match(html, /srcset="party.files\/[0-9a-f]{12}-cake.png 1x"/u);
  assert.match(html, /<script src="party.files\/[0-9a-f]{12}-chart.js"><\/script>/u);
  const kept = await readdir(await store.resolve(place, "/files/bot/Pages/party.files"));
  assert.ok(kept.some((name) => name.endsWith("-invite.png")) && kept.some((name) => name.endsWith("-font.woff2")), kept.join(", "));
});

test("saving never fetches from a private address, by name or by number", async (context) => {
  const site = await webServer(context, { "/cake.png": [200, "image/png", "PNG"] });
  const { store, place } = await pageStore(context);
  const files = createPageFiles({ store });
  const port = new URL(site).port;
  const document = readPage(`<img src="${site}/cake.png"><img src="http://localhost:${port}/cake.png"><img src="http://[::1]:${port}/cake.png">` +
    `<img src="http://[::ffff:127.0.0.1]:${port}/cake.png"><img src="http://10.0.0.1/cake.png">`);
  const { copied, removed } = await files.bringIn(document, { place, pagePath: "/files/bot/Pages/party.html" });
  assert.equal(copied, 0);
  assert.equal(removed.length, 5);
  for (const entry of removed) assert.match(entry.why, /private|refused|not allowed|address/iu, `${entry.address}: ${entry.why}`);
  assert.doesNotMatch(writePage(document), /<img/u);
});

test("a site that sends slowly is given up on in time, however steadily it trickles", async (context) => {
  // One byte every 50 ms: never idle long enough for an idle timeout, so only a deadline stops it.
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    const drip = setInterval(() => response.write("x"), 50);
    response.on("close", () => clearInterval(drip));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const began = Date.now();
  const error = await fetchOutside(`http://127.0.0.1:${server.address().port}/slow.png`, { insecure: true, maxBytes: 1024 * 1024, until: Date.now() + 400 })
    .then(() => null, (caught) => caught);
  assert.match(String(error?.message), /didn't arrive within/u);
  assert.ok(Date.now() - began < 2000, `gave up after ${Date.now() - began} ms`);
});

test("a site's redirects are checked as its first address is: at most three, and only to web addresses", async (context) => {
  const server = http.createServer((request, response) => {
    const hop = /^\/hop\/(\d+)$/u.exec(request.url);
    if (hop && Number(hop[1]) < 4) response.writeHead(302, { location: `/hop/${Number(hop[1]) + 1}` }).end();
    else if (request.url === "/to-file") response.writeHead(302, { location: "file:///etc/passwd" }).end();
    else response.writeHead(200, { "content-type": "image/png" }).end("png");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const fetched = (address) => fetchOutside(`http://127.0.0.1:${server.address().port}${address}`, { insecure: true, maxBytes: 1024, until: Date.now() + 5000 })
    .then((answer) => answer.data.toString(), (caught) => caught.message);
  assert.equal(await fetched("/hop/1"), "png", "three redirects are followed");
  assert.match(await fetched("/hop/0"), /redirects too many times/u);
  assert.match(await fetched("/to-file"), /isn't a web address/u);
});

test("the request log names a page's address without its token", () => {
  const { req } = buildLoggerOptions().serializers;
  const logged = (url) => req({ method: "GET", url, headers: {}, host: "mercbot.test", ip: "10.0.0.1", socket: { remotePort: 4000 } });
  const frame = `${Buffer.from(JSON.stringify({ h: "1", b: "2", p: "/files/bot/Pages/party.html", x: 1 })).toString("base64url")}.${"S".repeat(43)}`;
  assert.deepEqual(logged(`/api/pages/${frame}/party.html`), {
    method: "GET", url: "/api/pages/…/party.html", version: undefined, host: "mercbot.test", remoteAddress: "10.0.0.1", remotePort: 4000
  });
  assert.equal(logged(`/api/pages/${frame}/party.files/a.png?x=1`).url, "/api/pages/…/party.files/a.png?x=1");
  assert.equal(logged(`/api/w/home/bots/2/pages/${"T".repeat(43)}/party.html`).url, "/api/w/home/bots/2/pages/…/party.html", "a token under any pages folder");
  for (const kept of ["/api/w/home/bots/2/pages/frame?path=x", "/api/w/home/bots/2/pages/versions?path=x", "/api/files/pages-and-more", `/pages/${frame}/party.html`]) {
    assert.equal(logged(kept).url, kept, "other addresses are logged as they are");
  }
});

test("a page the bot moves with move_file takes its versions along", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-move-"));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const place = { homeId: "1", botId: "2", userId: "3" };
  const real = await store.resolve(place, "/files/bot/Pages/party.html");
  await mkdir(path.dirname(real), { recursive: true });
  await writeFile(real, "<h1>Party</h1>");
  const changes = [];
  const files = { store, apps: { session: () => ({ close() {} }) }, pages: { pathChanged: async (change) => changes.push(change) } };
  const run = buildTools(turnDoubles({ approvals: { decide: async () => "allow" }, computer: null, files, place, homeId: "1", userId: "3", botId: "2", conversationId: "4" }));
  assert.equal((await run.tools.moveFile.execute({ from: "/files/bot/Pages/party.html", to: "/files/bot/Pages/fiesta.html" })).status, "moved");
  assert.deepEqual(changes, [{ homeId: "1", botId: "2", from: "/files/bot/Pages/party.html", to: "/files/bot/Pages/fiesta.html" }]);
  await rm(dir, { recursive: true, force: true });
});
