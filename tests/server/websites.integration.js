import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { startFakeS3 } from "../support/fakeS3.mjs";
import { serveFolder } from "../support/staticSite.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seal, vaultKey } from "../../packages/account/src/server/vaultCrypto.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createPages } from "../../packages/files/src/server/pages.js";
import { WEBSITES_OWNS } from "../../packages/websites/src/server/WebsitesFeature.js";
import { createWebsites } from "../../packages/websites/src/server/websites.js";

// A home's own website (D-84) against the disposable test database: set up as a folder a local web server serves and
// as a stand-in for S3-compatible storage; a page published, published again (its old files gone), unpublished, moved
// and deleted with its copy following; the address read back, and a wrong one said so; nothing Mercbot didn't put
// there replaced; another home sees and reaches none of it; and the storage's keys never in an answer, the database or
// a log line.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const SECRET = `secret-${randomBytes(12).toString("hex")}`;
const KEY_ID = `AKIA${randomBytes(6).toString("hex").toUpperCase()}`;

async function homeWithBot(knex, userId, name) {
  const [home] = await knex("workspaces").insert({ slug: `${name}-${Date.now().toString(36)}`, name, owner_user_id: userId, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: homeId, name: "Paige", color: "#1E86FC" }).returning("id");
  return { homeId, botId: String(bot.id ?? bot) };
}

const refused = async (work) => work().then(() => null, (error) => ({ status: error.statusCode, code: error.code, message: error.message }));

