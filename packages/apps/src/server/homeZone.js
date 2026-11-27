import { AsyncLocalStorage } from "node:async_hooks";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { isTimeZone, useTimeZoneSource } from "../shared/index.js";
import { homeIdOf } from "./callOptions.js";
import { GateError } from "./validate.js";

// The home's own time zone for its apps (D-140), which "today" in formulas and filters is in. A call that works in a home
// runs inside inHomeZone, which reads the home's zone (kept a minute per home, and at once after it changes) and holds it
// for everything the call does, awaits included, so formulas evaluated deep in the gate's reads know it. Another server
// learns of a change within the minute.
const KEPT_MS = 60000;
const current = new AsyncLocalStorage();
useTimeZoneSource(() => current.getStore() || "UTC");

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: appSettings and auditEvents.
 */
export function createHomeZone({ resources }) {
  const { appSettings, auditEvents } = resources;
  const kept = new Map();

  /** The home's time zone, or "UTC" when none is set. */
  async function zoneOf(options) {
    const home = homeIdOf(options);
    const known = kept.get(home);
    if (known && known.until > Date.now()) return known.zone;
    const { records: [settings] } = await appSettings.query({ page: { size: 1 } }, { ...passedOn(options), fields: ["timeZone"] });
    const zone = settings?.timeZone || "UTC";
    kept.set(home, { zone, until: Date.now() + KEPT_MS });
    return zone;
  }

  /** Runs `work` with "today" in the home's time zone; a call already inside one keeps it. */
  async function inHomeZone(options, work) {
    if (current.getStore()) return work();
    return current.run(await zoneOf(options), work);
  }

  /** Sets the home's time zone (owners and admins: the route checks who), audited; null goes back to UTC. */
  async function chooseZone(actor, zone, options) {
    const wanted = zone ? String(zone) : null;
    if (wanted && !isTimeZone(wanted)) {
      throw new GateError(400, `"${wanted}" isn't a time zone, such as Europe/Rome.`, { code: "apps_time_zone_invalid", params: { zone: wanted } });
    }
    await appSettings.withTransaction(options, async (txOptions) => {
      await appSettings.createMany([{ timeZone: wanted }], {
        ...txOptions,
        onConflict: { keys: ["workspaceId"], action: "merge", merge: ["timeZone"] },
        returning: "none"
      });
      await auditEvents.create({ actor, via: { kind: "app" }, action: "schema", changes: { timeZone: wanted } }, { ...txOptions, returning: "none" });
    });
    kept.delete(homeIdOf(options));
    return wanted || "UTC";
  }

  return Object.freeze({
    zoneOf,
    inHomeZone,
    chooseZone
  });
}
