import assert from "node:assert/strict";
import test from "node:test";
import { registerRoutes } from "../../packages/integrations/src/server/registerRoutes.js";
import { startIntegrations } from "../support/ownedHandles.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { separateHome } from "./testHome.js";

// A person's private skill is theirs in a home (D-112): Connect apps saves and deletes it through the routes of the
// home it's open in, each called as JSKIT calls a route of its kind (the home only on a home's route), and the same
// person's skill in another home isn't reached from there. Against the disposable test database.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const SAVE = "PATCH /api/w/:workspaceSlug/skills/:skillId";
const DELETE = "DELETE /api/w/:workspaceSlug/skills/:skillId";

test("a private skill is saved and deleted through its home's routes, and another home's skill isn't reached", async (context) => {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").first()).id);
  const homes = [await separateHome(knex, pat), await separateHome(knex, pat)];
  context.after(async () => {
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  const [here, there] = await knex("user_skills")
    .insert(homes.map((homeId, index) => ({ workspace_id: homeId, user_id: pat, name: `Skill ${index + 1}`, description: "", instructions: "Steps." })))
    .returning("id");
  const { integrations } = await startIntegrations(knex, context, { catalogue: [] });
  const routes = new Map();
  registerRoutes({ router: { register: (method, path, meta, handler) => routes.set(`${method} ${path}`, { meta, handler }) } }, { integrations, catalogue: [], env: {} });
  const home = await knex("workspaces").where({ id: homes[0] }).first();

  /** `route` called for Pat in the first home, as JSKIT calls a route of its visibility: its status and answer. */
  async function call(route, skillId, body = {}) {
    const found = routes.get(route);
    assert.ok(found, `${route} is a route`);
    assert.equal(found.meta.visibility, "workspace_user", `${route} is the home's`);
    const request = { user: { id: pat }, workspace: { id: home.id, slug: home.slug } };
    const answer = {};
    const reply = { code: (status) => (answer.status = status, reply), send: (sent) => (answer.body = sent, reply) };
    await found.handler({ params: { workspaceSlug: home.slug, skillId: String(skillId) }, body, callOptions: async () => requestContextOptions(request) }, reply);
    return answer;
  }

  const saved = await call(SAVE, here.id, { name: "Weekly report" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.skill.name, "Weekly report");
  assert.equal((await knex("user_skills").where({ id: here.id }).first()).name, "Weekly report");

  assert.equal((await call(SAVE, there.id, { name: "Not from here" })).status, 404, "the other home's skill isn't saved from this one");
  assert.equal((await call(DELETE, there.id)).status, 404, "nor deleted");
  assert.equal((await knex("user_skills").where({ id: there.id }).first()).name, "Skill 2");

  assert.deepEqual(await call(DELETE, here.id), { status: 200, body: { deleted: String(here.id) } });
  assert.equal(await knex("user_skills").where({ id: here.id }).first(), undefined);
});