/** Everything the test needs: two homes with a bot each, their pages, the websites, and a folder for a site. */
async function started(context, name) {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mercbot-${name}-`));
  const userId = String((await knex("users").first())?.id);
  const home = await homeWithBot(knex, userId, name);
  const other = await homeWithBot(knex, userId, `${name}-elsewhere`);
  context.after(async () => {
    await knex("workspaces").whereIn("id", [home.homeId, other.homeId]).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const store = createFileStore({ root: "", fallback: path.join(dir, "files"), ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const { features } = await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS, "mercbot.websites": WEBSITES_OWNS });
  const pages = createPages({ store, ...features["mercbot.files"], env: {} });
  const env = { MERCBOT_VAULT_KEY: randomBytes(32).toString("base64") };
  // The person runs this copy, so may choose a folder on its computer (websites.test.js has the refusal), and storage
  // and addresses on its own network; `theirs` is the same home's websites for someone who doesn't run the copy.
  const websites = createWebsites({ ...features["mercbot.websites"], env, pages, runsThisCopy: async () => true });
  const theirs = createWebsites({ ...features["mercbot.websites"], env, pages, runsThisCopy: async () => false });
  // As the websites feature starts: its pages follow their files.
  pages.follow(websites.pageChanged);
  const { systemContext } = features["mercbot.websites"];
  const inHome = (id) => ({ context: systemContext("the websites test, as a person in the home").forWorkspace(String(id)) });
  /** Writes a page and the files of its folder, as a bot's save leaves them. */
  async function writePage(pagePath, html, files = {}) {
    const real = await store.resolve({ ...home, everyone: true }, pagePath);
    await fs.mkdir(path.join(path.dirname(real), path.basename(pagePath, ".html") + ".files"), { recursive: true });
    await fs.writeFile(real, html);
    for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(path.dirname(real), file), content);
  }
  return { knex, dir, env, home, other, pages, websites, theirs, options: inHome(home.homeId), otherOptions: inHome(other.homeId), writePage };
}

test("a folder website: a page published, published again, followed as it moves and goes, and unpublished", async (context) => {
  const { dir, home, other, pages, websites, options, otherOptions, writePage } = await started(context, "site-folder");
  const siteDir = path.join(dir, "www");
  await fs.mkdir(siteDir);
  const web = await serveFolder(siteDir, { at: "/site/" });
  context.after(web.close);
  const page = { ...home, path: "/files/bot/Pages/party.html" };
  await writePage(page.path, "<title>Party</title><h1>Party</h1><p>Saturday at eight.</p><img src='party.files/cake.png'><script>steal()</script>",
    { "party.files/cake.png": "CAKE" });

  assert.deepEqual(await websites.describe(options), { website: null });
  assert.deepEqual(await refused(() => websites.publish({ ...page, confirmed: true }, options)),
    { status: 409, code: "websites_not_set_up", message: "Set up your website first, in Settings → Website." });
  assert.deepEqual((await refused(() => websites.save({ kind: "folder", folder: path.join(dir, "nowhere"), baseUrl: web.url }, options))).code,
    "websites_folder_missing", "a folder that isn't there is refused before anything is saved");
  assert.deepEqual(await websites.describe(options), { website: null });

  const saved = await websites.save({ kind: "folder", folder: siteDir, baseUrl: web.url.replace(/\/$/u, "") }, options);
  assert.deepEqual(saved, { website: { kind: "folder", baseUrl: web.url, folder: siteDir, confirmed: false, hasPages: false } });
  assert.equal((await refused(() => websites.publish(page, options))).code, "websites_confirm_first", "the first publish asks first");
  assert.equal((await fs.readdir(siteDir)).length, 0);

  // Published: the page's copy at <base URL>/party/, read back at its address.
  const first = await websites.publish({ ...page, confirmed: true }, options);
  assert.equal(first.publication.url, `${web.url}party/`);
  assert.deepEqual(first.check, { ok: true });
  assert.deepEqual((await fs.readdir(path.join(siteDir, "party"))).sort(), [".mercbot-page.json", "index.html", "party.files"]);
  assert.equal(await fs.readFile(path.join(siteDir, "party", "party.files", "cake.png"), "utf8"), "CAKE");
  const index = await fs.readFile(path.join(siteDir, "party", "index.html"), "utf8");
  assert.match(index, /<h1>Party<\/h1><p>Saturday at eight\.<\/p><img src="party\.files\/cake\.png">/u);
  assert.doesNotMatch(index, /<script/u);
  assert.equal(await (await fetch(first.publication.url)).text(), index, "the web server answers with it");
  assert.deepEqual(await websites.state(page, options), { website: { baseUrl: web.url }, publication: first.publication, confirmFirst: false });
  assert.equal((await websites.describe(options)).website.confirmed, true);

  // Published again: it replaces the copy, and the files it no longer loads are gone.
  await writePage(page.path, "<title>Party</title><h1>Party</h1><p>Saturday at nine.</p>");
  const second = await websites.publish(page, options);
  assert.deepEqual([second.publication.url, second.check], [first.publication.url, { ok: true }]);
  assert.deepEqual((await fs.readdir(path.join(siteDir, "party"))).sort(), [".mercbot-page.json", "index.html"]);
  assert.match(await fs.readFile(path.join(siteDir, "party", "index.html"), "utf8"), /Saturday at nine\./u);

  // Another home sees none of it and reaches none of it.
  assert.deepEqual(await websites.state({ ...other, path: page.path }, otherOptions), { website: null, publication: null, confirmFirst: true });
  assert.deepEqual(await websites.state(page, otherOptions), { website: null, publication: null, confirmFirst: true }, "not even by this home's bot");
  await websites.unpublish(page, otherOptions);
  assert.ok((await fs.readdir(siteDir)).includes("party"), "another home's unpublish took nothing away");

  // A folder Mercbot didn't put there is never replaced, and the page keeps no place it never got.
  const fiesta = { ...home, path: "/files/bot/Pages/fiesta.html" };
  await writePage(fiesta.path, "<h1>Fiesta</h1>");
  await fs.mkdir(path.join(siteDir, "fiesta"));
  await fs.writeFile(path.join(siteDir, "fiesta", "index.html"), "MINE");
  assert.deepEqual(await refused(() => websites.publish(fiesta, options)), {
    status: 409, code: "websites_place_taken", message: `Something Mercbot didn't put there is at ${web.url}fiesta/ already. Move it away, or rename the page.`
  });
  assert.equal(await fs.readFile(path.join(siteDir, "fiesta", "index.html"), "utf8"), "MINE");
  assert.equal((await websites.state(fiesta, options)).publication, null);

  // A wrong address is said plainly: the page is uploaded, but nothing of it answers there.
  const wrongUrl = web.url.replace("/site/", "/elsewhere/");
  assert.equal((await websites.save({ kind: "folder", folder: siteDir, baseUrl: wrongUrl }, options)).website.confirmed, false, "a new address asks again");
  const wrong = await websites.publish({ ...page, confirmed: true }, options);
  assert.equal(wrong.publication.url, `${wrongUrl}party/`);
  assert.deepEqual([wrong.check.ok, wrong.check.code, wrong.check.status], [false, "websites_check_status", 404]);
  assert.match(wrong.check.message, /answered 404 \(not found\)\. Check that the website's address/u);
  assert.equal((await websites.save({ kind: "folder", folder: siteDir, baseUrl: web.url }, options)).website.confirmed, false, "and so does going back");

  // Its place doesn't change while pages are on it, and the website isn't removed under them.
  const elsewhere = path.join(dir, "www2");
  await fs.mkdir(elsewhere);
  assert.equal((await refused(() => websites.save({ kind: "folder", folder: elsewhere, baseUrl: web.url }, options))).code, "websites_pages_published");
  assert.equal((await refused(() => websites.remove(home.homeId, options))).code, "websites_pages_published");

  // The page moves: its publication goes with it, at the same address. It goes: its copy leaves the website.
  const moved = "/files/bot/Pages/party-time.html";
  await pages.pathChanged({ homeId: home.homeId, botId: home.botId, from: page.path, to: moved });
  assert.equal((await websites.state({ ...home, path: moved }, options)).publication.url, `${web.url}party/`);
  assert.equal((await websites.state(page, options)).publication, null);
  await pages.pathChanged({ homeId: home.homeId, botId: home.botId, from: moved, to: null });
  assert.deepEqual((await fs.readdir(siteDir)).sort(), ["fiesta"], "the deleted page's copy is gone, the person's own folder stays");
  assert.equal((await websites.state({ ...home, path: moved }, options)).publication, null);

  // Unpublished: its folder is gone; then the website can be removed.
  await websites.publish({ ...page, confirmed: true }, options);
  assert.ok((await fs.readdir(siteDir)).includes("party"));
  assert.deepEqual(await websites.unpublish(page, options), { website: { baseUrl: web.url }, publication: null, confirmFirst: false });
  assert.deepEqual((await fs.readdir(siteDir)).sort(), ["fiesta"]);
  assert.deepEqual(await websites.remove(home.homeId, options), { website: null });
  assert.deepEqual(await websites.describe(options), { website: null });
});

