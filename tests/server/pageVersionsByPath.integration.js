import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { FILES_OWNS } from "../../packages/files/src/server/FilesFeature.js";
import { createPages } from "../../packages/files/src/server/pages.js";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { planOf, statementsDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Moving pages in a home's own folder (any bot's, so read by home and path with no bot: files' pages.pathsChanged)
// reads only those pages' versions, however many versions of other pages the home keeps (ix_page_versions_path).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const VERSIONS = 10;

test("a home-folder move reads its pages' versions alone, whether the home keeps 0 or 5,000 versions of other pages", async (context) => {
  const knex = await connectTestDatabase();
  const homes = [];
  context.after(async () => {
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  const userId = String((await knex("users").first()).id);
  const { features } = await ownedHandles(knex, context, { "mercbot.files": FILES_OWNS });
  const files = features["mercbot.files"];
  const pages = createPages({ store: {}, resources: files.resources, systemContext: files.systemContext, env: {} });

  /** A home whose two moved pages have VERSIONS versions each, beside `others` versions of other pages: the rows the move's read touches. */
  async function rowsRead(others) {
    const [home] = await knex("workspaces").insert({ slug: `pv-${randomBytes(4).toString("hex")}`, name: "pv", owner_user_id: userId, is_personal: false }).returning("id");
    const homeId = String(home.id);
    homes.push(homeId);
    const [bot] = await knex("bots").insert({ made_by: userId, workspace_id: homeId, name: "Paige", color: "#1E86FC" }).returning("id");
    const version = (at, n) => ({ workspace_id: homeId, bot_id: String(bot.id), path: at, page_key: `k-${at}`, kind: "save", content: `<h1>${n}</h1>` });
    const moved = ["/files/shared/Pages/a.html", "/files/shared/Pages/b.html"];
    const rows = [
      ...moved.flatMap((at) => Array.from({ length: VERSIONS }, (_, n) => version(at, n))),
      ...Array.from({ length: others }, (_, n) => version(`/files/shared/Pages/other-${n % 500}.html`, n))
    ];
    for (let at = 0; at < rows.length; at += 1000) await knex("page_versions").insert(rows.slice(at, at + 1000));
    await knex.raw("analyze page_versions");
    const moves = moved.map((from) => ({ from, to: from.replace("/files/shared/Pages/", "/files/shared/Moved/Pages/") }));
    const statements = await statementsDuring(knex, () => pages.pathsChanged({ homeId, botId: null, moves }), /^select .*from "page_versions"/iu);
    assert.equal(await knex("page_versions").where({ workspace_id: homeId }).whereIn("path", moves.map(({ to }) => to)).count("* as n").first().then((r) => Number(r.n)), 2 * VERSIONS, "the versions followed");
    // The read, asked again for the pages where they are now.
    const [read] = statements;
    const to = new Map(moves.map(({ from, to: now }) => [from, now]));
    return (await planOf(knex, { sql: read.sql, bindings: read.bindings.map((value) => to.get(value) ?? value) })).rowsRead;
  }

  const small = await rowsRead(0);
  assert.equal(small, 2 * VERSIONS, "only the moved pages' versions");
  assert.equal(await rowsRead(5000), small, "a long history of other pages adds no row read");
});
