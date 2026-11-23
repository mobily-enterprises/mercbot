// How the home's tables are linked (D-130), read from the tables and their fields the page already has: what a table
// links to, what links to it, and the one-to-one extensions that hold more about its records. A table's links to itself
// (a to-do part of another) aren't listed.

/**
 * @param {{ id: string }} table
 * @param {object[]} tables every table of the home, with its fields
 * @returns {{ linksTo: object[], linkedFrom: object[], extendedBy: object[] }} each a list of tables, once each
 */
export function linksOf(table, tables) {
  const live = tables.filter((entry) => !entry.obsolete);
  const byId = new Map(live.map((entry) => [entry.id, entry]));
  const links = live.flatMap((from) => from.fields
    .filter((field) => !field.obsolete && field.type === "link" && byId.has(field.options?.target))
    .map((field) => ({ from, to: byId.get(field.options.target), unique: field.options.unique === true })))
    .filter((link) => link.from.id !== link.to.id);
  const once = (list) => [...new Map(list.map((entry) => [entry.id, entry])).values()];
  return {
    linksTo: once(links.filter((link) => link.from.id === table?.id).map((link) => link.to)),
    linkedFrom: once(links.filter((link) => link.to.id === table?.id && !link.unique).map((link) => link.from)),
    extendedBy: once(links.filter((link) => link.to.id === table?.id && link.unique).map((link) => link.from))
  };
}
