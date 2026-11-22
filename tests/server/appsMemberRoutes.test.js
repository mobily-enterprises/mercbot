import assert from "node:assert/strict";
import test from "node:test";
import { registerRoutes } from "../../packages/apps/src/server/registerRoutes.js";

// Every member sees every app and view and changes every table (D-66): the routes that chose who may
// are gone, so their addresses answer 404 like any address with no route. Every apps route needs
// sign-in, the live stream of table changes too.
function registeredWith(register = (http) => registerRoutes(http, { appsRuntime: {}, notices: {}, streams: new Set() })) {
  const routes = new Map();
  const http = { router: { register: (method, path, options) => routes.set(`${method} ${path}`, options) } };
  register(http);
  return routes;
}
const registered = () => [...registeredWith().keys()];

test("the routes that chose who in the home may see an app or view are gone", () => {
  const routes = registered();
  for (const gone of [
    "GET /api/w/:workspaceSlug/apps/:slug/access",
    "PUT /api/w/:workspaceSlug/apps/:slug/access",
    "PUT /api/w/:workspaceSlug/apps/:slug/share"
  ]) {
    assert.ok(!routes.includes(gone), `${gone} is no route`);
  }
  for (const kept of [
    "POST /api/w/:workspaceSlug/apps/:slug/retire",
    "GET /api/w/:workspaceSlug/apps/retired",
    "POST /api/w/:workspaceSlug/apps/retired/:slug/bring-back",
    "PUT /api/w/:workspaceSlug/apps/builder"
  ]) {
    assert.ok(routes.includes(kept), `${kept} stays`);
  }
});

test("the routes that chose who may change a table, and the people to choose from, are gone", () => {
  const routes = registered();
  for (const gone of ["PUT /api/w/:workspaceSlug/app-data/tables/:key/writers", "GET /api/w/:workspaceSlug/apps-people"]) {
    assert.ok(!routes.includes(gone), `${gone} is no route`);
  }
  for (const kept of [
    "POST /api/w/:workspaceSlug/app-data/tables/:key/records",
    "PATCH /api/w/:workspaceSlug/app-data/tables/:key/records/:id",
    "POST /api/w/:workspaceSlug/app-data/tables/:key/import"
  ]) {
    assert.ok(routes.includes(kept), `${kept} stays`);
  }
});

test("every apps route needs sign-in, and the live stream of table changes too", () => {
  const members = registeredWith();
  assert.deepEqual([...members].filter(([, options]) => options?.auth !== "required").map(([route]) => route), [], "every member route needs sign-in");
  assert.deepEqual(members.get("GET /api/w/:workspaceSlug/apps-events"), { auth: "required", contextPolicy: "required", visibility: "workspace_user" });
});

test("only the home's owners and admins choose the Builder; everyone reads which bot it is", async () => {
  const chosen = [];
  const apps = {
    builder: async () => ({ id: "7", name: "Chef" }),
    setBuilder: async (_actor, botId) => {
      chosen.push(botId);
      return { id: botId, name: "Otto" };
    }
  };
  const handlers = new Map();
  registerRoutes({ router: { register: (method, path, _options, handler) => handlers.set(`${method} ${path}`, handler) } }, { appsRuntime: { apps }, notices: {}, streams: new Set() });
  async function call(key, body, permissions) {
    const answered = {};
    const reply = { code(status) { answered.status = status; return reply; }, send(sent) { answered.body = sent; return reply; } };
    const request = { workspace: { id: "3", slug: "home-3" }, user: { id: "2", displayName: "Ben" }, permissions, body, params: {}, callOptions: async () => ({}) };
    await handlers.get(key)(request, reply);
    return answered;
  }
  const member = await call("PUT /api/w/:workspaceSlug/apps/builder", { botId: "8" }, []);
  assert.deepEqual([member.status, member.body.code], [403, "apps_builder_manage_forbidden"]);
  assert.deepEqual(chosen, [], "a member's request changes nothing");
  const read = await call("GET /api/w/:workspaceSlug/apps/builder", undefined, []);
  assert.deepEqual(read.body, { builder: { id: "7", name: "Chef" }, canManage: false }, "a member reads it, and may not change it");
  const owner = await call("PUT /api/w/:workspaceSlug/apps/builder", { botId: "8" }, ["workspace.settings.update"]);
  assert.equal(owner.status, 200);
  assert.deepEqual(chosen, ["8"]);
});
