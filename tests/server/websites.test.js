import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publicFetch } from "../../packages/account/src/server/publicAddress.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { createPages } from "../../packages/files/src/server/pages.js";
import { checkAnswer } from "../../packages/websites/src/server/answerCheck.js";
import { createFolderSite } from "../../packages/websites/src/server/folderSite.js";
import { markerFile } from "../../packages/websites/src/server/marker.js";
import { registerWebsiteRoutes } from "../../packages/websites/src/server/websiteRoutes.js";
import { __testables, createWebsites } from "../../packages/websites/src/server/websites.js";
import { buildLoggerOptions } from "../../server/lib/loggerOptions.js";

const { baseUrlOf, placeFrom, slugOf } = __testables;

// A home's own website (D-84), without a database: the copy a page is published as, a folder website's files, the
// answer check against a local web server, what the person enters, and the routes' refusals.

async function folder(context, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function pagesIn(context) {
  const dir = await folder(context, "mb-site-pages-");
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const pages = createPages({ store, resources: { pageVersions: {} }, systemContext: () => ({}), env: {} });
  const page = { homeId: "1", botId: "2", path: "/files/bot/Pages/party.html" };
  const real = await store.resolve({ ...page, everyone: true }, page.path);
  const files = path.join(path.dirname(real), "party.files");
  await mkdir(files, { recursive: true });
  return { pages, page, real, files };
}

test("a published page is what its link shows, with the files of its folder it loads beside it", async (context) => {
  const { pages, page, real, files } = await pagesIn(context);
  await writeFile(real,
    "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='mercbot-page' content='key-1'><title>Party</title>" +
    "<link rel='stylesheet' href='party.files/look.css'><script src='party.files/app.js'></script></head>" +
    "<body><h1 onclick='steal()'>Party</h1><img src='party.files/cake.png'><img src='party.files/logo.svg'>" +
    "<img src='party.files/missing.png'><img src='https://elsewhere.example/x.png'><a href='javascript:steal()'>A</a>" +
    "<script>steal()</script><iframe src='https://elsewhere.example'></iframe><ul class='checklist'><li>Cake</li></ul></body></html>");
  await writeFile(path.join(files, "cake.png"), "CAKE");
  await writeFile(path.join(files, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>steal()</script></svg>");
  await writeFile(path.join(files, "look.css"), "body { background: url('paper.png'); } h1 { background: url(icon.svg); }");
  await writeFile(path.join(files, "paper.png"), "PAPER");
  await writeFile(path.join(files, "icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(path.join(files, "app.js"), "steal()");
  await writeFile(path.join(files, "unused.png"), "UNUSED");

  const copy = await pages.published(page, { stamp: "stamp-1" });
  assert.equal(copy.title, "Party");
  assert.deepEqual(copy.files.map((file) => [file.path, file.type]).sort(), [
    ["party.files/cake.png", "image/png"],
    ["party.files/look.css", "text/css; charset=utf-8"],
    ["party.files/paper.png", "image/png"]
  ], "only the files it loads; no script, and SVG pictures go inside it");
  assert.equal(copy.files.find((file) => file.path === "party.files/cake.png").content.toString(), "CAKE");
  const css = copy.files.find((file) => file.path === "party.files/look.css").content.toString();
  assert.match(css, /url\('paper\.png'\)/u, "a style sheet's own picture stays beside it");
  assert.match(css, /url\("data:image\/svg\+xml;base64,/u, "a style sheet's SVG goes inside it");

  const html = copy.html;
  assert.match(html, /^<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*script-src 'none';[^"]*">/u);
  assert.match(html, /<meta name="referrer" content="no-referrer"><meta name="mercbot-published" content="stamp-1"><style id="mercbot-shell">/u);
  assert.doesNotMatch(html, /<script|onclick|javascript:|<iframe|mercbot-page"|key-1/u, "no scripts, no frames, and not the page's key");
  assert.match(html, /<img src="party\.files\/cake\.png">/u);
  assert.match(html, /<img src="data:image\/svg\+xml;base64,[^"]+">/u);
  assert.match(html, /<img src="https:\/\/elsewhere\.example\/x\.png">/u, "an address from outside stays, and the copy's own policy blocks it");
  assert.match(html, /<li data-tick="0">Cake<\/li>/u, "Mercbot's look, as its link shows it");
});

test("a published page carries at most what a save copies in", async (context) => {
  const { pages, page, real, files } = await pagesIn(context);
  const pictures = Array.from({ length: 61 }, (_, index) => `p${index}.png`);
  await Promise.all(pictures.map((name) => writeFile(path.join(files, name), "P")));
  await writeFile(real, `<h1>Many</h1>${pictures.map((name) => `<img src="party.files/${name}">`).join("")}`);
  const error = await pages.published(page, { stamp: "s" }).then(() => null, (caught) => caught);
  assert.deepEqual([error?.statusCode, error?.code], [413, "files_page_too_big"]);
  await writeFile(real, `<h1>Fewer</h1>${pictures.slice(1).map((name) => `<img src="party.files/${name}">`).join("")}`);
  assert.equal((await pages.published(page, { stamp: "s" })).files.length, 60);
});

test("a folder website puts exactly the page's files at its own folder, replaces them, and takes them away", async (context) => {
  const site = await folder(context, "mb-site-folder-");
  const websiteSite = createFolderSite(site);
  await websiteSite.check();
  assert.deepEqual(await websiteSite.read("party"), { exists: false, marker: null });
  const index = (text) => ({ path: "index.html", type: "text/html", content: Buffer.from(text) });
  await websiteSite.put("party", [markerFile("m-1"), { path: "party.files/cake.png", type: "image/png", content: Buffer.from("CAKE") }, index("first")]);
  assert.deepEqual((await readdir(site)).sort(), ["party"], "nothing else is left beside it");
  assert.deepEqual((await readdir(path.join(site, "party"))).sort(), [".mercbot-page.json", "index.html", "party.files"]);
  assert.equal(await readFile(path.join(site, "party", "party.files", "cake.png"), "utf8"), "CAKE");
  assert.deepEqual(await websiteSite.read("party"), { exists: true, marker: "m-1" });

  await websiteSite.put("party", [markerFile("m-1"), index("second")]);
  assert.deepEqual((await readdir(path.join(site, "party"))).sort(), [".mercbot-page.json", "index.html"], "published again, the old files are gone");
  assert.equal(await readFile(path.join(site, "party", "index.html"), "utf8"), "second");
  assert.deepEqual((await readdir(site)).sort(), ["party"]);

  await mkdir(path.join(site, "mine"));
  assert.deepEqual(await websiteSite.read("mine"), { exists: true, marker: null }, "a folder Mercbot didn't make has no marker");
  await websiteSite.remove("party");
  assert.deepEqual((await readdir(site)).sort(), ["mine"]);

  const missing = await createFolderSite(path.join(site, "nowhere")).check().then(() => null, (error) => error);
  assert.deepEqual([missing?.statusCode, missing?.code], [409, "websites_folder_missing"]);
});

test("the answer check says plainly when a published page doesn't answer at its address", async (context) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/pages/party/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<meta name="mercbot-published" content="stamp-2"><h1>Party</h1>');
    } else if (request.url === "/old/party/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<meta name="mercbot-published" content="stamp-1"><h1>Party</h1>');
    } else {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const at = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await checkAnswer(`${at}/pages/party/`, "stamp-2"), { ok: true });
  const wrong = await checkAnswer(`${at}/wrong/party/`, "stamp-2");
  assert.deepEqual([wrong.ok, wrong.code, wrong.status], [false, "websites_check_status", 404]);
  assert.match(wrong.message, /^The page was uploaded, but http:\/\/127\.0\.0\.1:\d+\/wrong\/party\/ answered 404 \(not found\)\. Check that the website's address/u);
  const stale = await checkAnswer(`${at}/old/party/`, "stamp-2");
  assert.deepEqual([stale.ok, stale.code], [false, "websites_check_other_page"]);
  const nobody = await checkAnswer("http://127.0.0.1:9/party/", "stamp-2");
  assert.deepEqual([nobody.ok, nobody.code], [false, "websites_check_unreachable"]);
});

// A website not set up by someone who runs the copy is read back only at public internet addresses
// (@local/account/public-address): its address, and each address a redirect leads to, is checked before anything
// connects. A stand-in answers for a website on the internet that redirects; every other address goes to the guard.
test("a website not set up by someone who runs the copy is read back only on the internet, redirects included", async (context) => {
  const asked = [];
  const server = http.createServer((request, response) => {
    asked.push(request.url);
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<meta name="mercbot-published" content="stamp-3"><h1>Party</h1>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const port = server.address().port;
  const here = `http://127.0.0.1:${port}/party/`;
  assert.deepEqual(await checkAnswer(here, "stamp-3"), { ok: true }, "one someone who runs the copy set up is read anywhere, as before");
  asked.length = 0;

  const redirecting = (to) => `https://pages.example.invalid/party/?to=${encodeURIComponent(to)}`;
  const internet = (address, init) => (address.startsWith("https://pages.example.invalid/")
    ? new Response(null, { status: 302, headers: { location: new URL(address).searchParams.get("to") } })
    : publicFetch()(address, init));
  for (const url of [here, `http://localhost:${port}/party/`, "http://10.20.30.40/party/", "http://169.254.169.254/latest/meta-data/",
    `http://[::1]:${port}/party/`, redirecting(here), redirecting(`http://localhost:${port}/party/`), redirecting("http://169.254.169.254/latest/")]) {
    const answer = await checkAnswer(url, "stamp-3", { guarded: true, get: internet, seconds: 2 });
    assert.deepEqual([answer.ok, answer.code], [false, "websites_check_private"], url);
    assert.match(answer.message, /^The page was uploaded, but \S+ leads to a private network address, which Mercbot reads only for a website set up by someone who runs this copy\./u);
  }
  const unaided = await checkAnswer(`http://localhost:${port}/party/`, "stamp-3", { guarded: true });
  assert.equal(unaided.code, "websites_check_private", "guarded, it goes through the guard by itself");
  assert.deepEqual(asked, [], "nothing on this machine was reached");
});

test("what the person enters: the website's address, where it uploads, and keys left empty kept", () => {
  assert.equal(baseUrlOf(" https://example.com/pages?x=1#top "), "https://example.com/pages/");
  for (const bad of ["", "example.com/pages", "ftp://example.com/", "https://me:pw@example.com/"]) {
    assert.throws(() => baseUrlOf(bad), { code: "websites_base_url_invalid" }, bad);
  }
  assert.deepEqual(placeFrom({ kind: "folder", folder: "/var/www/html/pages/" }), { kind: "folder", folder: "/var/www/html/pages" });
  for (const bad of ["pages", "/var/www/../etc", ""]) assert.throws(() => placeFrom({ kind: "folder", folder: bad }), { code: "websites_folder_invalid" }, bad);
  assert.throws(() => placeFrom({ kind: "ftp" }), { code: "websites_kind_unknown" });
  const s3 = { kind: "s3", endpoint: "https://s3.example.com/", bucket: "pages", region: "auto", prefix: "/site/", accessKeyId: "AK", secretAccessKey: "SK" };
  const saved = placeFrom(s3);
  assert.deepEqual(saved, { kind: "s3", endpoint: "https://s3.example.com", region: "auto", bucket: "pages", prefix: "site", accessKeyId: "AK", secretAccessKey: "SK" });
  assert.deepEqual(placeFrom({ ...s3, accessKeyId: "", secretAccessKey: "" }, saved), saved, "empty keys keep the saved ones");
  assert.throws(() => placeFrom({ ...s3, endpoint: "https://other.example.com", accessKeyId: "", secretAccessKey: "" }, saved), { code: "websites_keys_missing" },
    "another storage's keys are never reused");
  assert.throws(() => placeFrom({ ...s3, prefix: "a/../b" }), { code: "websites_prefix_invalid" });
  assert.throws(() => placeFrom({ ...s3, bucket: "a/b" }), { code: "websites_bucket_invalid" });
  assert.deepEqual(["/files/bot/Pages/Crème Brûlée Night.html", "/files/bot/Pages/!!!.html", "/files/shared/Pages/q3-report.html"].map(slugOf),
    ["creme-brulee-night", "page", "q3-report"]);
});

// A page on the home's website reaches outside the home (D-66): only its owners and
// admins set the website up and publish to it; anyone in the home unpublishes. A member is refused before the bot or
// the page is looked at, and a bot the request's home doesn't hold (another home's) is not found. A folder on this
// computer is chosen only by the people who run this copy (D-59; a person's own copy's one person, D-81), before anything
// else about the website is looked at.
test("only the home's owners and admins set up the website and publish to it; anyone unpublishes; a folder is for whoever runs the copy", async () => {
  const routes = new Map();
  const called = [];
  const looked = [];
  let runsIt = false;
  const record = (name) => async (...args) => {
    called.push([name, args[0]]);
    return { website: null };
  };
  registerWebsiteRoutes({ router: { register: (method, route, _options, handler) => routes.set(`${method} ${route}`, handler) } }, {
    websites: { describe: record("describe"), save: record("save"), remove: record("remove"), state: record("state"), publish: record("publish"), unpublish: record("unpublish") },
    pages: { isPagePath: (given) => given.endsWith(".html") },
    directory: {
      findBot: async (botId) => {
        looked.push(botId);
        return botId === "12" ? { id: botId } : null;
      }
    },
    runsThisCopy: async () => runsIt
  });
  const manager = ["workspace.settings.update"];
  async function call(key, { permissions = [], body = {}, query = {}, botId = "12" } = {}) {
    const answer = {};
    const reply = { code: (status) => Object.assign(answer, { status }) && reply, send: (sent) => Object.assign(answer, { body: sent }) && reply };
    const request = { params: { botId }, body, query, permissions, user: { id: "7" }, workspace: { id: "3" }, callOptions: async () => ({}) };
    await routes.get(key)(request, reply);
    return { status: answer.status ?? 200, ...answer.body };
  }
  const SITE = "/api/w/:workspaceSlug/website";
  const PAGE_SITE = "/api/w/:workspaceSlug/bots/:botId/pages/website";
  const page = { path: "/files/bot/Pages/party.html" };

  assert.deepEqual(await call(`PUT ${SITE}`, { body: { kind: "folder", folder: "/srv/www", baseUrl: "https://example.com/" } }), {
    status: 403, error: "Only the home's owners and admins can set up the home's website.", code: "websites_manage_forbidden", params: {}
  });
  assert.equal((await call(`DELETE ${SITE}`)).code, "websites_manage_forbidden");
  for (const body of [{ ...page, confirmed: true }, { path: "not a page" }, {}]) {
    assert.deepEqual(await call(`POST ${PAGE_SITE}`, { body }), {
      status: 403, error: "Only the home's owners and admins can publish pages to the home's website.", code: "websites_manage_forbidden", params: {}
    }, JSON.stringify(body));
  }
  assert.deepEqual([called, looked], [[], []], "refused before the bot, the page or the website is looked at");

  assert.deepEqual(await call(`GET ${SITE}`), { status: 200, website: null, canManage: false, canUseFolder: false }, "a member sees the website");
  assert.deepEqual(await call(`DELETE ${PAGE_SITE}`, { query: page }), { status: 200, website: null, canPublish: false }, "a member unpublishes");
  assert.deepEqual(await call(`GET ${PAGE_SITE}`, { query: page, permissions: manager }), { status: 200, website: null, canPublish: true });
  assert.equal((await call(`POST ${PAGE_SITE}`, { body: { ...page, confirmed: true }, permissions: manager })).status, 200);
  assert.deepEqual(called.slice(-1), [["publish", { homeId: "3", botId: "12", path: page.path, confirmed: true }]], "the home is the request's");
  assert.equal((await call(`PUT ${SITE}`, { body: { kind: "folder" }, permissions: manager })).status, 200);
  runsIt = true;
  assert.deepEqual(await call(`GET ${SITE}`, { permissions: manager }), { status: 200, website: null, canManage: true, canUseFolder: true }, "whoever runs the copy is offered a folder");

  const touched = [];
  const untouchable = new Proxy({}, { get: (_target, name) => () => touched.push(name) });
  const service = (runsThisCopy) => createWebsites({
    resources: { homeWebsites: untouchable, pagePublications: untouchable }, systemContext: () => ({}), env: {}, pages: {}, runsThisCopy
  });
  const folderSite = { kind: "folder", folder: "/srv/www", baseUrl: "https://example.com/" };
  await assert.rejects(service(async () => false).save(folderSite, {}), {
    statusCode: 403, code: "websites_folder_forbidden",
    message: "Only the people who run this copy of Mercbot can publish to a folder on its computer. Choose S3-compatible storage."
  });
  assert.deepEqual(touched, [], "refused before the website is looked at");
  await assert.rejects(service(async () => true).save(folderSite, {}), { code: "websites_vault_key_missing" }, "whoever runs the copy gets past it");

  const elsewhere = await call(`POST ${PAGE_SITE}`, { body: page, permissions: manager, botId: "99" });
  assert.deepEqual([elsewhere.status, elsewhere.code], [404, "websites_bot_not_found"], "another home's bot isn't found in this one");
  const notPage = await call(`GET ${PAGE_SITE}`, { query: { path: "/files/bot/notes.txt" }, permissions: manager });
  assert.deepEqual([notPage.status, notPage.code], [404, "websites_page_not_found"]);

  // The request log never holds what a request sends, so a website's keys never reach it.
  const { req } = buildLoggerOptions().serializers;
  const logged = JSON.stringify(req({ method: "PUT", url: "/api/w/home/website", body: { secretAccessKey: "SECRET-1" }, headers: {}, socket: {} }));
  assert.doesNotMatch(logged, /SECRET-1/u);
});
