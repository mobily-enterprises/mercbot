import assert from "node:assert/strict";
import test from "node:test";
import { appsHome } from "../support/appsHome.mjs";

// An app's picture and colour (D-141): anyone in the home sets them through the app's route, as they change its screens;
// a picture outside the set, a colour that isn't #RRGGBB, or neither is refused; each change is in the activity trail.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("anyone in the home sets an app's picture and colour; anything else is refused", async (context) => {
  const home = await appsHome(context, { slug: "apps-icons" });
  const { knex, apps: capability, options, userId, workspace, workspaceId } = home;
  const made = await capability.apps.createApp({ type: "person", id: userId, name: "Pat" }, { name: "Pet care", icon: "no-such-picture" }, options);
  assert.equal(made.icon, "apps", "a picture it doesn't know draws as apps");
  const member = home.browser({ member: { userId, workspace, role: "member", permissions: [] } });
  const put = (body) => member("PUT", `/api/w/${workspace.slug}/apps/${made.slug}/icon`, body);

  const changed = await put({ icon: "pets", color: "#7A4E2D" });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(changed.body, { icon: "pets", color: "#7A4E2D", picture: null });
  assert.deepEqual([(await capability.apps.find(made.slug, options)).icon, (await capability.apps.find(made.slug, options)).color], ["pets", "#7A4E2D"]);
  assert.deepEqual((await put({ color: "#0B7A5B" })).body, { icon: "pets", color: "#0B7A5B", picture: null }, "the colour alone keeps the picture");

  for (const [body, code] of [[{ icon: "nope" }, "apps_icon_unknown"], [{ color: "red" }, "apps_color_invalid"], [{}, "apps_icon_nothing"]]) {
    const refused = await put(body);
    assert.deepEqual([refused.status, refused.body.code], [400, code], JSON.stringify(body));
  }
  const trail = await knex("audit_events").where({ workspace_id: workspaceId, action: "app" }).whereRaw("changes \\? 'icon'").orderBy("id");
  assert.deepEqual(trail.map((row) => row.changes.icon.to), [{ icon: "pets", color: "#7A4E2D", picture: null }, { icon: "pets", color: "#0B7A5B", picture: null }]);
});

// A bot's picture on a tile (D-141): it must be a picture; it's kept with the home's Database files and shown in place
// of the set picture; a new one replaces it and the old file goes; choosing a set picture again takes it away.
test("a bot's picture goes on an app's tile, is replaced and taken away cleanly", async (context) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createFileStore } = await import("../../packages/files/src/server/fileStore.js");
  const { appsParts } = await import("../support/appsHome.mjs");
  const { createAppIcon } = await import("../../packages/apps/src/server/appIcon.js");
  const home = await appsHome(context, { slug: "apps-icon-picture" });
  const dir = await mkdtemp(path.join(os.tmpdir(), "mercbot-app-picture-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const files = { write: store.writeRecordFile, remove: store.removeRecordFile };
  const { resources, apps } = appsParts(home, { recordFiles: files });
  const icons = createAppIcon({ resources, apps, files: () => files });
  const pat = { type: "person", id: String(home.userId), name: "Pat" };
  const app = await apps.createApp(pat, { name: "Pet care", icon: "pets" }, home.options);
  const exists = (virtualPath) => store.existingFile(store.homePlace(home.workspaceId), virtualPath).then(() => true, () => false);
  const fileOf = async (name, bytes) => {
    await writeFile(path.join(dir, name), bytes);
    return { source: path.join(dir, name), name };
  };
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

  await assert.rejects(icons.putPicture(pat, app.slug, await fileOf("notes.txt", "hello"), home.options), { code: "apps_icon_not_picture" });
  const first = await icons.putPicture(pat, app.slug, await fileOf("paw.png", PNG), home.options);
  assert.match(first.picture, /^\/files\/db\/tables\/app-pictures\//u);
  assert.deepEqual([first.icon, (await apps.find(app.slug, home.options)).picture], ["pets", first.picture]);
  assert.equal(await exists(first.picture), true);

  const second = await icons.putPicture(pat, app.slug, await fileOf("paw2.png", PNG), home.options);
  assert.equal(await exists(first.picture), false, "the picture it replaced is gone");
  assert.deepEqual((await icons.set(pat, app.slug, { color: "#0B7A5B" }, home.options)).picture, second.picture, "a colour keeps it");
  assert.equal((await icons.set(pat, app.slug, { icon: "home" }, home.options)).picture, null, "a set picture takes it away");
  assert.equal(await exists(second.picture), false);
});
