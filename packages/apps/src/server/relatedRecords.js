/**
 * A record's related records (D-130): the records of the home's tables that link to it, grouped by table and link
 * field, the first page of each with its count. A contact shows their to-dos, events, deals and pipeline details. Each
 * group is one read through the gate, so a visitor's fence holds and the cost follows the tables that link here, never
 * how many records do.
 * @param {object} dependencies the data gate's own reads
 * @param {Function} dependencies.tableAs the gate's table lookup that keeps to private tables (D-138)
 * @param {Function} dependencies.canRead whether a ctx may read a table's records
 * @param {Function} dependencies.read
 */
export function createRelatedRecords({ tableAs, canRead, read }) {
  /**
   * @param {object} ctx a gate ctx
   * @param {string} tableIdOrKey the record's table
   * @param {string} id the record
   * @param {{ size?: number }} [page] how many of each group (default 10)
   */
  async function related(ctx, tableIdOrKey, id, { size = 10 } = {}) {
    const { table, tables } = await tableAs(ctx, tableIdOrKey);
    const groups = [];
    // Only the tables they may read (D-138): a private table's records linking here stay out of sight.
    for (const other of tables.filter((entry) => !entry.obsolete)) {
      if (!(await canRead(ctx, other))) continue;
      const links = other.fields.filter((field) => !field.obsolete && field.type === "link" && field.options?.target === table.id);
      for (const field of links) {
        const where = { plan: { kind: "compare", op: "=", field: { name: field.id }, value: "record" }, variables: { record: "string" }, values: { record: String(id) } };
        const { records, total } = await read(ctx, other.id, { where, page: { size } });
        if (!total) continue;
        groups.push({
          table: { id: other.id, key: other.key, label: other.label, titleFieldId: other.titleFieldId },
          field: { id: field.id, key: field.key, label: field.label },
          extension: field.options.unique === true,
          total,
          records
        });
      }
    }
    return groups;
  }

  return Object.freeze({
    related
  });
}
