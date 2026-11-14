import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/**
 * Where each of a batch of homes keeps its files, in every home the call's options reach (a system context's). A
 * home's storage row is keyed by its ownership field, which the handle's own reads keep hidden, so this is a report on
 * the feature's own table. A home without a row keeps its files on Mercbot's own volume.
 * @param {{ fileStorage: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} resources this feature's handles
 */
export function createFileStorageRepository({ fileStorage }) {
  const column = (field) => fileStorage.column(field, "f");

  /**
   * @param {string[]} workspaceIds
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   * @returns {Promise<Map<string, string>>}
   */
  // Knex: report - each home's storage kind, for a batch of homes (ux_file_storage_key)
  async function kindsByHome(workspaceIds, options) {
    if (workspaceIds.length === 0) return new Map();
    const { query } = await fileStorage.scopedQuery({ alias: "f" }, passedOn(options));
    const rows = await query
      .whereIn(column("workspaceId"), workspaceIds.map(String))
      .select({ workspaceId: column("workspaceId"), kind: column("kind") });
    return new Map(rows.map((row) => [String(row.workspaceId), row.kind]));
  }

  return Object.freeze({ kindsByHome });
}
