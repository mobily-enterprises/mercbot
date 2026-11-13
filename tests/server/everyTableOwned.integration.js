// Every table of the migrated database has one owner: a table resource one feature of the installed server owns
// (Mercbot's own and JSKIT's), or a table a JSKIT package keeps outside resources. A table no feature owns is a table
// anything could reach by name. The whole server is built as it starts, and the resource runtime it owned every table
// through is read once its boot is done.
import test from "node:test";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { LOCAL_AUTH_INFRASTRUCTURE_TABLES } from "@jskit-ai/auth-provider-local-db-core/server/lib/index";
import { expectEveryTableOwned } from "@jskit-ai/resource-runtime/test";
import { createServerWith } from "../../server.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// json-rest-api's AnyAPI storage, where the apps package keeps the tables people define while an app runs, each
// home's under its own tenant (packages/apps/src/server/anyapi.js); no table resource describes them.
const ANYAPI_STORAGE_TABLES = Object.freeze(["any_resource_configs", "any_field_configs", "any_relationship_configs", "any_records", "any_links"]);

const runtimeEnv = Object.freeze({
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "server-test-only-session-secret",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
});

test("every table of the migrated database has an owner", async (context) => {
  const knex = await connectTestDatabase();
  context.after(() => knex.destroy());
  let resources = null;
  const ResourceRuntimeProbe = defineProvider({
    id: "test.resource-runtime-probe",
    requires: { runtime: "runtime.resources" },
    setup({ runtime }) {
      resources = runtime;
    }
  });
  const app = await createServerWith({ runtimeEnv, providers: [ResourceRuntimeProbe] });
  context.after(() => app.close());
  // The usage tables' partitions (D-73) are their parent table's, which the account feature owns.
  const { rows: partitions } = await knex.raw(`
    select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent
    where p.relname in ('usage_daily', 'usage_events')`);
  await expectEveryTableOwned({
    knex,
    runtime: resources,
    infrastructureTables: [...LOCAL_AUTH_INFRASTRUCTURE_TABLES, ...ANYAPI_STORAGE_TABLES, ...partitions.map((row) => row.name)],
    environment: runtimeEnv
  });
});
