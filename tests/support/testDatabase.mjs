// The disposable test databases: the one the process environment names (DB_NAME = TEST_DB_NAME) for
// the database tests and the browser fixtures, and the copies a test run makes of a prepared
// template (JSKIT database layer guide, "Integration test databases"). The template is migrated and
// seeded once, and rebuilt only when the digest of the migrations and this seed changes; each test
// file and each browser worker then gets its own copy (CREATE DATABASE … TEMPLATE), so files run in
// parallel and none sees another's rows.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import knexLib from "knex";
import {
  createKnexMigrationConfig,
  discoverPackageMigrationDirectories
} from "@jskit-ai/database-runtime/server/knexMigrationConfig";

// The people the database tests expect: they use the first few as the person, a colleague and an outsider.
const TEST_USERS = 3;
// PostgreSQL names are at most 63 bytes; a run's copies add "_r<pid>_<part>" to the stem.
const STEM_LENGTH = 45;

/**
 * The installed packages' migration directories. A test run finds them once (prepareTestTemplate) and
 * hands them to its files in MERCBOT_TEST_PACKAGE_MIGRATIONS: finding them reads every installed
 * package (about 0.7 s a process on a busy machine).
 */
async function packageMigrationDirectories() {
  const handed = process.env.MERCBOT_TEST_PACKAGE_MIGRATIONS;
  return handed ? JSON.parse(handed) : discoverPackageMigrationDirectories();
}

/**
 * The Knex configuration of the database `environment` names with the app's migrations and its packages', as the app's
 * own (knexfile.js) has them: a package's constraints/ directory runs after the app's migrations (the websites
 * package's tables name bots).
 * @param {Record<string, unknown>} environment
 * @param {string[]} packages the packages' migration directories
 */
function migrationConfig(environment, packages) {
  const packageConstraintDirectories = packages.map((directory) => path.join(directory, "constraints")).filter((directory) => existsSync(directory));
  return createKnexMigrationConfig({ client: "pg", environment, packageMigrationDirectories: packages, packageConstraintDirectories });
}

/**
 * The Knex configuration of the test database, with the app's and its packages' migrations. Every
 * test that connects goes through here, so it refuses unless DB_NAME names TEST_DB_NAME: a file run
 * with the development .env (DB_NAME the development database) would migrate it and write test
 * people, homes and bots there. The test runs set both to the file's own copy (testFile.mjs).
 */
export async function testDatabaseConfig() {
  const testDatabase = testDatabaseName(process.env);
  if (process.env.DB_NAME !== testDatabase) {
    throw new Error(`DB_NAME (${process.env.DB_NAME || "unset"}) must be TEST_DB_NAME (${testDatabase}), a disposable test database: run the tests with npm run test:database.`);
  }
  return migrationConfig(process.env, await packageMigrationDirectories());
}

/**
 * A new Knex connection to the test database; the caller destroys it. In a test run the database is
 * the file's own copy of the template, which prepareTestTemplate has checked against the migrations,
 * so tests don't migrate it again (13 statements and a read of every migration folder each time).
 */
export async function connectTestDatabase() {
  return knexLib(await testDatabaseConfig());
}

/**
 * Waits until every transaction begun before this call has ended, in any database of the test
 * server. Watches read changes up to a transaction horizon, pg_snapshot_xmin(pg_current_snapshot())
 * (packages/apps/src/server/watches.js and scripts.js), and that horizon is the whole server's: while
 * test files run side by side, a write still open in another file's database (a test's own
 * transaction, or a database copy being made) holds it back for a moment. A test waits for this
 * before it saves or resumes a watch, whose cursor starts at the horizon, and before a drain that
 * must see its changes. Its bound is coarse: a transaction open for a minute is clearly broken.
 * @param {import("knex").Knex} knex
 */