test("an S3 website: published to a bucket, published again, unpublished; its keys are never shown, stored open or logged", async (context) => {
  const { knex, home, websites, options, writePage } = await started(context, "site-s3");
  const s3 = await startFakeS3(context, { bucket: "pages", accessKeyId: KEY_ID });
  const logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level];
    console[level] = (...args) => {
      logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      return original.apply(console, args);
    };
    context.after(() => (console[level] = original));
  }
  const answers = [];
  const answered = async (work) => {
    const answer = await work();
    answers.push(answer);
    return answer;
  };
  const baseUrl = `${s3.endpoint}/website/site/`;
  const website = { kind: "s3", endpoint: s3.endpoint, region: "us-east-1", bucket: "pages", prefix: "site", baseUrl };
  const page = { ...home, path: "/files/bot/Pages/party.html" };
  await writePage(page.path, "<h1>Party</h1><img src='party.files/cake.png'>", { "party.files/cake.png": "CAKE" });

  const rejected = await refused(() => websites.save({ ...website, accessKeyId: "AKIAWRONG", secretAccessKey: SECRET }, options));
  assert.equal(rejected.code, "websites_storage_keys_rejected", "keys the storage refuses are refused before anything is saved");
  assert.equal((await refused(() => websites.save({ ...website, bucket: "other", accessKeyId: KEY_ID, secretAccessKey: SECRET }, options))).code,
    "websites_storage_bucket_missing");
  answers.push(rejected);

  const saved = await answered(() => websites.save({ ...website, accessKeyId: KEY_ID, secretAccessKey: SECRET }, options));
  assert.deepEqual(saved, { website: { kind: "s3", baseUrl, endpoint: s3.endpoint, region: "us-east-1", bucket: "pages", prefix: "site", hasKeys: true, confirmed: false, hasPages: false } });
  const row = await knex("home_websites").where({ workspace_id: home.homeId }).first();
  assert.deepEqual(Object.keys(row.settings).sort(), ["data", "iv", "tag", "v"], "what it uploads to is sealed");
  // Saved again with the keys left empty, the saved ones stay.
  await answered(() => websites.save({ ...website, accessKeyId: "", secretAccessKey: "" }, options));

  const first = await answered(() => websites.publish({ ...page, confirmed: true }, options));
  assert.deepEqual([first.publication.url, first.check], [`${baseUrl}party/`, { ok: true }]);
  assert.deepEqual([...s3.objects.keys()].sort(), ["site/party/.mercbot-page.json", "site/party/index.html", "site/party/party.files/cake.png"]);
  assert.deepEqual([s3.objects.get("site/party/index.html").type, String(s3.objects.get("site/party/party.files/cake.png").body)], ["text/html; charset=utf-8", "CAKE"]);

  await writePage(page.path, "<h1>Party</h1><p>Without the cake.</p>");
  const second = await answered(() => websites.publish(page, options));
  assert.deepEqual(second.check, { ok: true });
  assert.deepEqual([...s3.objects.keys()].sort(), ["site/party/.mercbot-page.json", "site/party/index.html"], "published again, the old files are gone");
  assert.match(String(s3.objects.get("site/party/index.html").body), /Without the cake\./u);
  await answered(() => websites.state(page, options));
  await answered(() => websites.describe(options));

  await answered(() => websites.unpublish(page, options));
  assert.deepEqual([...s3.objects.keys()], [], "unpublished, nothing of it is left in the bucket");

  for (const answer of answers) assert.doesNotMatch(JSON.stringify(answer), new RegExp(`${SECRET}|${KEY_ID}`, "u"));
  assert.doesNotMatch(JSON.stringify(await knex("home_websites").where({ workspace_id: home.homeId })), new RegExp(`${SECRET}|${KEY_ID}`, "u"));
  assert.doesNotMatch(logged.join("\n"), new RegExp(`${SECRET}|${KEY_ID}`, "u"));
});

