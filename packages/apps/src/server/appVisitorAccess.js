import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { toIds, toNames } from "../shared/definitions.js";
import { listedAccess, listedStored, narrowed, publicScripts, visitorReads, widening, withoutRemoved } from "../shared/visitorAccess.js";
import { RegistryError } from "./registry.js";

/**
 * A public app's visitor access (D-66, D-67) as people see, narrow and widen it: the Overview's
 * list, narrowing at once by owners and admins, and the check that keeps wider access to them when
 * a public app's version is published or restored. Built by createApps, whose `find`, `addVersion`
 * and `notAView` it uses. Every read and write is in the home of the call's options.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps and appVersions.
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {import("./types.js").AppStore["find"]} dependencies.find
 * @param {import("./types.js").AppStore["addVersion"]} dependencies.addVersion
 * @param {(app: { kind: string }, what: string) => void} dependencies.notAView
 */
export function createAppVisitorAccess({ resources, registry, find, addVersion, notAView }) {
  const { apps, appVersions } = resources;
  /** A version's stored definition (by ids), or null when there is none. */
  const definitionOf = async (versionId, options) =>
    versionId ? (await appVersions.get(versionId, { fields: ["definition"] }, { ...passedOn(options), missing: "skip" }))?.definition ?? null : null;

  /**
   * A public app's visitor access is widened only by the home's owners and admins (D-66): anyone may
   * publish the same or narrower access, and any app that isn't public.
   * @param {{ publicAt: string | null, liveVersionId: string | null }} app The apps record (find), in the transaction.
   * @param {object} definition The definition about to go live, by ids.
   * @param {boolean} canManage
   * @param {object} txOptions
   */
  async function checkWidening(app, definition, canManage, txOptions) {
    if (canManage || !app.publicAt) return;
    const tables = await registry.loadTables(txOptions);
    const live = await definitionOf(app.liveVersionId, txOptions);
    const wider = widening(listedStored(live, tables)?.public?.tables, listedStored(definition, tables)?.public?.tables);
    if (!wider.length) return;
    const label = (table, name) => {
      const entry = tables.find((item) => item.id === table);
      return name === undefined ? entry?.label ?? table : entry?.fields.find((field) => field.id === name)?.label ?? name;
    };
    const item = ({ table, what, name }) => {
      if (what === "table") return label(table);
      if (what === "read" || what === "write") return `${label(table)}: ${what} ${label(table, name)}`;
      return `${label(table)}: ${what}${name ? ` ${name}` : ""}`;
    };
    const items = wider.map(item);
    const wanted = [...new Set(items)].join("; ");
    throw new RegistryError(403, `Only the home's owners and admins can let visitors reach more of a public app: ${wanted}.`, {
      code: "apps_visitor_access_widening",
      params: { wanted }
    });
  }

  /**
   * The kind of the app's newest published version that isn't a removal, or null: one grouped read,
   * since a published version has a number and a draft has none.
   */
  async function lastPublishedKind(appId, options) {
    const kinds = await appVersions.aggregate({ groupBy: ["kind"], measures: { last: { max: "number" } }, filters: { appId } }, passedOn(options));
    const newest = kinds
      .filter((row) => row.kind !== "removal" && row.last !== null && row.last !== undefined)
      .reduce((top, row) => (!top || Number(row.last) > Number(top.last) ? row : top), null);
    return newest?.kind ?? null;
  }

  /**
   * An app's visitor access, by names, as the Overview shows it: each listed table with what
   * visitors may do and which records and fields they reach. `attention` lists the public screens'
   * data scripts while the list is still the one the upgrade derived (D-66): what a script reads is
   * up to its code, so a person checks the list covers it.
   * @param {string} slugOrId
   * @param {object} options
   */
  async function visitorAccess(slugOrId, options) {
    const app = await find(slugOrId, options);
    const stored = await definitionOf(app.liveVersionId, options);
    const tables = await registry.loadTables(options);
    const definition = stored ? toNames(stored, tables) : {};
    const listed = listedAccess(definition, tables);
    const label = (table, name) => table?.fields.find((field) => !field.obsolete && field.key === name)?.label ?? name;
    return {
      signIn: definition.public?.signIn === "required",
      tables: Object.entries(listed).map(([key, rule]) => {
        const table = tables.find((entry) => !entry.obsolete && entry.key === key);
        return {
          key,
          label: table?.label ?? key,
          can: rule.can || [],
          rows: rule.rows ?? null,
          owner: rule.owner ? { key: rule.owner, label: label(table, rule.owner) } : null,
          read: visitorReads(table, rule.read).map((name) => ({ key: name, label: label(table, name) })),
          write: (rule.write || []).map((name) => ({ key: name, label: label(table, name) }))
        };
      }),
      attention: (await lastPublishedKind(app.id, options)) === "upgrade" ? publicScripts(definition) : []
    };
  }

  /**
   * Owners and admins narrow a public app's visitor access at once (D-66): `keep` ({ table: { can,
   * read, write } }, by names) says what stays, and a new live version lists only that. Rows and
   * owner stay as they were, so it can only shrink. The draft loses the same, so publishing it
   * later doesn't bring back what was taken away. Widening goes through the Builder and Publish.
   * @param {object} actor
   * @param {string} slugOrId
   * @param {unknown} keep
   * @param {object} options
   */
  async function narrowVisitorAccess(actor, slugOrId, keep, options) {
    const result = await apps.withTransaction(passedOn(options), async (txOptions) => {
      const app = await apps.lock((await find(slugOrId, txOptions)).id, txOptions);
      notAView(app, "have visitor access");
      const liveDefinition = await definitionOf(app.liveVersionId, txOptions);
      if (!liveDefinition) throw new RegistryError(409, "Publish a version first.", { code: "apps_live_missing" });
      const tables = await registry.loadTables(txOptions);
      const kept = toIds({ public: { tables: keep && typeof keep === "object" && !Array.isArray(keep) ? keep : {} } }, tables);
      if (kept.errors.length) {
        throw new RegistryError(400, kept.errors.map((error) => error.message).join(" "), {
          code: "apps_visitor_access_unknown",
          params: { problems: kept.errors }
        });
      }
      const current = listedStored(liveDefinition, tables);
      const before = current.public?.tables || {};
      const after = narrowed(before, kept.definition.public.tables);
      const lost = (table, what) => (before[table][what] || []).some((name) => !(after[table][what] || []).includes(name));
      const changed = Object.keys(before).filter((table) => !after[table] || ["can", "read", "write"].some((what) => lost(table, what)));
      if (!changed.length) return { changed: false };
      const names = changed.map((table) => tables.find((entry) => entry.id === table)?.label ?? table).join(", ");
      const { number, versionId } = await addVersion(
        app,
        actor,
        { ...current, public: { ...current.public, tables: after } },
        `Visitors reach less of ${names}`,
        "narrowing",
        txOptions
      );
      if (app.draftVersionId) {
        const draft = listedStored(await definitionOf(app.draftVersionId, txOptions), tables);
        if (draft?.public?.tables) {
          const tablesLeft = withoutRemoved(draft.public.tables, before, after);
          const left = { ...draft, public: { ...draft.public, tables: tablesLeft } };
          await appVersions.patch(app.draftVersionId, { definition: left }, { ...txOptions, returning: "none" });
        }
      }
      return { changed: true, number, versionId };
    });
    return { ...result, ...(await visitorAccess(slugOrId, options)) };
  }

  return Object.freeze({
    checkWidening,
    visitorAccess,
    narrowVisitorAccess
  });
}