export async function earlierTransactionsEnded(knex) {
  const boundMs = 60_000;
  const { xid } = (await knex.raw("select pg_current_xact_id()::text as xid")).rows[0];
  const deadline = Date.now() + boundMs;
  while (!(await knex.raw("select pg_snapshot_xmin(pg_current_snapshot()) > ?::xid8 as passed", [xid])).rows[0].passed) {
    if (Date.now() > deadline) throw new Error(`A transaction begun before ${xid} is still open after ${boundMs / 1000} s.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The test users a fresh test database lacks (CI), added once; existing users count. */
export async function seedTestUsers(knex) {
  const have = Number((await knex("users").count("* as n").first()).n);
  for (let index = have + 1; index <= TEST_USERS; index += 1) {
    await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `test-user-${index}`,
      email: `test-user-${index}@example.com`, username: `testuser${index}`, display_name: `Test User ${index}`
    });
  }
  return Math.max(have, TEST_USERS);
}

/** TEST_DB_NAME, required: every name below derives from it. */
function testDatabaseName(environment) {
  const name = String(environment.TEST_DB_NAME || "").trim();
  if (!name) throw new Error("TEST_DB_NAME must name a disposable test database.");
  return name;
}

/** The start of every derived name: TEST_DB_NAME, or its start and a hash when it is long. */
function stemOf(environment) {
  const name = testDatabaseName(environment);
  if (name.length <= STEM_LENGTH) return name;
  return `${name.slice(0, STEM_LENGTH - 9)}_${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
}

/** The prepared template's name. */
export function testTemplateName(environment = process.env) {
  return `${stemOf(environment)}_tpl`;
}

/** The name of the copy that the run whose process is `run` makes for its part `part` (letters and digits). */
export function testCopyName(run, part, environment = process.env) {
  return `${stemOf(environment)}_r${run}_${part}`;
}

/** A Knex instance on one database of the test server, holding one connection (for session locks). */
function connectTo(database, environment) {
  return knexLib({
    ...createKnexMigrationConfig({ client: "pg", environment: { ...environment, DB_NAME: database } }),
    pool: { min: 1, max: 1 }
  });
}

/** The digest of every migration file the app and its packages supply, and of this module (the seed). */
async function sourceDigest(directories) {
  const hash = createHash("sha256");
  for (const directory of directories) {
    const names = (await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".cjs"))
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      hash.update(`${path.relative(process.cwd(), path.join(directory, name))}\0`);
      hash.update(await readFile(path.join(directory, name)));
    }
  }
  hash.update(await readFile(fileURLToPath(import.meta.url)));
  return hash.digest("hex");
}

/**
 * Drops a database of the test server. WITH (FORCE) ends the test sessions still connected to it, but the tests' role
 * may not end an autovacuum worker tidying it after the tests' writes ("permission denied to terminate process"), and
 * on a busy test machine one often is; a plain DROP stops autovacuum itself, so it's the fallback.
 * @param {import("knex").Knex} admin
 * @param {string} name
 */
async function dropDatabase(admin, name) {
  try {
    await admin.raw("DROP DATABASE IF EXISTS ?? WITH (FORCE)", [name]);
  } catch (error) {
    if (error?.code !== "42501") throw error;
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  }
}

/** A lock on the template for the rest of the connection's session: exclusive to rebuild it, shared to copy it. */
async function lockTemplate(admin, template, mode) {
  await admin.raw(`SELECT ${mode === "shared" ? "pg_advisory_lock_shared" : "pg_advisory_lock"}(hashtext(?))`, [template]);
}

/**
 * Makes sure the template matches the current migrations and seed, rebuilding it from an empty
 * database when it doesn't, and reports each phase with its duration.
 * @returns {Promise<{ template: string, packageMigrations: string[], phases: string[] }>}
 */
export async function prepareTestTemplate(environment = process.env) {
  const template = testTemplateName(environment);
  const phases = [];
  const timed = async (phase, work) => {
    const started = performance.now();
    const result = await work();
    phases.push(`${phase} ${Math.round(performance.now() - started)} ms`);
    return result;
  };
  const packages = await timed("package migrations", () => packageMigrationDirectories());
  const config = migrationConfig({ ...environment, DB_NAME: template }, packages);
  const digest = await timed("digest", () => sourceDigest(config.migrations.directory));
  const admin = connectTo(testDatabaseName(environment), environment);
  try {
    await lockTemplate(admin, template, "exclusive");
    const { rows: [stored] } = await admin.raw("SELECT shobj_description(oid, 'pg_database') AS digest FROM pg_database WHERE datname = ?", [template]);
    if (stored?.digest === digest) {
      phases.push("template current");
    } else {
      await timed(stored ? "rebuild (the migrations or the seed changed)" : "build", async () => {
        await dropDatabase(admin, template);
        await admin.raw("CREATE DATABASE ??", [template]);
        const knex = knexLib(config);
        try {
          await knex.migrate.latest();
          await seedTestUsers(knex);
        } finally {
          await knex.destroy();
        }
        await admin.raw(`COMMENT ON DATABASE ?? IS '${digest}'`, [template]);
      });
    }
  } finally {
    await admin.destroy();
  }
  return { template, packageMigrations: packages, phases };
}

/**
 * A fresh copy of the template named `name`, replacing any database of that name; or of `from`, a
 * database this run made from it (the browser suite's copy with its fixtures made).
 */
export async function copyTestTemplate(name, environment = process.env, from = testTemplateName(environment)) {
  const template = testTemplateName(environment);
  const admin = connectTo(testDatabaseName(environment), environment);
  try {
    await lockTemplate(admin, template, "shared");
    await dropDatabase(admin, name);
    await admin.raw("CREATE DATABASE ?? TEMPLATE ??", [name, from]);
  } finally {
    await admin.destroy();
  }
  return name;
}

/** Whether the process `pid` still runs on this machine. */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Drops the copies made by the run `run`, and those of earlier runs whose process has gone (runs
 * killed before they could drop their own).
 */
export async function dropTestCopies(run, environment = process.env) {
  const prefix = `${stemOf(environment)}_`;
  const admin = connectTo(testDatabaseName(environment), environment);
  try {
    const { rows } = await admin.raw("SELECT datname FROM pg_database WHERE starts_with(datname, ?)", [prefix]);
    for (const { datname: name } of rows) {
      const owner = Number(/^r(\d+)_[a-z0-9]+$/u.exec(name.slice(prefix.length))?.[1]);
      if (owner && (owner === Number(run) || !running(owner))) await dropDatabase(admin, name);
    }
  } finally {
    await admin.destroy();
  }
}