// A website set up by someone who doesn't run the copy is a bucket and an address on the internet: its storage is
// reached, and its pages read back, only at public internet addresses (@local/account/public-address), so it can't be
// pointed at the private network the copy runs in. Someone who runs the copy may use both, as before.
test("a website set up by someone who doesn't run the copy reaches its storage and reads pages back only on the internet", async (context) => {
  const { knex, dir, env, home, websites, theirs, options, writePage } = await started(context, "site-guarded");
  const s3 = await startFakeS3(context, { bucket: "pages", accessKeyId: KEY_ID });
  const port = new URL(s3.endpoint).port;
  const storage = { kind: "s3", region: "us-east-1", bucket: "pages", prefix: "", accessKeyId: KEY_ID, secretAccessKey: SECRET };
  // An address on the internet, never reached here: the storage is refused before it is read.
  const publicBase = "https://203.0.113.10/pages/";
  const status = (answer) => answer && [answer.status, answer.code];

  // Storage on a private network, written as an address or found by name, is refused before anything reaches it.
  for (const endpoint of [s3.endpoint, "http://10.20.30.40:9000", "http://169.254.169.254", `http://[::1]:${port}`, `http://localhost:${port}`]) {
    const answer = await refused(() => theirs.save({ ...storage, endpoint, baseUrl: publicBase }, options));
    assert.deepEqual(status(answer), [403, "websites_storage_private"], endpoint);
    assert.match(answer.message, /is on a private network\. Only the people who run this copy of Mercbot can publish to storage there/u);
  }
  // So is an address on one, before the storage (a name that never resolves) is asked.
  for (const baseUrl of ["http://127.0.0.1:8080/pages/", "http://10.0.0.5/", "http://169.254.169.254/latest/", "http://[::1]/", "http://localhost/pages/"]) {
    const answer = await refused(() => theirs.save({ ...storage, endpoint: "https://s3.example.invalid", baseUrl }, options));
    assert.deepEqual(status(answer), [403, "websites_address_private"], baseUrl);
    assert.match(answer.message, /is on a private network\. Only the people who run this copy of Mercbot can give the website an address there/u);
  }
  assert.equal(s3.requests.length, 0, "the storage on this machine was never reached");
  assert.deepEqual(await theirs.describe(options), { website: null }, "nothing was saved");

  // Someone who runs the copy uses both, as before.
  await websites.save({ ...storage, endpoint: s3.endpoint, baseUrl: `${s3.endpoint}/website/` }, options);
  assert.ok(s3.requests.length > 0, "their storage on this machine is reached");
  const page = { ...home, path: "/files/bot/Pages/party.html" };
  await writePage(page.path, "<h1>Party</h1>");
  assert.deepEqual((await websites.publish({ ...page, confirmed: true }, options)).check, { ok: true }, "and their address on it read back");
  await websites.unpublish(page, options);
  // Saved again by someone who doesn't, the website is theirs: the same storage is refused.
  const again = await refused(() => theirs.save({ ...storage, endpoint: s3.endpoint, accessKeyId: "", secretAccessKey: "", baseUrl: publicBase }, options));
  assert.deepEqual(status(again), [403, "websites_storage_private"]);

  // A website whose settings don't say who set it up counts as set up by someone who doesn't run the copy: a folder one
  // (as the first version saved it) still takes its upload, but its address on this machine is never read back.
  const siteDir = path.join(dir, "www");
  await fs.mkdir(siteDir);
  const web = await serveFolder(siteDir, { at: "/site/" });
  context.after(web.close);
  await knex("home_websites").where({ workspace_id: home.homeId })
    .update({ kind: "folder", base_url: web.url, settings: JSON.stringify(seal({ folder: siteDir }, vaultKey(env))), confirmed_at: new Date().toISOString() });
  const published = await websites.publish(page, options);
  assert.equal(published.check.code, "websites_check_private");
  assert.ok((await fs.readdir(siteDir)).includes("party"), "the copy went up");
});
