import assert from "node:assert/strict";
import { __testables as anyapiTestables } from "../../packages/apps/src/server/anyapi.js";
import { createApps } from "../../packages/apps/src/server/apps.js";
import { createAppsRepository } from "../../packages/apps/src/server/appsRepository.js";
import { createDataGate } from "../../packages/apps/src/server/dataGate.js";
import { createPractices } from "../../packages/apps/src/server/practice.js";
import { createRegistry } from "../../packages/apps/src/server/registry.js";
import { homeIdOf } from "../../packages/apps/src/server/callOptions.js";
import { startApps } from "./appsFeatures.mjs";
import { connectTestDatabase } from "./testDatabase.mjs";

const { tenantOf } = anyapiTestables;
// A home's practice copies of drafts (D-71): AnyAPI tenants under the home's own.
const practiceTenants = (workspaceId) => `${tenantOf(workspaceId)}:p:%`;
const QUIET = Object.freeze({ publish: async () => {}, subscribe: () => () => {} });
const NO_BOTS = Object.freeze({
  directory: Object.freeze({ listHomeBots: async () => [], findBot: async () => null })
});

/**
 * A new home for one apps test, with the apps features started on the test database (startApps): the database's
 * first person as its member, their call options as a route builds them, and a job's options there. The home, its
 * AnyAPI rows and the features go when the test ends.
 * @param {import("node:test").TestContext} context
 * @param {object} [options]
 * @param {string} [options.slug] the start of the home's slug
 * @param {import("knex").Knex} [options.knex] the test's own connection, which the test then closes itself
 * @param {Record<string, unknown>} [options.env]
 * @param {object} [options.records] `mercbot.bots.records` (startApps': a home without bots)
 * @param {object} [options.extras] more features on mercbot.apps (startApps')
 */
export async function appsHome(context, { slug = "apps-it", knex: given = null, env, records, extras } = {}) {
  const knex = given ?? (await connectTestDatabase());
  const userId = (await knex("users").orderBy("id").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const homeSlug = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [home] = await knex("workspaces")
    .insert({ slug: homeSlug, name: "Apps test", owner_user_id: userId, is_personal: false })
    .returning("id");
  const workspaceId = String(home.id ?? home);
  const started = await startApps({ knex, env, records, extras });
  const workspace = { id: workspaceId, slug: homeSlug };
  const options = started.memberOptions(userId, workspace);
  context.after(async () => {
    await started.stop();
    for (const table of ["any_records", "any_resource_configs"]) {
      await knex(table).where({ tenant_id: tenantOf(workspaceId) }).orWhereLike("tenant_id", practiceTenants(workspaceId)).del();
    }
    await knex("workspaces").where({ id: workspaceId }).del();
    if (!given) await knex.destroy();
  });
  return Object.freeze({
    knex,
    ...started,
    userId: String(userId),
    workspaceId,
    workspace,
    /** The member's call options, as their requests' routes pass them. */
    options,
    /** A job's call options in this home. */
    job: started.jobOptions(workspaceId),
    /** A data gate ctx as the member: `{ options, actor, via }`. */
    ctx: (actor, via = { kind: "data" }) => ({ options, actor, via })
  });
}

/**
 * The apps platform's parts wired by hand on a started home's own handles and AnyAPI, for a test that needs one
 * part unlike the server's: a registry that never refreshes its cached tables (`trustMs: Infinity`, so a query
 * count holds only the work's own), a gate without scripts' rules (`beforeSave` stub) or one that works out a
 * calculated field's sum from only a few records (`calculatedTotalsMax`). The registry hears no
 * notices (its cache drops only on its own changes, as these tests' registries always did); `notices` are the
 * apps' (queueTask's wake-up). Scripts, the runtime, views and watches are built from these by the test itself,
 * with `systemContext` here.
 * @param {Awaited<ReturnType<typeof appsHome>>} home
 * @param {object} [parts]
 * @param {number} [parts.trustMs]
 * @param {Function} [parts.beforeSave] the gate's rules (default: none, the values as given)
 * @param {Function} [parts.beforeSaveEach]
 * @param {number} [parts.calculatedTotalsMax] the gate's bound on a calculated field's sum (default: the server's)
 * @param {object} [parts.notices] the apps' (default: quiet)
 * @param {object} [parts.records] `mercbot.bots.records` (default: a home without bots)
 */
export function appsParts(home, { trustMs, beforeSave = async (_ctx, _table, _action, values) => values, beforeSaveEach, calculatedTotalsMax, notices = QUIET, records = NO_BOTS } = {}) {
  const resources = home.handles;
  const anyapi = home.apps.anyapi;
  const repository = createAppsRepository(resources);
  /** The system context factory the platform's parts take: the tests' own, which reads every home. */
  const systemContext = () => home.systemContext;
  const registry = createRegistry({ resources, anyapi, notices: QUIET, ...(trustMs === undefined ? {} : { trustMs }) });
  const practices = createPractices({ resources, anyapi, systemContext });
  const gate = createDataGate({ resources, repository, anyapi, registry, practices, beforeSave, ...(beforeSaveEach ? { beforeSaveEach } : {}), ...(calculatedTotalsMax ? { calculatedTotalsMax } : {}) });
  const apps = createApps({ resources, records, registry, anyapi, practices, notices });
  return Object.freeze({ resources, repository, anyapi, registry, practices, gate, apps, notices, systemContext });
}

/**
 * A stand-in for `mercbot.bots.records` (the bots' records feature, whose own tests cover it) with the directory
 * reads the apps make: the bots the test made on its database, in the call's home, answered as the directory
 * answers them (string ids). For apps tests whose bots matter (hand-offs, the Builder, a view's maker).
 * @param {import("knex").Knex} knex
 */
export function botsOf(knex) {
  const inHome = (options) => knex("bots").where({ workspace_id: homeIdOf(options) });
  return Object.freeze({
    directory: Object.freeze({
      async listHomeBots(options) {
        const rows = await inHome(options).where({ kind: "bot" }).orderBy("id").select("id", "name");
        return rows.map((row) => ({ id: String(row.id), name: row.name }));
      },
      async findBot(botId, options, { kind } = {}) {
        const row = await inHome(options).where({ id: botId, ...(kind ? { kind } : {}) }).first("id", "name", "color", "shape", "kind", "sharing", "user_id");
        return row ? { id: String(row.id), name: row.name, color: row.color, shape: row.shape, kind: row.kind, sharing: row.sharing, userId: String(row.user_id) } : null;
      }
    })
  });
}
