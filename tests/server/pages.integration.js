import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { FilesError, createFileStore } from "../../packages/files/src/server/fileStore.js";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { pageKeyOf, readPage } from "../../packages/files/src/server/pageDocument.js";
import { createPages } from "../../packages/files/src/server/pages.js";

// Rich HTML pages (D-74) against the disposable test database: a page saved with what it shows copied
// into its folder, its versions and Restore, ticks saved into the file, the frame's signed address, the
// page opened on its own by its key, a page moved or deleted, a change made with a command, and the
// standalone copy. Every way to reach a page without the right token or key answers the same 404.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

async function homeWithBot(knex, userId, name) {
  const [home] = await knex("workspaces").insert({ slug: `${name}-${Date.now().toString(36)}`, name, owner_user_id: userId, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  const [bot] = await knex("bots").insert({ user_id: userId, workspace_id: homeId, name: "Paige", color: "#1E86FC" }).returning("id");
  return { homeId, botId: String(bot.id ?? bot) };
}

const notFound = async (work, why) => {
  const error = await work().then(() => null, (caught) => caught);
  assert.equal(error?.statusCode, 404, why);
};
const frameToken = (src) => src.split("/")[3];

test("a page is saved, versioned, ticked, framed, opened on its own, moved and restored", async (context) => {
  const knex = await connectTestDatabase();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mercbot-pages-test-"));
  const userId = String((await knex("users").first())?.id);
  const { homeId, botId } = await homeWithBot(knex, userId, "pages");
  const other = await homeWithBot(knex, userId, "elsewhere");
  context.after(async () => {
    await knex("workspaces").whereIn("id", [homeId, other.homeId]).del();
    await knex.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  });
  // While `moving`, the home's files are being moved to other storage (D-80): only reading is let through.
  let moving = false;
  const ownStorage = async (_homeId, { reading }) => {
    if (moving && !reading) throw new FilesError(409, "Moving this home's files.", { code: "files_storage_moving" });
    return null;
  };
  const store = createFileStore({ root: "", fallback: dir, ownStorage, settle: async () => {}, explain: async () => {} });
  const { features } = await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS });
  const { resources, systemContext } = features["mercbot.files"];
  const pages = createPages({ store, resources, systemContext, env: { AUTH_LOCAL_SESSION_SECRET: "pages-test-secret-0123456789abcdef" }, insecure: true });
  const inHome = (id) => ({ context: systemContext("the pages test, as a person in the home").forWorkspace(String(id)) });
  const place = { homeId, botId, userId };
  const page = { homeId, botId, path: "/files/bot/Pages/party.html", userId };

  // The chat's own picture is copied into the page's folder.
  const pictures = await store.resolve(place, "/files/mine/Pictures");
  await fs.mkdir(pictures, { recursive: true });
  await fs.writeFile(path.join(pictures, "invite.png"), "INVITE-PNG");
  const first = await pages.save({
    place,
    title: "Party",
    slug: "party",
    content: "<h1>Party</h1><p>Saturday at eight.</p><img src='/files/mine/Pictures/invite.png' alt='Invite'>" +
      "<ul class='checklist'><li>Cake</li><li>Candles</li></ul><script>document.title = 'ran';</script><iframe src='https://x.example'></iframe>"
  });
  assert.deepEqual({ path: first.path, title: first.title, summary: first.summary, copied: first.copied }, { path: page.path, title: "Party", summary: "Saturday at eight.", copied: 1 });
  assert.deepEqual(first.removed, [{ address: "<iframe>", why: "pages never hold it" }]);
  const real = await store.resolve(place, page.path);
  const saved = await fs.readFile(real, "utf8");
  const key = pageKeyOf(readPage(saved));
  assert.match(key, /^[A-Za-z0-9_-]{16}$/u);
  const picture = /<img src="(party\.files\/[0-9a-f]{12}-invite\.png)"/u.exec(saved)?.[1];
  assert.ok(picture, "the page names its own copy of the picture");

  // Saved again under the same title: the same page, its key kept, a second version.
  await pages.save({ place, title: "Party", slug: "party", content: `${saved.replace("Saturday at eight.", "Saturday at nine.")}` });
  assert.equal(pageKeyOf(readPage(await fs.readFile(real, "utf8"))), key);
  let versions = (await pages.versions(page, inHome(homeId))).versions;
  assert.deepEqual(versions.map((version) => [version.kind, version.current]), [["save", true], ["save", false]]);
  assert.deepEqual((await pages.versions(page, inHome(other.homeId))).versions, [], "another home sees none of them");

  // Ticks go into the file.
  assert.deepEqual(await pages.tick({ ...page, items: [{ tick: 1, done: true }] }), { changed: 1 });
  assert.match(await fs.readFile(real, "utf8"), /<li>Cake<\/li><li data-done="">Candles<\/li>/u);
  // While the home's files move, the page still opens, but a tick is refused with why.
  moving = true;
  await assert.rejects(pages.tick({ ...page, items: [{ tick: 0, done: true }] }), { code: "files_storage_moving" });
  assert.ok((await pages.frame(page)).src);
  moving = false;

  // The frame's address: its page and its own files, with the helper and the page's scripts, sealed.
  const { src } = await pages.frame(page);
  assert.match(src, /^\/api\/pages\/[^/]+\/party\.html$/u);
  const framed = await pages.serve({ frameToken: frameToken(src), rest: "party.html" });
  assert.match(framed.headers["content-security-policy"], /sandbox allow-scripts/u);
  assert.match(framed.body, /<style id="mercbot-shell">/u);
  assert.match(framed.body, /window\.parent\.postMessage/u, "the helper is there");
  assert.match(framed.body, /document\.title = 'ran'/u, "and the page's own script");
  assert.match(framed.body, /<li data-tick="0">Cake<\/li><li data-done="" data-tick="1">Candles<\/li>/u);
  const file = await pages.serve({ frameToken: frameToken(src), rest: picture });
  assert.equal(file.type, "image/png");
  assert.equal(String(file.body), "INVITE-PNG");
  await notFound(() => pages.serve({ frameToken: frameToken(src), rest: "other.html" }), "another page by this page's token");
  await notFound(() => pages.serve({ frameToken: frameToken(src), rest: "party.files/../party.html" }), "a way out of the folder");
  const [body, seal] = frameToken(src).split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), p: "/files/bot/Pages/secret.html" })).toString("base64url");
  await notFound(() => pages.serve({ frameToken: `${forged}.${seal}`, rest: "secret.html" }), "a token changed to name another page");
  await notFound(() => pages.serve({ frameToken: "not-a-token", rest: "party.html" }), "no token at all");
  const now = Date.now;
  Date.now = () => now() + 13 * 3600 * 1000;
  try {
    await notFound(() => pages.serve({ frameToken: frameToken(src), rest: "party.html" }), "an expired token");
  } finally {
    Date.now = now;
  }

  // Opened on its own, by an address something else made for it (keyOf, serveOnItsOwn): the page without any
  // script, and the files of its folder, only while the file still carries the key it is given.
  assert.equal(await pages.keyOf(page), key, "the key its file carries");
  assert.equal(await pages.keyOf({ ...page, path: "/files/bot/Pages/none.html" }), null, "no page there");
  const alone = await pages.serveOnItsOwn(page, { key, rest: "party.html" });
  assert.doesNotMatch(alone.body, /<script/u, "neither the helper nor the page's own script");
  assert.match(alone.headers["content-security-policy"], /script-src 'none'.*sandbox$/u);
  assert.match(alone.body, /Saturday at nine\./u);
  assert.equal(String((await pages.serveOnItsOwn(page, { key, rest: picture })).body), "INVITE-PNG");
  await notFound(() => pages.serveOnItsOwn(page, { key: "another-key", rest: "party.html" }), "another key");
  await notFound(() => pages.serveOnItsOwn(page, { key: "", rest: "party.html" }), "no key at all");
  await notFound(() => pages.serveOnItsOwn(page, { key, rest: "other.html" }), "another page by this page's key");
  await notFound(() => pages.serveOnItsOwn({ ...page, path: "/files/mine/party.html" }, { key, rest: "party.html" }), "not a page's path");
  const script = picture.replace(/[^/]+$/u, "run.js");
  await fs.writeFile(path.join(path.dirname(real), script), "window.ran = true;");
  assert.equal(String((await pages.serve({ frameToken: frameToken(src), rest: script })).body), "window.ran = true;", "its frame loads its scripts");
  await notFound(() => pages.serveOnItsOwn(page, { key, rest: script }), "on its own, never");

  // A different page put at the same path doesn't open by the old key, nor do the files of its folder.
  const before = await fs.readFile(real, "utf8");
  await fs.writeFile(real, "<!DOCTYPE html><html><head><meta name='mercbot-page' content='another-key'></head><body>Someone else's</body></html>");
  await notFound(() => pages.serveOnItsOwn(page, { key, rest: "party.html" }), "the file isn't the page with that key");
  await notFound(() => pages.serveOnItsOwn(page, { key, rest: picture }), "nor are the files of its folder");
  assert.equal(await pages.keyOf(page), "another-key");
  // An older page without a key gets one when asked, written into its file, and keeps it.
  await fs.writeFile(real, "<!DOCTYPE html><html><head><title>Old</title></head><body><p>An older page</p></body></html>");
  assert.equal(await pages.keyOf(page), null, "an older page has none");
  const given = await pages.keyOf(page, { give: true });
  assert.match(given, /^[A-Za-z0-9_-]{16}$/u);
  assert.equal(pageKeyOf(readPage(await fs.readFile(real, "utf8"))), given, "written into its file");
  assert.equal(await pages.keyOf(page, { give: true }), given, "and kept");
  assert.match((await pages.serveOnItsOwn(page, { key: given, rest: "party.html" })).body, /An older page/u);
  await notFound(() => pages.keyOf({ ...page, path: "/files/bot/Pages/none.html" }, { give: true }), "a key is given only to a page");
  await fs.writeFile(real, before);

  // Changed with a command: saved again as an edit, with its card.
  await fs.writeFile(real, before.replace("Saturday at nine.", "Sunday at noon."));
  const edited = await pages.edited({ place, path: page.path });
  assert.deepEqual({ title: edited.title, summary: edited.summary }, { title: "Party", summary: "Sunday at noon." });
  versions = (await pages.versions(page, inHome(homeId))).versions;
  assert.deepEqual(versions.map((version) => version.kind), ["edit", "save", "save"]);

  // Restore brings the first version back as the newest, by this person, with the same key.
  versions = (await pages.restore({ ...page, versionId: versions.at(-1).id }, inHome(homeId))).versions;
  assert.deepEqual(versions.map((version) => [version.kind, version.userId]), [["restore", userId], ["edit", null], ["save", null], ["save", null]]);
  const restored = await fs.readFile(real, "utf8");
  assert.match(restored, /Saturday at eight\./u);
  assert.equal(pageKeyOf(readPage(restored)), key);
  assert.match((await pages.serveOnItsOwn(page, { key, rest: "party.html" })).body, /Saturday at eight\./u);
  await notFound(() => pages.restore({ ...page, versionId: "999999999" }, inHome(homeId)), "a version that isn't this page's");

  // The standalone copy carries everything inside it and loads nothing.
  const copy = await pages.standalone(page);
  assert.equal(copy.name, "party.html");
  assert.match(copy.html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/u);
  assert.match(copy.html, /<img src="data:image\/png;base64,/u);
  assert.doesNotMatch(copy.html, /party\.files\//u);

  // Moved, its versions and key follow it; deleted, its versions go. Whatever follows pages is told after each.
  const followed = [];
  pages.follow(async (change) => {
    followed.push({ ...change, versions: (await pages.versions({ ...page, path: change.from }, inHome(homeId))).versions.length });
  });
  const moved = "/files/bot/Pages/party-moved.html";
  await fs.rename(real, await store.resolve(place, moved));
  await pages.pathChanged({ homeId, botId, from: page.path, to: moved });
  assert.equal((await pages.versions({ ...page, path: moved }, inHome(homeId))).versions.length, 4);
  assert.equal(await pages.keyOf({ ...page, path: moved }), key, "it keeps its key");
  await pages.pathChanged({ homeId, botId, from: moved, to: null });
  assert.deepEqual((await pages.versions({ ...page, path: moved }, inHome(homeId))).versions, [], "a deleted page's versions go with it");
  assert.deepEqual(followed, [
    { homeId, botId, from: page.path, to: moved, versions: 0 },
    { homeId, botId, from: moved, to: null, versions: 0 }
  ], "told after the page's own versions have followed");

  // A tick on a page deleted meanwhile doesn't bring it back.
  await fs.rm(await store.resolve(place, moved));
  await notFound(() => pages.tick({ ...page, path: moved, items: [{ tick: 0, done: true }] }), "ticking a deleted page");
  assert.equal(await fs.stat(await store.resolve(place, moved)).catch(() => null), null, "the page stays deleted");
});
