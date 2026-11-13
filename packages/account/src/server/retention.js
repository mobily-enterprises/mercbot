// readable-check: allow no-direct-knex - infrastructure: the usage tables' partitions are made, read and dropped whole on the database connection (D-73)
// readable-check: allow no-hand-scope - infrastructure: a month's partition is read for archiving by ranges of homes, which no table resource describes
// readable-check: allow no-transaction-reader - infrastructure: a partition is dropped in the transaction that holds its month's claim
// readable-check: allow sql-literal - infrastructure: the partitions' own SQL, with every value bound
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { filesFolder } from "./dataFolder.js";
import { claimJob } from "./jobs.js";
import { DETAIL_DAYS } from "./usage.js";

// Keeping usage (D-73, amending D-56's answer), sized for hundreds of thousands of homes. Each AI call's and computer
// day's own row is kept DETAIL_DAYS days in daily partitions, which mercbot_charge_partitions() (the migration's) makes
// ahead of time and then drops whole, without an archive. The daily totals are kept 13 months in monthly partitions;
// then each month is written to archive files, one per range of homes so they can move with their homes, checked
// against the disk and the database, and its partition dropped. The monthly totals stay in the database; archive
// files are kept 7 years. Every server sweeps (D-15): a month is claimed in usage_jobs, and only the server holding
// the claim, with its row locked, drops it. A server that dies mid-month leaves its claim, which another takes after
// an hour; its half-written files are never the archive.

/** Daily totals are kept for this month and the twelve before it (D-73). */
export const DAILY_MONTHS = 13;
const ARCHIVE_YEARS = 7;
/** Homes per archive file: a file holds one month of daily totals for a range of homes, by their ids. */
export const HOMES_PER_FILE = 100000;
const ROWS_PER_READ = 5000;
// The files volume's marker (files fileStore.js): a configured volume that isn't mounted is never written to (D-19).
const VOLUME_MARKER = ".mercbot-files";

const COLUMNS = Object.freeze([
  "workspace_id", "day", "bot_id", "user_id", "kind", "bot_name", "calls", "estimated_calls", "cache_hit_tokens", "cache_miss_tokens",
  "output_tokens", "images", "seconds", "cost_nano"
]);
/** A column a copy adds to the daily totals (`archivedColumns`): a whole number, summed in the archive's check. */
const ADDED_COLUMN = /^[a-z][a-z0-9_]{0,62}$/u;
const KEY = Object.freeze(["workspace_id", "day", "bot_id", "user_id", "kind"]);

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
function csvField(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The month `months` before the one a moment is in, "YYYY-MM". */
const monthsBefore = (at, months) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - months, 1)).toISOString().slice(0, 7);

/**
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the account feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("knex").Knex} dependencies.knex the database connection
 * @param {ReadonlyArray<string>} dependencies.archivedColumns the columns a copy adds to the daily totals, archived after
 *   Mercbot's own (`mercbot.usage-recorder`), none without one: each a whole number, summed in the archive's check
 * @param {() => Date} [dependencies.now]
 * @param {string} [dependencies.server] who this server is, in a claim
 */
