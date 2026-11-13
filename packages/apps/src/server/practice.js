import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { homeIdOf } from "./callOptions.js";
import { newId } from "./registry.js";
import { GateError } from "./validate.js";

// Practice data for draft previews (D-71, owner 2026-11-11). A draft's preview, and the Builder
// trying it, read and write a practice copy of the home's records, never the live ones: Save adds a
// record that shows in the preview's lists, totals and charts, and nothing reaches the live app or
// its Activity. Each table is copied the first time the copy needs it (its newest
// PRACTICE_RECORDS records); the copy's records are AnyAPI's (anyapi.js), and this module keeps its
// row in app_practices, so every server finds the same copy (D-15). A copy goes when its draft is
// published, when a person resets it (a new copy), or after seven days unused (the sweep).
const IDLE_DAYS = 7;
// A copy in use is marked used at most this often, so reading it costs no write.
const TOUCH_MS = 60 * 60 * 1000;
// Copies the sweep clears per run, each in its own transaction.
const SWEEP_MAX = 50;

/**
 * Practice copies of drafts' records (see above). A practice, as the gate's ctx carries it, is
 * `{ id, homeId, copied, changes, simulated }`: its copy id, its home, the tables copied so far, and
 * what one call changed in it and pretended to send, for the call to report.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the apps
 *   feature's handles (appPractices)
 * @param {import("./types.js").Anyapi} dependencies.anyapi
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext AppsFeature's
 */
export function createPractices({ resources, anyapi, systemContext }) {
  const { appPractices } = resources;
  // Tables known to be in a copy, as "<copy id>:<table id>": a copy is never emptied, only dropped
  // whole, and its id never comes back, so knowing it once is knowing it for good.
  const copiedHere = new Set();

  const practiceOf = (row, homeId) => ({ id: row.id, homeId, copied: row.copied || [], changes: [], simulated: [] });

  async function rowFor(versionId, options) {
    const { records: [row] } = await appPractices.query(
      { filters: { versionId: String(versionId) }, page: { size: 1 } },
      passedOn(options)
    );
    return row ?? null;
  }

  /**
   * The practice copy of an app's draft version, made the first time anyone needs it (two first uses
   * at once get the same one), and marked used.
   * @param {{ id: string }} app
   * @param {string} versionId the draft version
   */
  async function of(app, versionId, options) {
    let row = await rowFor(versionId, options);
    if (!row) {
      // Two first uses at once: one insert loses on the version's unique key, and its retry finds the other's row.
      row = await retryLostInsertRace(options, () => appPractices.withTransaction(passedOn(options), async (txOptions) => {
        const made = await rowFor(versionId, txOptions);
        if (made) return made;
        await appPractices.create({ id: newId("p"), appId: app.id, versionId: String(versionId), copied: [] }, { ...txOptions, returning: "none" });
        return rowFor(versionId, txOptions);
      }));
    } else if (Date.now() - new Date(row.usedAt).getTime() > TOUCH_MS) {
      // The sweep may clear an idle copy between the read and this mark: then this is a first use again.
      const marked = await appPractices.patch(row.id, { usedAt: new Date().toISOString() }, { ...passedOn(options), returning: "id", missing: "skip" });
      if (marked === null) return of(app, versionId, options);
    }
    return practiceOf(row, homeIdOf(options));
  }

  /**
   * Makes sure the copy holds `table`: the first use copies its newest records from the home, under
   * the copy's row lock, so servers copying together copy it once.
   * @param {object} practice as of() answers it
   * @param {object[]} tables the home's tables (the registry's)
   * @param {object} table
   */
  async function ensure(practice, tables, table, options) {
    const key = `${practice.id}:${table.id}`;
    if (copiedHere.has(key) || practice.copied.includes(table.id)) {
      copiedHere.add(key);
      return;
    }
    await appPractices.withTransaction(passedOn(options), async (txOptions) => {
      const row = await appPractices.lock(practice.id, { ...txOptions, fields: ["copied"], missing: "skip" });
      if (!row) {
        throw new GateError(409, "This practice data was just reset or cleared. Reload the preview to start again.", { code: "apps_practice_gone" });
      }
      if (row.copied.includes(table.id)) return;
      await anyapi.copyTable(practice.homeId, practice.id, tables, table, txOptions);
      await appPractices.patch(practice.id, { copied: [...row.copied, table.id] }, { ...txOptions, returning: "none" });
    });
    copiedHere.add(key);
  }

  /** Drops a copy (its row, locked or claimed in this transaction, and its records). */
  async function dropCopy(row, homeId, txOptions) {
    await anyapi.dropPractice(homeId, row.id, txOptions);
    await appPractices.delete(row.id, { ...txOptions, returning: "none" });
  }

  /**
   * Clears a draft version's copy, if it has one, in the caller's transaction: publishing the draft
   * calls it, so the live app never sees practice records.
   */
  async function remove(versionId, txOptions) {
    const [row] = await appPractices.lockWhere({ versionId: String(versionId) }, { ...txOptions, fields: ["id"] });
    if (row) await dropCopy(row, homeIdOf(txOptions), txOptions);
  }

  /** Reset: the draft's copy goes, and a new one starts from the live records as they are now. */
  async function reset(app, versionId, options) {
    await appPractices.withTransaction(passedOn(options), (txOptions) => remove(versionId, txOptions));
    return of(app, versionId, options);
  }

  /**
   * Run by the watch loop's pruning on every serving server (D-15): clears copies unused for
   * IDLE_DAYS, each claimed with SKIP LOCKED so two servers never clear the same one, then any
   * records left under a copy whose row is gone (its home was deleted, or a copy was still being
   * filled when it was reset).
   */
  async function sweep() {
    const options = { context: systemContext("clear unused practice copies of drafts") };
    const cutoff = new Date(Date.now() - IDLE_DAYS * 86400000).toISOString();
    for (let count = 0; count < SWEEP_MAX; count += 1) {
      const cleared = await appPractices.withTransaction(options, async (txOptions) => {
        const [row] = await appPractices.claim(
          { filters: { usedBefore: cutoff }, sort: ["usedAt"], take: 1 },
          { ...txOptions, fields: ["id", "workspaceId"] }
        );
        if (row) await dropCopy(row, String(row.workspaceId), txOptions);
        return Boolean(row);
      });
      if (!cleared) break;
    }
    const held = await anyapi.practiceCopies();
    if (!held.length) return;
    const kept = new Set(
      (await appPractices.queryAll({ filters: { id: held.map((copy) => copy.copyId) }, fields: ["id"] }, options)).map((row) => row.id)
    );
    for (const copy of held.filter((entry) => !kept.has(entry.copyId))) {
      await appPractices.withTransaction(options, (txOptions) => anyapi.dropPractice(copy.workspaceId, copy.copyId, txOptions));
    }
  }

  return Object.freeze({
    of,
    ensure,
    remove,
    reset,
    sweep
  });
}