export function createRetention({
  resources, systemContext, env, knex, archivedColumns, now = () => new Date(), server = `${os.hostname()}:${process.pid}`.slice(0, 120)
}) {
  const { usageJobs } = resources;
  const added = archivedColumns.filter((column) => !COLUMNS.includes(column));
  for (const column of added) {
    if (!ADDED_COLUMN.test(column)) throw new TypeError(`An archived column must be a column's plain name, not ${JSON.stringify(column)}.`);
  }
  const columns = [...COLUMNS, ...added];
  // What the archive's check adds up in the file and in the database: the cost and every added column.
  const summed = ["cost_nano", ...added];
  const configured = Boolean(env.MERCBOT_FILES_DIR);
  const folder = path.join(filesFolder(env), "usage-archive");

  async function volumeReady() {
    if (!configured) return true;
    return fs.access(path.join(path.dirname(folder), VOLUME_MARKER)).then(() => true, () => false);
  }

  /** The months of daily totals in the database, "YYYY-MM", from their partitions' names. */
  async function dailyMonths() {
    const { rows } = await knex.raw(
      "select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'usage_daily'::regclass"
    );
    return rows.map((row) => /^usage_daily_(\d{4})(\d{2})$/u.exec(row.name)).filter(Boolean).map((match) => `${match[1]}-${match[2]}`).sort();
  }

  /** A range of homes' rows in a month's partition, by their ids. */
  const inRange = (table, from) => knex(table).where("workspace_id", ">=", from).andWhere("workspace_id", "<", from + HOMES_PER_FILE);

  /**
   * Writes one range of homes' rows of a month's partition to `file`, compressed, a page at a time in key order, and
   * answers what it wrote: the rows, the sums of the summed columns, and the sha256 of the CSV.
   */
  async function writeRange(table, from, file) {
    const hash = createHash("sha256");
    const written = { rows: 0, sums: Object.fromEntries(summed.map((column) => [column, 0])) };
    async function* lines() {
      const header = `${columns.join(",")}\n`;
      hash.update(header);
      yield header;
      for (let after = null; ;) {
        // Days as text: a date read as a JavaScript Date would be the server's own midnight.
        const page = await inRange(table, from)
          .select(columns.map((column) => (column === "day" ? knex.raw("to_char(day, 'YYYY-MM-DD') as day") : column)))
          .modify((query) => after && query.whereRaw("(workspace_id, day, bot_id, user_id, kind) > (?, ?, ?, ?, ?)", KEY.map((column) => after[column])))
          .orderBy(KEY)
          .limit(ROWS_PER_READ);
        if (!page.length) return;
        let text = "";
        for (const row of page) {
          written.rows += 1;
          for (const column of summed) written.sums[column] += Number(row[column]) || 0;
          text += `${columns.map((column) => csvField(row[column])).join(",")}\n`;
        }
        hash.update(text);
        yield text;
        after = page.at(-1);
      }
    }
    await pipeline(Readable.from(lines()), createGzip(), createWriteStream(file));
    return { ...written, sha256: hash.digest("hex") };
  }

  /** The sha256 of a compressed file's CSV, read back from the disk. */
  async function readBack(file) {
    const hash = createHash("sha256");
    await pipeline(createReadStream(file), createGunzip(), async (source) => {
      for await (const chunk of source) hash.update(chunk);
    });
    return hash.digest("hex");
  }

  /** Writes and checks one range of homes' file of a month, as a partial file this server owns. */
  async function archiveRange(month, table, from, place) {
    const name = `homes-${String(from).padStart(12, "0")}-${String(from + HOMES_PER_FILE - 1).padStart(12, "0")}.csv.gz`;
    const file = path.join(place, name);
    const partial = `${file}.${server.replace(/[^\w.-]+/gu, "_")}.partial`;
    try {
      const written = await writeRange(table, from, partial);
      if ((await readBack(partial)) !== written.sha256) throw new Error(`The archive of ${month} reads back differently from what was written.`);
      const [stored] = await inRange(table, from).select([
        knex.raw("count(*) as rows"),
        ...summed.map((column) => knex.raw("coalesce(sum(??), 0) as ??", [column, column]))
      ]);
      const same = [[stored.rows, written.rows], ...summed.map((column) => [stored[column], written.sums[column]])]
        .every(([database, file]) => Number(database) === file);
      if (!same) {
        throw new Error(`The archive of ${month} doesn't match the database; nothing was dropped.`);
      }
      return { partial, file, ...written };
    } catch (error) {
      await fs.rm(partial, { force: true });
      throw error;
    }
  }

  /**
   * Archives one month of daily totals: writes a file for each range of homes and checks each against the disk and
   * the database, then, still holding the claim with its row locked, drops the month's partition and marks it done.
   * @returns {Promise<boolean>} whether this server archived it
   */
  async function archiveMonth(month) {
    const options = { context: systemContext("archive a month of daily totals older than 13 months, then drop it from the database") };
    if (!(await claimJob({ jobs: usageJobs, job: "archive", period: month, server, at: now(), options }))) return false;
    const table = `usage_daily_${month.replace("-", "")}`;
    const place = path.join(folder, "daily", month);
    await fs.mkdir(place, { recursive: true });
    const { rows: ranges } = await knex.raw("select distinct workspace_id / ? as range from ?? order by 1", [HOMES_PER_FILE, table]);
    const files = [];
    try {
      for (const { range } of ranges) files.push(await archiveRange(month, table, Number(range) * HOMES_PER_FILE, place));
      return await usageJobs.withTransaction(options, async (txOptions) => {
        const [held] = await usageJobs.lockWhere({ job: "archive", period: month }, txOptions);
        if (held?.server !== server || held.state !== "running") return false;
        for (const { partial, file } of files) await fs.rename(partial, file);
        await txOptions.trx.raw("drop table if exists ??", [table]);
        const base = path.dirname(folder);
        const kept = files.map(({ partial: _partial, file, ...written }) => ({ ...written, file: path.relative(base, file) }));
        await usageJobs.patchWhere(
          { job: "archive", period: month },
          { state: "done", doneAt: now().toISOString(), details: { files: kept } },
          { ...txOptions, returning: "count" }
        );
        return true;
      });
    } finally {
      for (const { partial } of files) await fs.rm(partial, { force: true });
    }
  }

  /** Removes the archive files of months more than seven years ago. */
  async function removeOld() {
    const oldest = monthsBefore(now(), ARCHIVE_YEARS * 12);
    const months = await fs.readdir(path.join(folder, "daily")).catch(() => []);
    for (const month of months.filter((name) => /^\d{4}-\d{2}$/u.test(name) && name < oldest)) {
      await fs.rm(path.join(folder, "daily", month), { recursive: true, force: true });
    }
  }

  /**
   * One sweep: the partitions for the days and months ahead are made and per-call days past their keep dropped; every
   * month of daily totals older than 13 months is archived and dropped; archives older than seven years are deleted.
   * Safe on every server at once.
   * @returns {Promise<string[]>} the months this server archived
   */
  async function sweep() {
    await knex.raw("select mercbot_charge_partitions(?, ?)", [now().toISOString(), DETAIL_DAYS]);
    if (!(await volumeReady())) return [];
    const keepFrom = monthsBefore(now(), DAILY_MONTHS - 1);
    const archived = [];
    for (const month of (await dailyMonths()).filter((name) => name < keepFrom)) {
      if (await archiveMonth(month)) archived.push(month);
    }
    await removeOld();
    return archived;
  }

  return Object.freeze({
    sweep,
    archiveMonth,
    folder
  });
}
